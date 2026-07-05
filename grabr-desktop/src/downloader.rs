use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use reqwest::header::{ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use serde::{Serialize, Deserialize};
use uuid::Uuid;

use crate::db;
use crate::types::{ChunkInfo, ChunkStatus, DownloadJob, DownloadOptions, GrabrConfig, JobStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsEvent {
    #[serde(rename = "job:added")]
    JobAdded { job: DownloadJob },
    #[serde(rename = "job:progress")]
    JobProgress {
        #[serde(rename = "jobId")]
        job_id: String,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
        speed: u64,
        eta: i64,
        chunks: Vec<ChunkInfo>,
    },
    #[serde(rename = "job:status")]
    JobStatus {
        #[serde(rename = "jobId")]
        job_id: String,
        status: JobStatus,
        #[serde(default)]
        error: Option<String>,
    },
    #[serde(rename = "job:removed")]
    JobRemoved {
        #[serde(rename = "jobId")]
        job_id: String,
    },
    #[serde(rename = "jobs:cleared")]
    JobsCleared,
}

#[derive(Debug)]
pub enum ManagerEvent {
    ProcessQueue,
    JobAdded(DownloadJob),
}

pub struct SpeedMeter {
    ema: f64,
    alpha: f64,
    last_time: std::time::Instant,
    last_bytes: u64,
}

impl SpeedMeter {
    pub fn new(initial_bytes: u64) -> Self {
        Self {
            ema: 0.0,
            alpha: 0.2,
            last_time: std::time::Instant::now(),
            last_bytes: initial_bytes,
        }
    }

    pub fn update(&mut self, total_bytes: u64) -> u64 {
        let now = std::time::Instant::now();
        let dt = now.duration_since(self.last_time).as_secs_f64();
        let db = total_bytes.saturating_sub(self.last_bytes) as f64;

        let instant_speed = if db > 0.0 && dt > 0.0 { db / dt } else { 0.0 };

        if dt > 0.0 {
            self.ema = self.alpha * instant_speed + (1.0 - self.alpha) * self.ema;
            self.last_time = now;
            self.last_bytes = total_bytes;
        }

        self.ema.round() as u64
    }
}

pub struct ActiveJob {
    pub job: DownloadJob,
    pub token: CancellationToken,
    pub speed_meter: SpeedMeter,
    pub speed_limit: Arc<std::sync::atomic::AtomicU64>,
}

pub struct DownloadManager {
    db_path: PathBuf,
    config: GrabrConfig,
    active_jobs: Arc<Mutex<HashMap<String, ActiveJob>>>,
    event_tx: mpsc::Sender<ManagerEvent>,
    ws_tx: broadcast::Sender<WsEvent>,
}

impl DownloadManager {
    pub fn new<P: AsRef<Path>>(db_path: P, config: GrabrConfig) -> (Arc<Self>, mpsc::Receiver<ManagerEvent>) {
        let (event_tx, event_rx) = mpsc::channel(100);
        let (ws_tx, _) = broadcast::channel(100);
        
        let manager = Arc::new(Self {
            db_path: db_path.as_ref().to_path_buf(),
            config,
            active_jobs: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            ws_tx,
        });

        (manager, event_rx)
    }

    pub fn ws_sender(&self) -> broadcast::Sender<WsEvent> {
        self.ws_tx.clone()
    }

    pub async fn start(self: Arc<Self>, mut event_rx: mpsc::Receiver<ManagerEvent>) {
        // Reset interrupted jobs in DB on start (set downloading to paused)
        if let Ok(conn) = db::init_db(&self.db_path) {
            if let Ok(jobs) = db::list_jobs(&conn) {
                for mut job in jobs {
                    if job.status == JobStatus::Downloading {
                        job.status = JobStatus::Paused;
                        job.speed = 0;
                        db::update_job(&conn, &job).ok();
                    }
                }
            }
        }

        // Spawn stats updater loop (every 500ms)
        let manager_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                manager_clone.update_stats().await;
            }
        });

        // Event processing loop
        while let Some(event) = event_rx.recv().await {
            match event {
                ManagerEvent::ProcessQueue => {
                    self.process_queue().await;
                }
                ManagerEvent::JobAdded(job) => {
                    self.ws_tx.send(WsEvent::JobAdded { job }).ok();
                    self.process_queue().await;
                }
            }
        }
    }

    pub fn get_config(&self) -> GrabrConfig {
        self.config.clone()
    }

    pub fn set_speed_limit(&self, job_id: &str, limit_bytes_sec: u64) {
        let active = self.active_jobs.lock().unwrap();
        if let Some(active_job) = active.get(job_id) {
            active_job.speed_limit.store(limit_bytes_sec, std::sync::atomic::Ordering::Relaxed);
        }
    }

    pub async fn add_job(&self, url: &str, options: DownloadOptions) -> Result<DownloadJob, String> {
        let output_dir = options.output_dir.clone().unwrap_or_else(|| self.config.output_dir.clone());
        fs::create_dir_all(&output_dir).await.map_err(|e| format!("Failed to create output dir: {}", e))?;

        let num_chunks = options.chunks.unwrap_or(self.config.default_chunks);

        let metadata = if url.contains("youtube.com") || url.contains("youtu.be") {
            self.get_youtube_metadata(url).await?
        } else {
            self.get_file_metadata(url, num_chunks, options.filename.as_deref()).await?
        };

        let filename = resolve_filename_collision(&output_dir, &metadata.filename);
        let job = DownloadJob {
            id: Uuid::new_v4().to_string()[..10].to_string(),
            url: url.to_string(),
            filename,
            destination: output_dir,
            total_bytes: metadata.total_bytes,
            downloaded_bytes: 0,
            chunks: metadata.chunks,
            status: JobStatus::Queued,
            speed: 0,
            eta: -1,
            created_at: chrono::Utc::now().timestamp_millis(),
            updated_at: chrono::Utc::now().timestamp_millis(),
            error: None,
        };

        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        db::create_job(&conn, &job).map_err(|e| e.to_string())?;

        self.event_tx.send(ManagerEvent::JobAdded(job.clone())).await.ok();

        Ok(job)
    }

    pub async fn pause_job(&self, job_id: &str) -> Result<(), String> {
        {
            let mut active_jobs = self.active_jobs.lock().unwrap();
            if let Some(active) = active_jobs.remove(job_id) {
                active.token.cancel();
            }
        }

        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        if let Some(mut job) = db::get_job(&conn, job_id).map_err(|e| e.to_string())? {
            if job.status == JobStatus::Downloading || job.status == JobStatus::Queued {
                job.status = JobStatus::Paused;
                job.speed = 0;
                job.eta = -1;
                job.updated_at = chrono::Utc::now().timestamp_millis();
                db::update_job(&conn, &job).map_err(|e| e.to_string())?;
                
                self.ws_tx.send(WsEvent::JobStatus {
                    job_id: job_id.to_string(),
                    status: JobStatus::Paused,
                    error: None,
                }).ok();
            }
        }

        self.event_tx.send(ManagerEvent::ProcessQueue).await.ok();
        Ok(())
    }

    pub async fn resume_job(&self, job_id: &str) -> Result<(), String> {
        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        if let Some(mut job) = db::get_job(&conn, job_id).map_err(|e| e.to_string())? {
            if job.status == JobStatus::Paused || job.status == JobStatus::Failed {
                job.status = JobStatus::Queued;
                job.speed = 0;
                job.eta = -1;
                job.error = None;
                job.updated_at = chrono::Utc::now().timestamp_millis();
                db::update_job(&conn, &job).map_err(|e| e.to_string())?;

                self.ws_tx.send(WsEvent::JobStatus {
                    job_id: job_id.to_string(),
                    status: JobStatus::Queued,
                    error: None,
                }).ok();
            }
        }

        self.event_tx.send(ManagerEvent::ProcessQueue).await.ok();
        Ok(())
    }

    pub async fn remove_job(&self, job_id: &str) -> Result<(), String> {
        self.pause_job(job_id).await?;
        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        db::delete_job(&conn, job_id).map_err(|e| e.to_string())?;
        
        self.ws_tx.send(WsEvent::JobRemoved {
            job_id: job_id.to_string(),
        }).ok();
        Ok(())
    }

    pub async fn pause_all(&self) -> Result<(), String> {
        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        let jobs = db::list_jobs(&conn).map_err(|e| e.to_string())?;
        for job in jobs {
            if job.status == JobStatus::Downloading || job.status == JobStatus::Queued {
                self.pause_job(&job.id).await?;
            }
        }
        Ok(())
    }

    pub async fn resume_all(&self) -> Result<(), String> {
        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        let jobs = db::list_jobs(&conn).map_err(|e| e.to_string())?;
        for job in jobs {
            if job.status == JobStatus::Paused || job.status == JobStatus::Failed {
                self.resume_job(&job.id).await?;
            }
        }
        Ok(())
    }

    pub async fn clear_completed(&self) -> Result<(), String> {
        let conn = db::init_db(&self.db_path).map_err(|e| e.to_string())?;
        db::clear_completed_jobs(&conn).map_err(|e| e.to_string())?;
        self.ws_tx.send(WsEvent::JobsCleared).ok();
        Ok(())
    }

    async fn update_stats(&self) {
        let mut active_jobs = self.active_jobs.lock().unwrap();
        let conn = match db::init_db(&self.db_path) {
            Ok(c) => c,
            Err(_) => return,
        };

        let mut completed_ids = Vec::new();

        for (job_id, active) in active_jobs.iter_mut() {
            let speed = active.speed_meter.update(active.job.downloaded_bytes);
            active.job.speed = speed;

            if active.job.total_bytes > 0 {
                let remaining = active.job.total_bytes.saturating_sub(active.job.downloaded_bytes);
                active.job.eta = if speed > 0 { (remaining / speed) as i64 } else { -1 };
            } else {
                active.job.eta = -1;
            }

            active.job.updated_at = chrono::Utc::now().timestamp_millis();
            db::update_job(&conn, &active.job).ok();

            self.ws_tx.send(WsEvent::JobProgress {
                job_id: job_id.clone(),
                downloaded_bytes: active.job.downloaded_bytes,
                total_bytes: active.job.total_bytes,
                speed: active.job.speed,
                eta: active.job.eta,
                chunks: active.job.chunks.clone(),
            }).ok();

            if active.job.status == JobStatus::Completed || active.job.status == JobStatus::Failed {
                completed_ids.push(job_id.clone());
            }
        }

        for id in completed_ids {
            active_jobs.remove(&id);
            // Trigger queue check when an active job finishes
            let tx = self.event_tx.clone();
            tokio::spawn(async move {
                tx.send(ManagerEvent::ProcessQueue).await.ok();
            });
        }
    }

    async fn process_queue(&self) {
        let active_count = { self.active_jobs.lock().unwrap().len() };
        if active_count >= self.config.max_concurrent {
            return;
        }

        let slots_available = self.config.max_concurrent - active_count;
        let conn = match db::init_db(&self.db_path) {
            Ok(c) => c,
            Err(_) => return,
        };

        let jobs = match db::list_jobs(&conn) {
            Ok(j) => j,
            Err(_) => return,
        };

        let queued_jobs: Vec<DownloadJob> = jobs.into_iter().filter(|j| j.status == JobStatus::Queued).collect();

        for i in 0..std::cmp::min(slots_available, queued_jobs.len()) {
            if let Some(job) = queued_jobs.get(i) {
                let is_active = { self.active_jobs.lock().unwrap().contains_key(&job.id) };
                if !is_active {
                    let self_clone = Arc::new(Self {
                        db_path: self.db_path.clone(),
                        config: self.config.clone(),
                        active_jobs: self.active_jobs.clone(),
                        event_tx: self.event_tx.clone(),
                        ws_tx: self.ws_tx.clone(),
                    });
                    let job_clone = job.clone();
                    tokio::spawn(async move {
                        self_clone.run_job(job_clone).await;
                    });
                }
            }
        }
    }

    async fn run_job(&self, mut job: DownloadJob) {
        let token = CancellationToken::new();
        let speed_meter = SpeedMeter::new(job.downloaded_bytes);

        job.status = JobStatus::Downloading;
        job.updated_at = chrono::Utc::now().timestamp_millis();
        
        let conn = match db::init_db(&self.db_path) {
            Ok(c) => c,
            Err(e) => {
                error!("DB init error: {}", e);
                return;
            }
        };
        db::update_job(&conn, &job).ok();
        self.ws_tx.send(WsEvent::JobStatus {
            job_id: job.id.clone(),
            status: JobStatus::Downloading,
            error: None,
        }).ok();

        let speed_limit = Arc::new(std::sync::atomic::AtomicU64::new(0));

        {
            let mut active = self.active_jobs.lock().unwrap();
            active.insert(
                job.id.clone(),
                ActiveJob {
                    job: job.clone(),
                    token: token.clone(),
                    speed_meter,
                    speed_limit: speed_limit.clone(),
                },
            );
        }

        let is_youtube = job.url.contains("youtube.com") || job.url.contains("youtu.be");
        if is_youtube {
            self.run_youtube_job(job, token).await;
            return;
        }

        let tmp_dir = self.db_path.parent().unwrap().join("tmp").join(&job.id);
        fs::create_dir_all(&tmp_dir).await.ok();

        let mut part_paths = Vec::new();
        let mut download_tasks = Vec::new();
        
        // Setup channels for progress updates
        let (progress_tx, mut progress_rx) = mpsc::channel(100);

        // Progress listener task
        let job_id_for_progress = job.id.clone();
        let active_jobs_for_progress = self.active_jobs.clone();
        let progress_handle = tokio::spawn(async move {
            while let Some((chunk_idx, bytes_written)) = progress_rx.recv().await {
                let mut active = active_jobs_for_progress.lock().unwrap();
                if let Some(active_job) = active.get_mut(&job_id_for_progress) {
                    active_job.job.downloaded_bytes += bytes_written;
                    if let Some(chunk) = active_job.job.chunks.iter_mut().find(|c| c.index == chunk_idx) {
                        chunk.downloaded += bytes_written;
                    }
                }
            }
        });

        let total_chunks = job.chunks.len();
        for chunk in job.chunks.clone() {
            let part_path = tmp_dir.join(format!("{}.part", chunk.index));
            part_paths.push(part_path.clone());

            if chunk.status == ChunkStatus::Done {
                continue;
            }

            let url = job.url.clone();
            let token_clone = token.clone();
            let progress_tx_clone = progress_tx.clone();
            let speed_limit_clone = speed_limit.clone();
            
            let task = tokio::spawn(async move {
                download_chunk(
                    url,
                    chunk,
                    part_path,
                    progress_tx_clone,
                    token_clone,
                    speed_limit_clone,
                    total_chunks,
                ).await
            });
            download_tasks.push(task);
        }

        // Wait for all download tasks to finish
        let mut has_errors = false;
        let mut aborted = false;
        let mut error_msg = None;

        for task in download_tasks {
            match task.await {
                Ok(Ok(chunk_res)) => {
                    // Update chunk status in active job
                    let mut active = self.active_jobs.lock().unwrap();
                    if let Some(active_job) = active.get_mut(&job.id) {
                        if let Some(c) = active_job.job.chunks.iter_mut().find(|c| c.index == chunk_res.index) {
                            c.status = ChunkStatus::Done;
                        }
                    }
                }
                Ok(Err(e)) => {
                    has_errors = true;
                    if e.contains("aborted") || e.contains("Aborted") {
                        aborted = true;
                    } else {
                        error_msg = Some(e);
                    }
                }
                Err(e) => {
                    has_errors = true;
                    error_msg = Some(format!("Task panic: {}", e));
                }
            }
        }

        // Stop progress updates
        drop(progress_tx);
        progress_handle.await.ok();

        if aborted || token.is_cancelled() {
            info!("Job {} download aborted.", job.id);
            return;
        }

        // Get final job state from memory
        let mut final_job = {
            let active = self.active_jobs.lock().unwrap();
            active.get(&job.id).map(|a| a.job.clone()).unwrap_or(job)
        };

        if has_errors {
            let msg = error_msg.unwrap_or_else(|| "Download failed".to_string());
            final_job.status = JobStatus::Failed;
            final_job.speed = 0;
            final_job.eta = -1;
            final_job.error = Some(msg.clone());
            final_job.updated_at = chrono::Utc::now().timestamp_millis();
            
            for chunk in final_job.chunks.iter_mut() {
                if chunk.status == ChunkStatus::Downloading {
                    chunk.status = ChunkStatus::Failed;
                }
            }

            db::update_job(&conn, &final_job).ok();
            self.ws_tx.send(WsEvent::JobStatus {
                job_id: final_job.id.clone(),
                status: JobStatus::Failed,
                error: Some(msg),
            }).ok();
            
            // Fire native notification
            send_native_notification("Download Failed", &format!("Failed downloading: {}", final_job.filename));
        } else {
            // Merge chunks
            let final_dest = Path::new(&final_job.destination).join(&final_job.filename);
            match merge_chunks(part_paths, &final_dest, &tmp_dir).await {
                Ok(_) => {
                    final_job.status = JobStatus::Completed;
                    final_job.speed = 0;
                    final_job.eta = 0;
                    final_job.downloaded_bytes = final_job.total_bytes;
                    final_job.updated_at = chrono::Utc::now().timestamp_millis();

                    db::update_job(&conn, &final_job).ok();
                    self.ws_tx.send(WsEvent::JobStatus {
                        job_id: final_job.id.clone(),
                        status: JobStatus::Completed,
                        error: None,
                    }).ok();

                    // Fire native notification
                    send_native_notification("Download Completed", &format!("Successfully downloaded: {}", final_job.filename));
                }
                Err(e) => {
                    final_job.status = JobStatus::Failed;
                    final_job.speed = 0;
                    final_job.eta = -1;
                    final_job.error = Some(e.clone());
                    final_job.updated_at = chrono::Utc::now().timestamp_millis();

                    db::update_job(&conn, &final_job).ok();
                    self.ws_tx.send(WsEvent::JobStatus {
                        job_id: final_job.id.clone(),
                        status: JobStatus::Failed,
                        error: Some(e),
                    }).ok();
                    
                    send_native_notification("Download Failed", &format!("Merge failed for: {}", final_job.filename));
                }
            }
        }

        // Clean up from active_jobs list
        {
            let mut active = self.active_jobs.lock().unwrap();
            active.remove(&final_job.id);
        }

        self.event_tx.send(ManagerEvent::ProcessQueue).await.ok();
    }

    async fn run_youtube_job(&self, mut job: DownloadJob, token: CancellationToken) {
        let final_dest = Path::new(&job.destination).join(&job.filename);
        let clean_url = job.url.split('#').next().unwrap_or("").to_string();
        
        let conn = match db::init_db(&self.db_path) {
            Ok(c) => c,
            Err(_) => return,
        };

        // Extract format selection from URL hash if present
        let mut format_selection = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string();
        if job.url.contains("#format=") {
            if let Some(pos) = job.url.find("#format=") {
                let raw_fmt = &job.url[pos + 8..];
                if let Ok(decoded) = urlencoding::decode(raw_fmt) {
                    format_selection = decoded.into_owned();
                }
            }
        }

        let exe_path = get_yt_dlp_executable_path().unwrap_or_else(|_| PathBuf::from("yt-dlp"));
        let child_res = tokio::process::Command::new(&exe_path)
            .args(&[
                "-f", &format_selection,
                "--merge-output-format", "mp4",
                "-o", final_dest.to_str().unwrap(),
                "--newline",
                &clean_url,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        let mut child = match child_res {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("yt-dlp failed to spawn: {}", e);
                error!("{}", err_msg);
                job.status = JobStatus::Failed;
                job.error = Some(err_msg.clone());
                db::update_job(&conn, &job).ok();
                self.ws_tx.send(WsEvent::JobStatus {
                    job_id: job.id.clone(),
                    status: JobStatus::Failed,
                    error: Some(err_msg),
                }).ok();
                
                {
                    let mut active = self.active_jobs.lock().unwrap();
                    active.remove(&job.id);
                }
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let mut reader = tokio::io::BufReader::new(stdout).lines();

        let job_id_clone = job.id.clone();
        let active_jobs_clone = self.active_jobs.clone();

        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if line.contains("[download]") {
                    // Parse percentage
                    if let Some(pos) = line.find('%') {
                        let pct_part = &line[..pos];
                        if let Some(last_space) = pct_part.rfind(' ') {
                            let pct_str = &pct_part[last_space + 1..];
                            if let Ok(pct) = pct_str.trim().parse::<f64>() {
                                let mut active = active_jobs_clone.lock().unwrap();
                                if let Some(active_job) = active.get_mut(&job_id_clone) {
                                    active_job.job.downloaded_bytes = ((pct / 100.0) * active_job.job.total_bytes as f64) as u64;
                                }
                            }
                        }
                    }
                }
            }
        });

        // Wait for download to finish or be cancelled
        let status = tokio::select! {
            res = child.wait() => res,
            _ = token.cancelled() => {
                let _ = child.kill().await;
                info!("YouTube download cancelled for job {}", job.id);
                return;
            }
        };

        let mut final_job = {
            let active = self.active_jobs.lock().unwrap();
            active.get(&job.id).map(|a| a.job.clone()).unwrap_or(job)
        };

        match status {
            Ok(s) if s.success() => {
                final_job.status = JobStatus::Completed;
                final_job.speed = 0;
                final_job.eta = 0;
                final_job.downloaded_bytes = final_job.total_bytes;
                final_job.updated_at = chrono::Utc::now().timestamp_millis();
                db::update_job(&conn, &final_job).ok();
                self.ws_tx.send(WsEvent::JobStatus {
                    job_id: final_job.id.clone(),
                    status: JobStatus::Completed,
                    error: None,
                }).ok();
                send_native_notification("Download Completed", &format!("Successfully downloaded: {}", final_job.filename));
            }
            _ => {
                let err_msg = "yt-dlp exited with error".to_string();
                final_job.status = JobStatus::Failed;
                final_job.speed = 0;
                final_job.eta = -1;
                final_job.error = Some(err_msg.clone());
                final_job.updated_at = chrono::Utc::now().timestamp_millis();
                db::update_job(&conn, &final_job).ok();
                self.ws_tx.send(WsEvent::JobStatus {
                    job_id: final_job.id.clone(),
                    status: JobStatus::Failed,
                    error: Some(err_msg.clone()),
                }).ok();
                send_native_notification("Download Failed", &format!("yt-dlp failed for: {}", final_job.filename));
            }
        }

        {
            let mut active = self.active_jobs.lock().unwrap();
            active.remove(&final_job.id);
        }
        self.event_tx.send(ManagerEvent::ProcessQueue).await.ok();
    }

    async fn get_file_metadata(&self, url: &str, preferred_chunks: usize, preferred_filename: Option<&str>) -> Result<Metadata, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Client builder error: {}", e))?;

        let head_res = client.head(url).send().await;
        let response = match head_res {
            Ok(resp) if resp.status().is_success() => resp,
            _ => {
                // Fallback to GET
                client.get(url).send().await.map_err(|e| format!("GET request failed: {}", e))?
            }
        };

        let content_length = response.headers().get(CONTENT_LENGTH)
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let accept_ranges = response.headers().get(ACCEPT_RANGES)
            .and_then(|h| h.to_str().ok())
            .map(|s| s == "bytes")
            .unwrap_or(false) && content_length > 0;

        let content_type = response.headers().get(CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string());

        // Resolve filename
        let mut filename = preferred_filename.map(|s| s.to_string()).unwrap_or_default();
        
        if filename.is_empty() {
            if let Some(cd_header) = response.headers().get(CONTENT_DISPOSITION).and_then(|h| h.to_str().ok()) {
                if let Some(pos) = cd_header.find("filename=") {
                    let val = &cd_header[pos + 9..];
                    let val = val.trim_matches('"').trim_matches('\'');
                    if let Some(semi_pos) = val.find(';') {
                        filename = val[..semi_pos].to_string();
                    } else {
                        filename = val.to_string();
                    }
                }
            }
        }

        if filename.is_empty() {
            if let Ok(parsed) = reqwest::Url::parse(url) {
                if let Some(segments) = parsed.path_segments() {
                    if let Some(last) = segments.last() {
                        filename = percent_encoding::percent_decode_str(last).decode_utf8_lossy().to_string();
                    }
                }
            }
        }

        if filename.is_empty() || filename == "/" {
            filename = "download".to_string();
        }

        // Try MIME fallback for extension if missing
        if !filename.contains('.') {
            if let Some(ref mime_str) = content_type {
                if let Some(ext) = mime_guess::get_mime_extensions_str(mime_str).and_then(|exts| exts.first()) {
                    filename = format!("{}.{}", filename, ext);
                }
            }
        }

        let mut chunks = Vec::new();
        if accept_ranges && content_length > 0 {
            let num_chunks = std::cmp::min(preferred_chunks, content_length as usize);
            let chunk_size = content_length / num_chunks as u64;
            for i in 0..num_chunks {
                let start = i as u64 * chunk_size;
                let end = if i == num_chunks - 1 { content_length - 1 } else { start + chunk_size - 1 };
                chunks.push(ChunkInfo {
                    index: i,
                    start,
                    end,
                    downloaded: 0,
                    status: ChunkStatus::Pending,
                });
            }
        } else {
            chunks.push(ChunkInfo {
                index: 0,
                start: 0,
                end: if content_length > 0 { content_length - 1 } else { 0 },
                downloaded: 0,
                status: ChunkStatus::Pending,
            });
        }

        Ok(Metadata {
            filename,
            total_bytes: content_length,
            accept_ranges,
            chunks,
        })
    }

    async fn get_youtube_metadata(&self, url: &str) -> Result<Metadata, String> {
        let exe_path = ensure_yt_dlp_downloaded().await?;
        let output = tokio::process::Command::new(&exe_path)
            .args(&["--dump-json", url])
            .output()
            .await
            .map_err(|e| format!("yt-dlp not found or failed: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

        let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("youtube_video");
        let ext = parsed.get("ext").and_then(|v| v.as_str()).unwrap_or("mp4");
        let filename = format!("{}.{}", title.replace("/", "_"), ext);

        // Fetch filesize estimate
        let filesize = parsed.get("filesize")
            .and_then(|v| v.as_u64())
            .or_else(|| parsed.get("filesize_approx").and_then(|v| v.as_u64()))
            .unwrap_or(0);

        let chunks = vec![ChunkInfo {
            index: 0,
            start: 0,
            end: if filesize > 0 { filesize - 1 } else { 0 },
            downloaded: 0,
            status: ChunkStatus::Pending,
        }];

        Ok(Metadata {
            filename,
            total_bytes: filesize,
            accept_ranges: false,
            chunks,
        })
    }
}

struct Metadata {
    filename: String,
    total_bytes: u64,
    accept_ranges: bool,
    chunks: Vec<ChunkInfo>,
}

fn resolve_filename_collision(destination: &str, filename: &str) -> String {
    let mut path = Path::new(destination).join(filename);
    if !path.exists() {
        return filename.to_string();
    }

    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_else(String::new);

    let mut counter = 1;
    loop {
        let new_filename = format!("{}({}){}", stem, counter, ext);
        path = Path::new(destination).join(&new_filename);
        if !path.exists() {
            return new_filename;
        }
        counter += 1;
    }
}

async fn download_chunk(
    url: String,
    mut chunk: ChunkInfo,
    dest_path: PathBuf,
    progress_tx: mpsc::Sender<(usize, u64)>,
    token: CancellationToken,
    speed_limit: Arc<std::sync::atomic::AtomicU64>,
    total_chunks: usize,
) -> Result<ChunkInfo, String> {
    let start = chunk.start + chunk.downloaded;
    
    if chunk.end > 0 && start > chunk.end {
        chunk.status = ChunkStatus::Done;
        return Ok(chunk);
    }

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).await.ok();
    }

    let client = reqwest::Client::new();
    let mut request = client.get(&url);
    if chunk.end > 0 {
        request = request.header("Range", format!("bytes={}-{}", start, chunk.end));
    }

    let response = request.send().await.map_err(|e| format!("Request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Server returned error status: {}", response.status()));
    }

    let is_partial = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = if is_partial && chunk.downloaded > 0 {
        fs::OpenOptions::new().create(true).write(true).append(true).open(&dest_path).await
    } else {
        if !is_partial && chunk.downloaded > 0 {
            chunk.downloaded = 0;
        }
        fs::File::create(&dest_path).await
    }.map_err(|e| format!("Failed to open part file: {}", e))?;

    let mut stream = response.bytes_stream();
    chunk.status = ChunkStatus::Downloading;

    use futures_util::StreamExt;
    
    let mut last_read_time = std::time::Instant::now();
    
    while let Some(chunk_res) = stream.next().await {
        if token.is_cancelled() {
            return Err("aborted".to_string());
        }

        let bytes = chunk_res.map_err(|e| format!("Stream error: {}", e))?;
        file.write_all(&bytes).await.map_err(|e| format!("Write failed: {}", e))?;
        
        let byte_len = bytes.len() as u64;
        progress_tx.send((chunk.index, byte_len)).await.ok();

        // Speed-limiting throttling
        let limit = speed_limit.load(std::sync::atomic::Ordering::Relaxed);
        if limit > 0 {
            // Distribute the total limit across all chunks
            let chunk_limit = limit / (total_chunks as u64);
            if chunk_limit > 0 {
                let elapsed = last_read_time.elapsed();
                let target_duration = std::time::Duration::from_secs_f64(byte_len as f64 / chunk_limit as f64);
                if elapsed < target_duration {
                    tokio::time::sleep(target_duration - elapsed).await;
                }
            }
        }
        last_read_time = std::time::Instant::now();
    }

    chunk.status = ChunkStatus::Done;
    Ok(chunk)
}

