use eframe::egui;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::info;

use crate::db;
use crate::downloader::{DownloadManager, WsEvent};
use crate::tray::{TrayManager, TrayAction};
use crate::types::{ChunkInfo, DownloadJob, JobStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    All,
    Downloading,
    Completed,
    Settings,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct YtFormat {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
    pub height: Option<u32>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub format_note: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub url: String,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct YtVideoInfo {
    pub title: String,
    pub formats: Vec<YtFormat>,
}

pub enum GuiUpdateEvent {
    SyncJobs {
        jobs: Vec<DownloadJob>,
    },
    JobProgress {
        job_id: String,
        downloaded_bytes: u64,
        total_bytes: u64,
        speed: u64,
        eta: i64,
        chunks: Vec<ChunkInfo>,
    },
    JobStatus {
        job_id: String,
        status: JobStatus,
        error: Option<String>,
    },
    JobAdded {
        job: DownloadJob,
    },
    JobRemoved {
        job_id: String,
    },
    JobsCleared,
    YtFormatsFetched {
        video_info: YtVideoInfo,
    },
    YtFormatsFailed {
        error: String,
    },
}

pub struct GrabrApp {
    jobs: Vec<DownloadJob>,
    db_path: PathBuf,
    manager: Arc<DownloadManager>,
    rx: std::sync::mpsc::Receiver<GuiUpdateEvent>,
    tx_gui: std::sync::mpsc::Sender<GuiUpdateEvent>,
    tray_manager: TrayManager,
    show_window: bool,
    speed_limits: HashMap<String, f32>,
    current_tab: Tab,
    search_query: String,

    // Settings edit state
    output_dir_edit: String,
    max_concurrent_edit: usize,
    default_chunks_edit: usize,
    server_port_edit: u16,
    settings_saved: bool,

    // Proposed UI details
    speed_history: HashMap<String, Vec<f64>>,
    total_speed_history: Vec<f64>, // Teal overall speed history
    show_add_url_modal: bool,
    add_url_input: String,
    
    // Daemon connection status polling
    daemon_connected: Arc<AtomicBool>,

    // YouTube state
    yt_loading: bool,
    yt_video_info: Option<YtVideoInfo>,
    yt_selected_format_idx: Option<usize>,
    yt_error: Option<String>,
}

impl GrabrApp {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        db_path: PathBuf,
        manager: Arc<DownloadManager>,
        show_window: bool,
    ) -> Self {
        // Load initial list from database
        let conn = db::init_db(&db_path).expect("Failed to initialize database for GUI");
        let jobs = db::list_jobs(&conn).unwrap_or_default();

        let (tx, rx) = std::sync::mpsc::channel();
        let tx_gui = tx.clone();
        let mut ws_rx = manager.ws_sender().subscribe();

        // Forward manager broadcast events to GUI main loop channel & trigger instantaneous repaints
        let tx_clone = tx.clone();
        let ctx_clone = cc.egui_ctx.clone();
        tokio::spawn(async move {
            while let Ok(event) = ws_rx.recv().await {
                let gui_event = match event {
                    WsEvent::JobProgress {
                        job_id,
                        downloaded_bytes,
                        total_bytes,
                        speed,
                        eta,
                        chunks,
                    } => GuiUpdateEvent::JobProgress {
                        job_id,
                        downloaded_bytes,
                        total_bytes,
                        speed,
                        eta,
                        chunks,
                    },
                    WsEvent::JobStatus {
                        job_id,
                        status,
                        error,
                    } => GuiUpdateEvent::JobStatus {
                        job_id,
                        status,
                        error,
                    },
                    WsEvent::JobAdded { job } => GuiUpdateEvent::JobAdded { job },
                    WsEvent::JobRemoved { job_id } => GuiUpdateEvent::JobRemoved { job_id },
                    WsEvent::JobsCleared => GuiUpdateEvent::JobsCleared,
                };
                tx_clone.send(gui_event).ok();
                ctx_clone.request_repaint(); // Wake up GUI thread
            }
        });

        // Set premium monochromatic graphite styling with Amber accents
        let mut visuals = egui::Visuals::dark();
        visuals.widgets.active.bg_fill = egui::Color32::from_rgb(245, 158, 11); // Amber accent
        visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(245, 158, 11); // Glowing Amber Hover
        visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, egui::Color32::BLACK); // Dark text on hover
        visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(28, 29, 38); // Graphite button background
        visuals.widgets.inactive.rounding = egui::Rounding::same(6.0);
        visuals.widgets.hovered.rounding = egui::Rounding::same(6.0);
        visuals.widgets.active.rounding = egui::Rounding::same(6.0);
        visuals.window_fill = egui::Color32::from_rgb(14, 15, 20); // Dark carbon black
        visuals.panel_fill = egui::Color32::from_rgb(20, 21, 28); // Sidebar graphite
        cc.egui_ctx.set_visuals(visuals);

        // Load custom premium developer typography (Operator Mono)
        let mut fonts = egui::FontDefinitions::default();
        fonts.font_data.insert(
            "operator_mono".to_owned(),
            egui::FontData::from_static(include_bytes!(
                "../../src/assets/OperatorMonoLig-Book.otf"
            )),
        );
        fonts.families.get_mut(&egui::FontFamily::Proportional).unwrap()
            .insert(0, "operator_mono".to_owned());
        fonts.families.get_mut(&egui::FontFamily::Monospace).unwrap()
            .insert(0, "operator_mono".to_owned());

        // Check for Arabic-compatible system fonts and register them as fallback at index 1
        let arabic_font_paths = [
            "/usr/share/fonts/google-droid-sans-fonts/DroidKufi-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ];

        for path in arabic_font_paths.iter() {
            if std::path::Path::new(path).exists() {
                if let Ok(font_bytes) = std::fs::read(path) {
                    fonts.font_data.insert(
                        "arabic_fallback".to_owned(),
                        egui::FontData::from_owned(font_bytes)
                    );
                    fonts.families.get_mut(&egui::FontFamily::Proportional).unwrap()
                        .insert(1, "arabic_fallback".to_owned());
                    fonts.families.get_mut(&egui::FontFamily::Monospace).unwrap()
                        .insert(1, "arabic_fallback".to_owned());
                    info!("Successfully loaded Arabic fallback font from: {}", path);
                    break;
                }
            }
        }

        cc.egui_ctx.set_fonts(fonts);

        // Build Tray manager
        let tray_manager = TrayManager::new();
        let config = manager.get_config();

        // Asynchronously poll local server port for daemon status
        let daemon_connected = Arc::new(AtomicBool::new(false));
        let daemon_connected_clone = daemon_connected.clone();
        let port = config.server_port;
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                let url = format!("http://127.0.0.1:{}/api/version", port);
                let connected = match client.get(&url).timeout(std::time::Duration::from_millis(600)).send().await {
                    Ok(resp) => resp.status().is_success(),
                    Err(_) => false,
                };
                daemon_connected_clone.store(connected, Ordering::Relaxed);
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        });

        // Sync with external daemon if it runs on 7474
        let tx_ws = tx.clone();
        let ctx_ws = cc.egui_ctx.clone();
        let daemon_connected_ws = daemon_connected.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                if daemon_connected_ws.load(Ordering::Relaxed) {
                    let ws_url = format!("ws://127.0.0.1:{}/ws", port);
                    if let Ok((ws_stream, _)) = tokio_tungstenite::connect_async(&ws_url).await {
                        info!("Successfully connected to external Grabr daemon WebSocket at {}", ws_url);
                        
                        // Fetch current state from daemon API to bootstrap the UI
                        let jobs_url = format!("http://127.0.0.1:{}/api/jobs", port);
                        if let Ok(resp) = client.get(&jobs_url).send().await {
                            if let Ok(synced_jobs) = resp.json::<Vec<DownloadJob>>().await {
                                tx_ws.send(GuiUpdateEvent::SyncJobs { jobs: synced_jobs }).ok();
                                ctx_ws.request_repaint();
                            }
                        }
                        
                        use futures_util::StreamExt;
                        let (_, mut read) = ws_stream.split();
                        while let Some(Ok(msg)) = read.next().await {
                            if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
                                if let Ok(event) = serde_json::from_str::<WsEvent>(&text) {
                                    let gui_event = match event {
                                        WsEvent::JobProgress {
                                            job_id,
                                            downloaded_bytes,
                                            total_bytes,
                                            speed,
                                            eta,
                                            chunks,
                                        } => GuiUpdateEvent::JobProgress {
                                            job_id,
                                            downloaded_bytes,
                                            total_bytes,
                                            speed,
                                            eta,
                                            chunks,
                                        },
                                        WsEvent::JobStatus {
                                            job_id,
                                            status,
                                            error,
                                        } => GuiUpdateEvent::JobStatus {
                                            job_id,
                                            status,
                                            error,
                                        },
                                        WsEvent::JobAdded { job } => GuiUpdateEvent::JobAdded { job },
                                        WsEvent::JobRemoved { job_id } => GuiUpdateEvent::JobRemoved { job_id },
                                        WsEvent::JobsCleared => GuiUpdateEvent::JobsCleared,
                                    };
                                    tx_ws.send(gui_event).ok();
                                    ctx_ws.request_repaint();
                                }
                            }
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        });

        Self {
            jobs,
            db_path,
            manager,
            rx,
            tx_gui,
            tray_manager,
            show_window,
            speed_limits: HashMap::new(),
            current_tab: Tab::All,
            search_query: String::new(),
            output_dir_edit: config.output_dir.clone(),
            max_concurrent_edit: config.max_concurrent,
            default_chunks_edit: config.default_chunks,
            server_port_edit: config.server_port,
            settings_saved: false,
            speed_history: HashMap::new(),
            total_speed_history: Vec::new(),
            show_add_url_modal: false,
            add_url_input: String::new(),
            daemon_connected,
            yt_loading: false,
            yt_video_info: None,
            yt_selected_format_idx: None,
            yt_error: None,
        }
    }

    fn run_action(
        &self,
        f_local: impl FnOnce() -> Result<(), String> + Send + 'static,
        method: &'static str,
        path: String,
        body: Option<serde_json::Value>,
    ) {
        let daemon_running = self.daemon_connected.load(Ordering::Relaxed);
        if daemon_running {
            let port = self.manager.get_config().server_port;
            let url = format!("http://127.0.0.1:{}{}", port, path);
            tokio::spawn(async move {
                let client = reqwest::Client::new();
                let mut req = match method {
                    "POST" => client.post(&url),
                    "DELETE" => client.delete(&url),
                    _ => client.post(&url),
                };
                if let Some(b) = body {
                    req = req.json(&b);
                }
                req.send().await.ok();
            });
        } else {
            tokio::spawn(async move {
                f_local().ok();
            });
        }
    }
}

impl eframe::App for GrabrApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Poll for tray events
        if let Some(action) = self.tray_manager.poll_event() {
            match action {
                TrayAction::Open => {
                    self.show_window = true;
                    ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                    ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(false));
                    ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
                }
                TrayAction::PauseAll => {
                    let mgr = self.manager.clone();
                    self.run_action(
                        move || {
                            let rt = tokio::runtime::Handle::current();
                            rt.block_on(async { mgr.pause_all().await })
                        },
                        "POST",
                        "/api/jobs/pause-all".to_string(),
                        None,
                    );
                }
                TrayAction::Quit => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    std::process::exit(0);
                }
            }
        }

        // Handle window close event
        if ctx.input(|i| i.viewport().close_requested()) {
            std::process::exit(0);
        }

        // Process incoming download events to keep list up to date
        let mut got_update = false;
        let mut got_progress = false;
        while let Ok(event) = self.rx.try_recv() {
            got_update = true;
            match event {
                GuiUpdateEvent::SyncJobs { jobs } => {
                    self.jobs = jobs;
                }
                GuiUpdateEvent::JobAdded { job } => {
                    self.jobs.insert(0, job);
                }
                GuiUpdateEvent::JobProgress {
                    job_id,
                    downloaded_bytes,
                    total_bytes,
                    speed,
                    eta,
                    chunks,
                } => {
                    got_progress = true;
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
                        job.downloaded_bytes = downloaded_bytes;
                        job.total_bytes = total_bytes;
                        job.speed = speed;
                        job.eta = eta;
                        job.chunks = chunks;

                        // Store speed readings history for Sparkline rendering (max 20 points)
                        let history = self.speed_history.entry(job_id.clone()).or_insert_with(Vec::new);
                        history.push(speed as f64);
                        if history.len() > 20 {
                            history.remove(0);
                        }
                    }
                }
                GuiUpdateEvent::JobStatus {
                    job_id,
                    status,
                    error,
                } => {
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
                        job.status = status;
                        job.error = error;

                        if status == JobStatus::Downloading {
                            if let Some(limit) = self.speed_limits.get(&job_id) {
                                let limit_bytes = (*limit * 1024.0 * 1024.0) as u64;
                                self.manager.set_speed_limit(&job_id, limit_bytes);
                            }
                        }
                    }
                }
                GuiUpdateEvent::JobRemoved { job_id } => {
                    self.jobs.retain(|j| j.id != job_id);
                    self.speed_history.remove(&job_id);
                }
                GuiUpdateEvent::JobsCleared => {
                    self.jobs.retain(|j| j.status != JobStatus::Completed);
                }
                GuiUpdateEvent::YtFormatsFetched { video_info } => {
                    self.yt_video_info = Some(video_info);
                    self.yt_loading = false;
                    self.yt_selected_format_idx = Some(0);
                    self.yt_error = None;
                }
                GuiUpdateEvent::YtFormatsFailed { error } => {
                    self.yt_error = Some(error);
                    self.yt_loading = false;
                    self.yt_video_info = None;
                }
            }
        }

        // Calculate and push total overall bandwidth speed to teal history chart
        if got_progress {
            let total_speed: u64 = self.jobs.iter()
                .filter(|j| j.status == JobStatus::Downloading)
                .map(|j| j.speed)
                .sum();
            self.total_speed_history.push(total_speed as f64);
            if self.total_speed_history.len() > 100 {
                self.total_speed_history.remove(0);
            }
        }

        if got_update {
            ctx.request_repaint();
        }

        // snappier paint schedules during active downloads (keeps stats moving smoothly every 500ms)
        let is_any_downloading = self.jobs.iter().any(|j| j.status == JobStatus::Downloading);
        if is_any_downloading {
            ctx.request_repaint_after(std::time::Duration::from_millis(500));
        }

        if !self.show_window {
            return;
        }

        // Add URL Modal (wider default settings layout)
        if self.show_add_url_modal {
            egui::Window::new("Add New Download")
                .collapsible(false)
                .resizable(false)
                .default_width(520.0)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.add_space(8.0);
                    ui.label(
                        egui::RichText::new("Paste file, stream, or YouTube URL:")
                            .color(egui::Color32::from_rgb(245, 158, 11)) // Amber
                            .strong()
                    );
                    ui.add(
                        egui::TextEdit::singleline(&mut self.add_url_input)
                            .desired_width(ui.available_width() - 8.0)
                            .margin(egui::Margin::symmetric(8.0, 6.0))
                    );
                    
                    let url = self.add_url_input.trim().to_string();
                    let is_youtube = url.contains("youtube.com/") || url.contains("youtu.be/");

                    if is_youtube {
                        ui.add_space(10.0);
                        ui.horizontal(|ui| {
                            if ui.button("Analyze YouTube Link").clicked() && !self.yt_loading {
                                self.yt_loading = true;
                                self.yt_error = None;
                                self.yt_video_info = None;
                                
                                let tx = self.tx_gui.clone();
                                let url_str = url.clone();
                                tokio::spawn(async move {
                                    // 1. Resolve yt-dlp path (local cache or system PATH)
                                    let exe_path = match get_yt_dlp_executable_path() {
                                        Ok(path) => path,
                                        Err(e) => {
                                            tx.send(GuiUpdateEvent::YtFormatsFailed { error: e }).ok();
                                            return;
                                        }
                                    };

                                    // 2. Download yt-dlp binary if missing locally
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
                                        let resp = match client.get(download_url).send().await {
                                            Ok(r) => r,
                                            Err(e) => {
                                                tx.send(GuiUpdateEvent::YtFormatsFailed { error: format!("Failed to download yt-dlp: {}", e) }).ok();
                                                return;
                                            }
                                        };

                                        let bytes = match resp.bytes().await {
                                            Ok(b) => b,
                                            Err(e) => {
                                                tx.send(GuiUpdateEvent::YtFormatsFailed { error: format!("Failed to read stream: {}", e) }).ok();
                                                return;
                                            }
                                        };

                                        if let Err(e) = std::fs::write(&exe_path, bytes) {
                                            tx.send(GuiUpdateEvent::YtFormatsFailed { error: format!("Failed to write binary: {}", e) }).ok();
                                            return;
                                        }

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

                                    // 3. Execute
                                    let output = tokio::process::Command::new(&exe_path)
                                        .arg("-j")
                                        .arg(&url_str)
                                        .output()
                                        .await;
                                    
                                    match output {
                                        Ok(out) if out.status.success() => {
                                            if let Ok(info) = serde_json::from_slice::<YtVideoInfo>(&out.stdout) {
                                                tx.send(GuiUpdateEvent::YtFormatsFetched { video_info: info }).ok();
                                            } else {
                                                tx.send(GuiUpdateEvent::YtFormatsFailed { error: "Failed to parse YouTube JSON".to_string() }).ok();
                                            }
                                        }
                                        Ok(out) => {
                                            let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                                            tx.send(GuiUpdateEvent::YtFormatsFailed { error: format!("yt-dlp error: {}", err_msg) }).ok();
                                        }
                                        Err(e) => {
                                            tx.send(GuiUpdateEvent::YtFormatsFailed { error: format!("Failed to run yt-dlp: {}", e) }).ok();
                                        }
                                    }
                                });
                            }

                            if self.yt_loading {
                                ui.label("Analyzing video metadata...");
                            }
                        });

                        if let Some(err) = &self.yt_error {
                            ui.add_space(6.0);
                            ui.label(egui::RichText::new(format!("Error: {}", err)).color(egui::Color32::from_rgb(239, 68, 68)));
                        }

                        if let Some(info) = &self.yt_video_info {
                            ui.add_space(10.0);
                            ui.separator();
                            ui.add_space(8.0);
                            
                            ui.label(
                                egui::RichText::new("Video Title:")
                                    .color(egui::Color32::from_rgb(245, 158, 11)) // Amber
                                    .strong()
                            );
                            ui.label(egui::RichText::new(&info.title).color(egui::Color32::WHITE));
                            ui.add_space(8.0);

                            // Filter to formats that contain both video and audio streams
                            let mut combined_formats: Vec<&YtFormat> = info.formats.iter()
                                .filter(|f| {
                                    let v_ok = f.vcodec.as_ref().map(|s| s != "none" && !s.is_empty()).unwrap_or(false);
                                    let a_ok = f.acodec.as_ref().map(|s| s != "none" && !s.is_empty()).unwrap_or(false);
                                    v_ok && a_ok
                                })
                                .collect();

                            // Sort by resolution height descending (highest quality/HD first)
                            combined_formats.sort_by(|a, b| {
                                let a_h = a.height.unwrap_or(0);
                                let b_h = b.height.unwrap_or(0);
                                b_h.cmp(&a_h)
                            });

                            if combined_formats.is_empty() {
                                ui.label(egui::RichText::new("No direct combined (video+audio) formats found.").color(egui::Color32::from_rgb(245, 158, 11)));
                            } else {
                                ui.label(
                                    egui::RichText::new("Choose Format:")
                                        .color(egui::Color32::from_rgb(245, 158, 11)) // Amber
                                        .strong()
                                );
                                let current_selection = self.yt_selected_format_idx.unwrap_or(0);
                                
                                egui::ComboBox::from_id_source("yt_format_selector")
                                    .selected_text(
                                        combined_formats.get(current_selection)
                                            .map(|f| format!("{} ({}p) - {}", f.ext, f.resolution.as_deref().unwrap_or(""), f.format_note.as_deref().unwrap_or("")))
                                            .unwrap_or_else(|| "Select Format".to_string())
                                    )
                                    .show_ui(ui, |ui| {
                                        for (i, f) in combined_formats.iter().enumerate() {
                                            ui.selectable_value(
                                                &mut self.yt_selected_format_idx,
                                                Some(i),
                                                format!("{} ({}p) - {}", f.ext, f.resolution.as_deref().unwrap_or(""), f.format_note.as_deref().unwrap_or(""))
                                            );
                                        }
                                    });
                            }
                        }
                    }

                    ui.add_space(14.0);
                    ui.horizontal(|ui| {
                        let can_download = !url.is_empty() && (!is_youtube || self.yt_video_info.is_some());
                        let download_btn = ui.add_enabled(
                            can_download,
                            egui::Button::new(egui::RichText::new("Download").strong())
                                .fill(if can_download { egui::Color32::from_rgb(245, 158, 11) } else { egui::Color32::from_rgb(28, 29, 38) })
                        );

                        if download_btn.clicked() {
                            let mgr = self.manager.clone();
                            if is_youtube {
                                if let Some(info) = &self.yt_video_info {
                                    let mut combined_formats: Vec<&YtFormat> = info.formats.iter()
                                        .filter(|f| {
                                            let v_ok = f.vcodec.as_ref().map(|s| s != "none" && !s.is_empty()).unwrap_or(false);
                                            let a_ok = f.acodec.as_ref().map(|s| s != "none" && !s.is_empty()).unwrap_or(false);
                                            v_ok && a_ok
                                        })
                                        .collect();
                                        
                                    // Sort by resolution height descending (highest quality/HD first)
                                    combined_formats.sort_by(|a, b| {
                                        let a_h = a.height.unwrap_or(0);
                                        let b_h = b.height.unwrap_or(0);
                                        b_h.cmp(&a_h)
                                    });

                                    let selected_idx = self.yt_selected_format_idx.unwrap_or(0);
                                    if let Some(format) = combined_formats.get(selected_idx) {
                                        let direct_url = format.url.clone();
                                        let clean_title = info.title.chars()
                                            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
                                            .collect::<String>();
                                        let filename = format!("{}.{}", clean_title.trim(), format.ext);
                                        
                                        let opts = crate::types::DownloadOptions {
                                            output_dir: None,
                                            filename: Some(filename),
                                            chunks: None,
                                        };
                                        let body_opts = opts.clone();
                                        let direct_url_body = direct_url.clone();
                                        self.run_action(
                                            move || {
                                                let rt = tokio::runtime::Handle::current();
                                                rt.block_on(async { mgr.add_job(&direct_url, opts).await.map(|_| ()) })
                                            },
                                            "POST",
                                            "/api/jobs".to_string(),
                                            Some(serde_json::json!({
                                                "url": direct_url_body,
                                                "options": body_opts
                                            })),
                                        );
                                    }
                                }
                            } else {
                                let opts = crate::types::DownloadOptions {
                                    output_dir: None,
                                    filename: None,
                                    chunks: None,
                                };
                                let body_opts = opts.clone();
                                let url_body = url.clone();
                                self.run_action(
                                    move || {
                                        let rt = tokio::runtime::Handle::current();
                                        rt.block_on(async { mgr.add_job(&url, opts).await.map(|_| ()) })
                                    },
                                    "POST",
                                    "/api/jobs".to_string(),
                                    Some(serde_json::json!({
                                        "url": url_body,
                                        "options": body_opts
                                    })),
                                );
                            }
                            
                            // Reset state
                            self.add_url_input.clear();
                            self.yt_video_info = None;
                            self.yt_selected_format_idx = None;
                            self.yt_error = None;
                            self.yt_loading = false;
                            self.show_add_url_modal = false;
                        }

                        if ui.button("Cancel").clicked() {
                            self.add_url_input.clear();
                            self.yt_video_info = None;
                            self.yt_selected_format_idx = None;
                            self.yt_error = None;
                            self.yt_loading = false;
                            self.show_add_url_modal = false;
                        }
                    });
                });
        }

        // 1. Sidebar Panel
        egui::SidePanel::left("sidebar")
            .resizable(false)
            .default_width(170.0)
            .show(ctx, |ui| {
                ui.add_space(24.0);

                // Proposed Sidebar Logo Header (no emojis, Amber accent)
                ui.vertical_centered(|ui| {
                    ui.label(
                        egui::RichText::new("GRABR")
                            .color(egui::Color32::from_rgb(245, 158, 11)) // Cyberpunk Amber
                            .strong()
                            .size(19.0),
                    );
                    ui.label(
                        egui::RichText::new("DESKTOP")
                            .color(egui::Color32::WHITE)
                            .strong()
                            .size(11.0),
                    );
                });

                ui.add_space(28.0);
                
                // Section Navigation Label
                ui.horizontal(|ui| {
                    ui.add_space(10.0);
                    ui.label(
                        egui::RichText::new("NAVIGATION")
                            .color(egui::Color32::from_rgb(100, 116, 139))
                            .size(10.0)
                            .strong()
                    );
                });
                
                ui.add_space(8.0);

                // Proposed Navigation items (no unicode emoji, Amber highlight)
                let tabs = [
                    (Tab::All, "  ALL"),
                    (Tab::Downloading, "  ACTIVE"),
                    (Tab::Completed, "  COMPLETED"),
                    (Tab::Settings, "  SETTINGS"),
                ];

                for &(tab, label) in &tabs {
                    let is_selected = self.current_tab == tab;
                    let text = egui::RichText::new(label)
                        .size(12.0)
                        .color(if is_selected {
                            egui::Color32::from_rgb(245, 158, 11) // Amber active text
                        } else {
                            egui::Color32::from_rgb(148, 163, 184)
                        });

                    let btn = ui.add_sized(
                        [ui.available_width(), 32.0],
                        egui::SelectableLabel::new(is_selected, text)
                    );

                    let rect = btn.rect;
                    if is_selected {
                        ui.painter().line_segment(
                            [rect.left_top() + egui::vec2(2.0, 4.0), rect.left_bottom() + egui::vec2(2.0, -4.0)],
                            egui::Stroke::new(3.0, egui::Color32::from_rgb(245, 158, 11))
                        );
                    }

                    if btn.clicked() {
                        self.current_tab = tab;
                        self.settings_saved = false;
                    }
                    ui.add_space(4.0);
                }
            });

        // 2. Main Central Panel
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.add_space(14.0); // Spacing above top header

            // Top Header: Title & Subtitle vs Primary Action
            let mut total_speed: u64 = 0;
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.heading(
                        egui::RichText::new("Current Downloads")
                            .color(egui::Color32::WHITE)
                            .strong()
                    );
                    
                    let active_count = self.jobs.iter().filter(|j| j.status == JobStatus::Downloading || j.status == JobStatus::Queued).count();
                    total_speed = self.jobs.iter().filter(|j| j.status == JobStatus::Downloading).map(|j| j.speed).sum();
                    
                    ui.label(
                        egui::RichText::new(format!("{} Files - {}", active_count, format_speed(total_speed)))
                            .color(egui::Color32::from_rgb(148, 163, 184))
                            .size(11.0)
                    );
                });

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Add URL").clicked() {
                        self.show_add_url_modal = true;
                    }
                });
            });

            ui.add_space(10.0);

            // Row 2: Control Toolbar (responsive, wrapped layout)
            ui.horizontal(|ui| {
                if self.current_tab != Tab::Settings {
                    // Search bar
                    ui.add(
                        egui::TextEdit::singleline(&mut self.search_query)
                            .hint_text("Search downloads...")
                            .desired_width(180.0)
                            .margin(egui::Margin::symmetric(8.0, 5.0))
                    );
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Pause All").clicked() {
                        let mgr = self.manager.clone();
                        self.run_action(
                            move || {
                                let rt = tokio::runtime::Handle::current();
                                rt.block_on(async { mgr.pause_all().await })
                            },
                            "POST",
                            "/api/jobs/pause-all".to_string(),
                            None,
                        );
                    }
                    ui.add_space(4.0);
                    if ui.button("Resume All").clicked() {
                        let mgr = self.manager.clone();
                        self.run_action(
                            move || {
                                let rt = tokio::runtime::Handle::current();
                                rt.block_on(async { mgr.resume_all().await })
                            },
                            "POST",
                            "/api/jobs/resume-all".to_string(),
                            None,
                        );
                    }
                    if self.current_tab != Tab::Settings {
                        ui.add_space(4.0);
                        if ui.button("Clear Completed").clicked() {
                            let mgr = self.manager.clone();
                            self.run_action(
                                move || {
                                    let rt = tokio::runtime::Handle::current();
                                    rt.block_on(async { mgr.clear_completed().await })
                                },
                                "POST",
                                "/api/jobs/clear-completed".to_string(),
                                None,
                            );
                        }
                    }
                });
            });

            ui.add_space(10.0);
            ui.separator();
            ui.add_space(10.0);

            // Render view depending on the selected tab
            match self.current_tab {
                Tab::Settings => {
                    self.draw_settings_tab(ui);
                }
                _ => {
                    self.draw_jobs_list_view(ui, total_speed);
                }
            }
        });
    }
}