async fn merge_chunks(part_paths: Vec<PathBuf>, dest_path: &Path, tmp_dir: &Path) -> Result<(), String> {
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).await.ok();
    }

    let mut dest_file = fs::File::create(dest_path).await.map_err(|e| format!("Failed to create merge destination: {}", e))?;

    for part_path in part_paths {
        if !part_path.exists() {
            return Err(format!("Part file missing: {}", part_path.display()));
        }

        let mut part_file = fs::File::open(&part_path).await.map_err(|e| format!("Failed to open part file: {}", e))?;
        let mut buffer = vec![0u8; 64 * 1024]; // 64KB buffer
        
        loop {
            let bytes_read = part_file.read(&mut buffer).await.map_err(|e| format!("Read failed from part: {}", e))?;
            if bytes_read == 0 {
                break;
            }
            dest_file.write_all(&buffer[..bytes_read]).await.map_err(|e| format!("Write failed to merge: {}", e))?;
        }
    }

    // Clean up temporary files and folder
    if tmp_dir.exists() {
        fs::remove_dir_all(tmp_dir).await.ok();
    }

    Ok(())
}

fn send_native_notification(title: &str, body: &str) {
    if let Err(e) = notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .appname("grabr-desktop")
        .icon("dialog-information")
        .timeout(5000)
        .show()
    {
        tracing::error!("Failed to send desktop notification: {}", e);
    }
}

pub fn check_system_yt_dlp() -> bool {
    #[cfg(unix)]
    let cmd = "which";
    #[cfg(unix)]
    let args = &["yt-dlp"];

    #[cfg(windows)]
    let cmd = "where";
    #[cfg(windows)]
    let args = &["yt-dlp"];

    std::process::Command::new(cmd)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn get_yt_dlp_executable_path() -> Result<PathBuf, String> {
    if check_system_yt_dlp() {
        #[cfg(windows)]
        return Ok(PathBuf::from("yt-dlp.exe"));
        #[cfg(not(windows))]
        return Ok(PathBuf::from("yt-dlp"));
    }

    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let grabr_dir = home.join(".grabr");

    #[cfg(target_os = "windows")]
    let exe_name = "yt-dlp.exe";
    #[cfg(target_os = "macos")]
    let exe_name = "yt-dlp_macos";
    #[cfg(target_os = "linux")]
    let exe_name = "yt-dlp";

    Ok(grabr_dir.join(exe_name))
}

pub async fn ensure_yt_dlp_downloaded() -> Result<PathBuf, String> {
    let exe_path = get_yt_dlp_executable_path()?;
    if !exe_path.exists() && exe_path.is_absolute() {
        #[cfg(target_os = "windows")]
        let download_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        #[cfg(target_os = "macos")]
        let download_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
        #[cfg(target_os = "linux")]
        let download_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

        if let Some(parent) = exe_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let client = reqwest::Client::new();
        let resp = client.get(download_url).send().await
            .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

        let bytes = resp.bytes().await
            .map_err(|e| format!("Failed to read stream: {}", e))?;

        std::fs::write(&exe_path, bytes)
            .map_err(|e| format!("Failed to write binary: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&exe_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&exe_path, perms).ok();
            }
        }
    }
    Ok(exe_path)
}