impl GrabrApp {
    fn draw_settings_tab(&mut self, ui: &mut egui::Ui) {
        ui.vertical(|ui| {
            ui.add_space(4.0);
            
            // Section 1: Output Location
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28))
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(38, 39, 48)))
                .rounding(6.0)
                .inner_margin(12.0)
                .show(ui, |ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("Storage Settings").strong().color(egui::Color32::WHITE));
                        ui.add_space(4.0);
                        ui.label(egui::RichText::new("Configure where downloaded chunks and completed files are stored.").size(10.5).color(egui::Color32::from_rgb(148, 163, 184)));
                        ui.add_space(8.0);
                        
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("Default Output Folder:").size(11.5));
                            ui.add(egui::TextEdit::singleline(&mut self.output_dir_edit).desired_width(280.0));
                        });
                    });
                });
                
            ui.add_space(10.0);
            
            // Section 2: Concurrency and pacing
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28))
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(38, 39, 48)))
                .rounding(6.0)
                .inner_margin(12.0)
                .show(ui, |ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("Queue & Pacing").strong().color(egui::Color32::WHITE));
                        ui.add_space(4.0);
                        ui.label(egui::RichText::new("Tweak concurrency limits and chunk sizes to optimize network bandwidth.").size(10.5).color(egui::Color32::from_rgb(148, 163, 184)));
                        ui.add_space(8.0);
                        
                        egui::Grid::new("queue_settings_grid")
                            .spacing([12.0, 10.0])
                            .show(ui, |ui| {
                                ui.label("Max Concurrent Downloads:");
                                ui.add(egui::DragValue::new(&mut self.max_concurrent_edit).range(1..=10));
                                ui.end_row();
                                
                                ui.label("Default Chunks per File:");
                                ui.add(egui::DragValue::new(&mut self.default_chunks_edit).range(1..=16));
                                ui.end_row();
                            });
                    });
                });
                
            ui.add_space(10.0);
            
            // Section 3: Connection & Port & Daemon start
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28))
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(38, 39, 48)))
                .rounding(6.0)
                .inner_margin(12.0)
                .show(ui, |ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("System Ports & Daemon").strong().color(egui::Color32::WHITE));
                        ui.add_space(4.0);
                        ui.label(egui::RichText::new("The local port where the background API server runs, and daemon state control.").size(10.5).color(egui::Color32::from_rgb(148, 163, 184)));
                        ui.add_space(8.0);
                        
                        ui.horizontal(|ui| {
                            ui.label("API Daemon Port:");
                            ui.add(egui::DragValue::new(&mut self.server_port_edit).range(1024..=65535));
                        });
                        
                        ui.add_space(10.0);
                        ui.separator();
                        ui.add_space(10.0);
                        
                        // Start Daemon Button (if offline)
                        let is_running = self.daemon_connected.load(Ordering::Relaxed);
                        ui.horizontal(|ui| {
                            if is_running {
                                ui.label(
                                    egui::RichText::new("Daemon is active and running.")
                                        .color(egui::Color32::from_rgb(245, 158, 11))
                                        .strong()
                                );
                            } else {
                                let start_btn = ui.add(
                                    egui::Button::new(egui::RichText::new("Start Grabr Daemon").strong())
                                        .fill(egui::Color32::from_rgb(245, 158, 11))
                                );
                                if start_btn.clicked() {
                                    if let Ok(exe) = std::env::current_exe() {
                                        let mut cmd = std::process::Command::new(exe);
                                        cmd.stdin(std::process::Stdio::null());
                                        cmd.stdout(std::process::Stdio::null());
                                        cmd.stderr(std::process::Stdio::null());
                                        cmd.spawn().ok();
                                    }
                                }
                                ui.add_space(6.0);
                                ui.label(
                                    egui::RichText::new("Daemon is currently offline.")
                                        .color(egui::Color32::from_rgb(180, 83, 9))
                                );
                            }
                        });
                    });
                });

            ui.add_space(10.0);

            // About & GitHub section
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28))
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(38, 39, 48)))
                .rounding(6.0)
                .inner_margin(12.0)
                .show(ui, |ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("About Grabr").strong().color(egui::Color32::WHITE));
                        ui.add_space(6.0);

                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("Desktop Version:").size(11.5));
                            ui.label(egui::RichText::new("1.0.0").strong().color(egui::Color32::from_rgb(245, 158, 11)));
                        });

                        ui.add_space(8.0);
                        ui.separator();
                        ui.add_space(8.0);

                        ui.horizontal(|ui| {
                            ui.label("Source Code:");
                            ui.hyperlink_to(
                                egui::RichText::new("github.com/LinuxCTRL/grabr")
                                    .color(egui::Color32::from_rgb(20, 184, 166)) // Teal URL
                                    .underline(),
                                "https://github.com/LinuxCTRL/grabr",
                            );
                        });

                        ui.add_space(10.0);

                        // Beautiful "Star us on GitHub" banner/button
                        let github_btn = ui.add(
                            egui::Button::new(
                                egui::RichText::new("⭐ Star us on GitHub")
                                    .strong()
                                    .color(egui::Color32::BLACK)
                            )
                            .fill(egui::Color32::from_rgb(251, 191, 36)) // Gold/Yellow fill
                            .rounding(4.0)
                        );
                        if github_btn.clicked() {
                            ui.ctx().open_url(egui::OpenUrl::new_tab("https://github.com/LinuxCTRL/grabr"));
                        }
                    });
                });

            ui.add_space(14.0);
            
            // Action buttons row (no emojis, Amber theme)
            ui.horizontal(|ui| {
                let save_btn = ui.add(
                    egui::Button::new(egui::RichText::new("Save Configuration").strong())
                        .fill(egui::Color32::from_rgb(245, 158, 11))
                );
                
                if save_btn.clicked() {
                    let new_config = crate::types::GrabrConfig {
                        output_dir: self.output_dir_edit.clone(),
                        max_concurrent: self.max_concurrent_edit,
                        default_chunks: self.default_chunks_edit,
                        server_port: self.server_port_edit,
                        theme: "dark".to_string(),
                    };
                    if crate::config::save_config(&new_config).is_ok() {
                        self.settings_saved = true;
                    }
                }
                
                if self.settings_saved {
                    ui.label(
                        egui::RichText::new("Settings saved! (Please restart the app to apply to background daemon)")
                            .color(egui::Color32::from_rgb(245, 158, 11))
                    );
                }
            });
        });
    }

    fn draw_jobs_list_view(&mut self, ui: &mut egui::Ui, total_speed: u64) {
        let jobs = self.jobs.clone();

        // 1. Draw connection banner on the main page
        let is_running = self.daemon_connected.load(Ordering::Relaxed);
        if is_running {
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28)) // Dark graphite background
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(245, 158, 11))) // Amber border
                .rounding(6.0)
                .inner_margin(8.0)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("Connected to Grabr Daemon")
                                .color(egui::Color32::from_rgb(245, 158, 11)) // Amber text
                                .strong()
                        );
                    });
                });
        } else {
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(40, 20, 10)) // Muted brown warning background
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(180, 83, 9))) // Dark Amber border
                .rounding(6.0)
                .inner_margin(8.0)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("Grabr Daemon is not running yet. Go to Settings and start it first.")
                                .color(egui::Color32::from_rgb(251, 191, 36)) // Light amber text
                                .strong()
                        );
                    });
                });
        }
        
        // 2. Long Teal overall speed sparkline chart
        if is_running && !self.total_speed_history.is_empty() {
            ui.add_space(8.0);
            egui::Frame::none()
                .fill(egui::Color32::from_rgb(20, 21, 28)) // Graphite panel
                .stroke(egui::Stroke::new(1.0, egui::Color32::from_rgb(38, 39, 48))) // Border
                .rounding(6.0)
                .inner_margin(10.0)
                .show(ui, |ui| {
                    ui.vertical(|ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new("Overall Bandwidth Activity")
                                    .color(egui::Color32::from_rgb(148, 163, 184))
                                    .size(11.0)
                                    .strong()
                            );
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                ui.label(
                                    egui::RichText::new(format_speed(total_speed))
                                        .color(egui::Color32::from_rgb(20, 184, 166)) // Teal text
                                        .strong()
                                        .size(11.5)
                                );
                            });
                        });
                        
                        ui.add_space(8.0);
                        
                        // Render full-width Teal sparkline
                        let (rect, _response) = ui.allocate_exact_size(
                            egui::vec2(ui.available_width(), 36.0), // Taller, spanning the full width
                            egui::Sense::hover()
                        );
                        let painter = ui.painter_at(rect);
                        
                        let history = &self.total_speed_history;
                        if history.len() > 1 {
                            let max_val = history.iter().copied().fold(1.0, f64::max);
                            let points: Vec<egui::Pos2> = history.iter().enumerate().map(|(idx, &val)| {
                                let x = rect.left() + (idx as f32 / (history.len() - 1) as f32) * rect.width();
                                let y = rect.bottom() - 2.0 - ((val / max_val) as f32 * (rect.height() - 4.0));
                                egui::pos2(x, y)
                            }).collect();

                            let teal_color = egui::Color32::from_rgb(20, 184, 166); // Teal color accent
                            for i in 0..points.len() - 1 {
                                painter.line_segment([points[i], points[i+1]], egui::Stroke::new(1.8, teal_color));
                            }
                        } else {
                            painter.line_segment(
                                [rect.left_center(), rect.right_center()],
                                egui::Stroke::new(1.0, egui::Color32::from_rgb(55, 65, 81))
                            );
                        }
                    });
                });
        }
        
        ui.add_space(10.0);

        // Filter jobs based on tab and search query
        let filtered_jobs: Vec<DownloadJob> = jobs.into_iter()
            .filter(|job| {
                let matches_tab = match self.current_tab {
                    Tab::All => true,
                    Tab::Downloading => job.status == JobStatus::Downloading || job.status == JobStatus::Queued,
                    Tab::Completed => job.status == JobStatus::Completed,
                    Tab::Settings => false,
                };

                let matches_search = self.search_query.is_empty() ||
                    job.filename.to_lowercase().contains(&self.search_query.to_lowercase());

                matches_tab && matches_search
            })
            .collect();

        // Secondary controls (no emojis)
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("Downloads (showing {})", filtered_jobs.len()))
                    .color(egui::Color32::from_rgb(148, 163, 184))
            );
        });

        ui.add_space(6.0);

        // Job list scroll area
        egui::ScrollArea::vertical().show(ui, |ui| {
            if filtered_jobs.is_empty() {
                ui.vertical_centered(|ui| {
                    ui.add_space(80.0);
                    ui.label(
                        egui::RichText::new("No downloads in this view")
                            .color(egui::Color32::from_rgb(100, 116, 139))
                            .size(15.0),
                    );
                });
                return;
            }

            for job in &filtered_jobs {
                self.draw_job_row(ui, job);
                ui.add_space(10.0);
            }
        });
    }

    fn draw_job_row(&mut self, ui: &mut egui::Ui, job: &DownloadJob) {
        let bg_color = egui::Color32::from_rgb(20, 21, 28); // Graphite-900
        let border_color = egui::Color32::from_rgb(38, 39, 48); // Slate-800

        egui::Frame::none()
            .fill(bg_color)
            .stroke(egui::Stroke::new(1.0, border_color))
            .rounding(8.0)
            .inner_margin(egui::Margin::symmetric(14.0, 10.0)) // Premium spacing
            .show(ui, |ui| {
                // Calculate the exact width of the card container (prevents expanding past constraints)
                let content_width = ui.available_width();

                // Draw vertical status-colored stripe on the left edge of the card (Amber theme)
                let rect = ui.min_rect();
                let stripe_color = match job.status {
                    JobStatus::Downloading => egui::Color32::from_rgb(245, 158, 11), // Amber
                    JobStatus::Completed => egui::Color32::from_rgb(245, 158, 11),   // Amber
                    JobStatus::Paused => egui::Color32::from_rgb(180, 83, 9),       // Dark Amber
                    _ => egui::Color32::from_rgb(100, 116, 139),
                };
                ui.painter().line_segment(
                    [rect.left_top() + egui::vec2(1.0, 1.0), rect.left_bottom() + egui::vec2(1.0, -1.0)],
                    egui::Stroke::new(4.0, stripe_color)
                );

                ui.horizontal(|ui| {
                    ui.add_space(4.0); // Margin from the left stripe

                    // 1. Badge block based on extension
                    let ext = job.filename.split('.').last().unwrap_or("").to_lowercase();
                    let (badge_text, badge_bg, badge_fg) = match ext.as_str() {
                        "mp4" | "mkv" | "avi" | "mov" | "webm" => ("VID", egui::Color32::from_rgb(60, 45, 10), egui::Color32::from_rgb(251, 191, 36)),
                        "mp3" | "wav" | "flac" | "ogg" | "m4a" => ("AUD", egui::Color32::from_rgb(88, 28, 135), egui::Color32::from_rgb(192, 132, 252)),
                        "zip" | "rar" | "tar" | "gz" | "7z" => ("ZIP", egui::Color32::from_rgb(120, 53, 4), egui::Color32::from_rgb(251, 191, 36)),
                        "exe" | "msi" | "deb" | "rpm" | "sh" | "bin" => ("BIN", egui::Color32::from_rgb(30, 41, 59), egui::Color32::from_rgb(203, 213, 225)),
                        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => ("IMG", egui::Color32::from_rgb(131, 24, 67), egui::Color32::from_rgb(244, 114, 182)),
                        "pdf" | "epub" | "txt" | "doc" | "docx" | "md" => ("DOC", egui::Color32::from_rgb(30, 58, 138), egui::Color32::from_rgb(96, 165, 250)),
                        _ => ("FILE", egui::Color32::from_rgb(64, 64, 64), egui::Color32::from_rgb(212, 212, 212)),
                    };

                    // Large Badge box
                    egui::Frame::none()
                        .fill(badge_bg)
                        .rounding(4.0)
                        .inner_margin(egui::Margin::symmetric(10.0, 8.0))
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new(badge_text).size(12.0).color(badge_fg).strong());
                        });

                    ui.add_space(8.0);

                    // Calculate progress
                    let progress = if job.total_bytes > 0 {
                        job.downloaded_bytes as f32 / job.total_bytes as f32
                    } else {
                        0.0
                    };

                    // 2. Middle block (vertical info, progress bar, and speed slider)
                    // We calculate middle width strictly using the card content_width, minus the badge (46px), minus the buttons (120px), and a safe margin (48px)
                    let badge_width = 46.0;
                    let buttons_width = 120.0;
                    let middle_width = (content_width - badge_width - buttons_width - 48.0).max(100.0);
                    
                    ui.allocate_ui([middle_width, 68.0].into(), |ui| {
                        ui.vertical(|ui| {
                            // Title row
                            ui.horizontal(|ui| {
                                let pct_width = 40.0;
                                let link_width = (ui.available_width() - pct_width - 10.0).max(50.0);
                                
                                ui.allocate_ui([link_width, 18.0].into(), |ui| {
                                    let label = egui::Label::new(
                                        egui::RichText::new(&job.filename)
                                            .color(egui::Color32::WHITE)
                                            .strong()
                                            .size(13.0)
                                    )
                                    .truncate()
                                    .sense(egui::Sense::click());
                                    
                                    let resp = ui.add(label);
                                    if resp.clicked() {
                                        let folder_path = Path::new(&job.destination);
                                        open_folder(folder_path);
                                    }
                                });

                                // Completion percentage (colored dynamically in Amber)
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    let pct_color = match job.status {
                                        JobStatus::Downloading => egui::Color32::from_rgb(245, 158, 11), // Amber
                                        JobStatus::Paused => egui::Color32::from_rgb(180, 83, 9),       // Dark Amber
                                        JobStatus::Completed => egui::Color32::from_rgb(245, 158, 11),   // Amber
                                        _ => egui::Color32::from_rgb(148, 163, 184),
                                    };
                                    ui.label(
                                        egui::RichText::new(format!("{:.0}%", progress * 100.0))
                                            .color(pct_color)
                                            .strong()
                                            .size(13.0)
                                    );
                                });
                            });

                            ui.add_space(2.0);

                            // Details & Sparkline Row
                            ui.horizontal(|ui| {
                                let details_text = if job.status == JobStatus::Downloading {
                                    format!(
                                        "{} / {} - {:.0}% | {} | {} Left",
                                        format_bytes(job.downloaded_bytes),
                                        format_bytes(job.total_bytes),
                                        progress * 100.0,
                                        format_speed(job.speed),
                                        format_eta(job.eta)
                                    )
                                } else if job.status == JobStatus::Completed {
                                    format!(
                                        "{} / {} - Completed | 100% | 0s",
                                        format_bytes(job.downloaded_bytes),
                                        format_bytes(job.total_bytes)
                                    )
                                } else {
                                    format!(
                                        "{} / {} - {}",
                                        format_bytes(job.downloaded_bytes),
                                        format_bytes(job.total_bytes),
                                        job.status
                                    )
                                };

                                let spark_width = if job.status == JobStatus::Downloading { 70.0 } else { 0.0 };
                                let details_width = (ui.available_width() - spark_width - 8.0).max(50.0);

                                ui.allocate_ui([details_width, 16.0].into(), |ui| {
                                    ui.add(
                                        egui::Label::new(
                                            egui::RichText::new(details_text)
                                                .color(egui::Color32::from_rgb(148, 163, 184))
                                                .size(10.5)
                                        )
                                        .truncate()
                                    );
                                });

                                // Draw real-time speed Sparkline graph next to the details (Amber)
                                if job.status == JobStatus::Downloading && ui.available_width() >= 60.0 {
                                    if let Some(history) = self.speed_history.get(&job.id) {
                                        if history.len() > 1 {
                                            let (rect, _response) = ui.allocate_exact_size(
                                                egui::vec2(60.0, 14.0),
                                                egui::Sense::hover()
                                            );
                                            let painter = ui.painter_at(rect);
                                            
                                            let max_val = history.iter().copied().fold(1.0, f64::max);
                                            let points: Vec<egui::Pos2> = history.iter().enumerate().map(|(idx, &val)| {
                                                let x = rect.left() + (idx as f32 / (history.len() - 1) as f32) * rect.width();
                                                let y = rect.bottom() - 2.0 - ((val / max_val) as f32 * (rect.height() - 4.0));
                                                egui::pos2(x, y)
                                            }).collect();

                                            let spark_color = egui::Color32::from_rgb(245, 158, 11); // Amber line
                                            for i in 0..points.len() - 1 {
                                                painter.line_segment([points[i], points[i+1]], egui::Stroke::new(1.5, spark_color));
                                            }
                                        }
                                    }
                                }
                            });

                            ui.add_space(4.0);

                            // Progress bar row (strictly sized to prevent horizontal container bleeding)
                            let bar_color = match job.status {
                                JobStatus::Downloading => egui::Color32::from_rgb(245, 158, 11), // Amber
                                JobStatus::Paused => egui::Color32::from_rgb(180, 83, 9),       // Dark Amber
                                JobStatus::Completed => egui::Color32::from_rgb(245, 158, 11),   // Amber
                                JobStatus::Failed => egui::Color32::from_rgb(239, 68, 68),       // Red
                                _ => egui::Color32::from_rgb(100, 116, 139),
                            };

                            ui.add_sized(
                                [middle_width, 14.0],
                                egui::ProgressBar::new(progress)
                                    .fill(bar_color)
                            );

                            // Speed Limit Slider Row (only visible if active)
                            if job.status == JobStatus::Downloading {
                                ui.add_space(2.0);
                                ui.horizontal(|ui| {
                                    let mut limit_enabled = self.speed_limits.contains_key(&job.id) && *self.speed_limits.get(&job.id).unwrap() > 0.0;
                                    let cb = ui.checkbox(&mut limit_enabled, "Limit Speed");
                                    
                                    if cb.changed() {
                                        if limit_enabled {
                                            self.speed_limits.insert(job.id.clone(), 1.0); // Default to 1.0 MB/s slow limit
                                            self.manager.set_speed_limit(&job.id, 1 * 1024 * 1024);
                                        } else {
                                            self.speed_limits.insert(job.id.clone(), 0.0); // Reset to Max Speed (unlimited)
                                            self.manager.set_speed_limit(&job.id, 0);
                                        }
                                    }

                                    if limit_enabled {
                                        let current_limit = self.speed_limits.entry(job.id.clone()).or_insert(1.0);
                                        ui.style_mut().spacing.slider_width = 110.0;
                                        let slider = ui.add(
                                            egui::Slider::new(current_limit, 0.5..=10.0)
                                                .show_value(false)
                                        );

                                        if slider.changed() {
                                            info!("Adjusted speed limit of job {} to {:.1} MB/s", job.id, *current_limit);
                                            let limit_bytes = (*current_limit * 1024.0 * 1024.0) as u64;
                                            self.manager.set_speed_limit(&job.id, limit_bytes);
                                        }

                                        ui.label(
                                            egui::RichText::new(format!("{:.1} MB/s", *current_limit))
                                                .color(egui::Color32::from_rgb(245, 158, 11))
                                                .size(10.0)
                                                .strong()
                                        );
                                    } else {
                                        ui.label(
                                            egui::RichText::new("Max Speed")
                                                .color(egui::Color32::from_rgb(148, 163, 184))
                                                .size(10.0)
                                        );
                                    }
                                });
                            }
                        });
                    });

                    ui.add_space(8.0); // Safe buffer spacing before buttons

                    // 3. Right block (Circular control buttons in fixed sizes, pure ASCII labels)
                    ui.allocate_ui([buttons_width, 68.0].into(), |ui| {
                        ui.horizontal(|ui| {
                            // Pause / Play Circular Button
                            ui.allocate_ui([36.0, 52.0].into(), |ui| {
                                ui.vertical_centered(|ui| {
                                    let (icon, label) = match job.status {
                                        JobStatus::Downloading | JobStatus::Queued => ("||", "Pause"),
                                        _ => (">", "Resume"),
                                    };

                                    let btn = ui.add_sized(
                                        [28.0, 28.0],
                                        egui::Button::new(egui::RichText::new(icon).size(12.0).strong())
                                            .rounding(14.0)
                                    );
                                    if btn.clicked() {
                                        let mgr = self.manager.clone();
                                        let job_id = job.id.clone();
                                        let is_active = job.status == JobStatus::Downloading || job.status == JobStatus::Queued;
                                        let path = if is_active {
                                            format!("/api/jobs/{}/pause", job_id)
                                        } else {
                                            format!("/api/jobs/{}/resume", job_id)
                                        };
                                        self.run_action(
                                            move || {
                                                let rt = tokio::runtime::Handle::current();
                                                rt.block_on(async {
                                                    if is_active {
                                                        mgr.pause_job(&job_id).await.map(|_| ())
                                                    } else {
                                                        mgr.resume_job(&job_id).await.map(|_| ())
                                                    }
                                                })
                                            },
                                            "POST",
                                            path,
                                            None,
                                        );
                                    }
                                    ui.add_space(2.0);
                                    ui.label(egui::RichText::new(label).size(8.0).color(egui::Color32::from_rgb(148, 163, 184)));
                                });
                            });

                            ui.add_space(4.0);

                            // Cancel / Delete Circular Button
                            ui.allocate_ui([36.0, 52.0].into(), |ui| {
                                ui.vertical_centered(|ui| {
                                    let btn = ui.add_sized(
                                        [28.0, 28.0],
                                        egui::Button::new(egui::RichText::new("X").size(12.0).strong())
                                            .rounding(14.0)
                                    );
                                    if btn.clicked() {
                                        let mgr = self.manager.clone();
                                        let job_id = job.id.clone();
                                        let path = format!("/api/jobs/{}", job_id);
                                        self.run_action(
                                            move || {
                                                let rt = tokio::runtime::Handle::current();
                                                rt.block_on(async {
                                                    mgr.remove_job(&job_id).await.map(|_| ())
                                                })
                                            },
                                            "DELETE",
                                            path,
                                            None,
                                        );
                                    }
                                    ui.add_space(2.0);
                                    ui.label(egui::RichText::new("Cancel").size(8.0).color(egui::Color32::from_rgb(148, 163, 184)));
                                });
                            });

                            ui.add_space(4.0);

                            // Open Folder Circular Button (labeled DIR)
                            ui.allocate_ui([36.0, 52.0].into(), |ui| {
                                ui.vertical_centered(|ui| {
                                    let btn = ui.add_sized(
                                        [28.0, 28.0],
                                        egui::Button::new(egui::RichText::new("DIR").size(9.0).strong())
                                            .rounding(14.0)
                                    );
                                    if btn.clicked() {
                                        let folder_path = Path::new(&job.destination);
                                        open_folder(folder_path);
                                    }
                                    ui.add_space(2.0);
                                    ui.label(egui::RichText::new("Folder").size(8.0).color(egui::Color32::from_rgb(148, 163, 184)));
                                });
                            });
                        });
                    });
                });
            });
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let k = 1024.0;
    let sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = (bytes as f64).log(k).floor() as usize;
    let val = bytes as f64 / k.powi(i as i32);
    format!("{:.1} {}", val, sizes[i])
}

fn format_speed(bytes_per_sec: u64) -> String {
    if bytes_per_sec == 0 {
        return "0 B/s".to_string();
    }
    format!("{}/s", format_bytes(bytes_per_sec))
}

fn format_eta(eta_secs: i64) -> String {
    if eta_secs < 0 {
        return "--".to_string();
    }
    if eta_secs < 60 {
        format!("{}s", eta_secs)
    } else {
        let mins = eta_secs / 60;
        let secs = eta_secs % 60;
        format!("{}m {}s", mins, secs)
    }
}

fn open_folder(path: &Path) {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .ok();
    }
}

fn check_system_yt_dlp() -> bool {
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

fn get_yt_dlp_executable_path() -> Result<PathBuf, String> {
    // 1. Check if system-wide yt-dlp is available in PATH
    if check_system_yt_dlp() {
        #[cfg(windows)]
        return Ok(PathBuf::from("yt-dlp.exe"));
        #[cfg(not(windows))]
        return Ok(PathBuf::from("yt-dlp"));
    }

    // 2. Otherwise use the local path inside ~/.grabr/
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
