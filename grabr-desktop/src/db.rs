use rusqlite::{params, Connection, Result};
use std::path::Path;
use crate::types::{DownloadJob, ChunkInfo, JobStatus};

pub fn init_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent).ok();
    }
    
    let conn = Connection::open(path)?;
    
    // Set journal mode to WAL for better concurrent reads and writes
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            filename TEXT NOT NULL,
            destination TEXT NOT NULL,
            total_bytes INTEGER DEFAULT 0,
            downloaded_bytes INTEGER DEFAULT 0,
            chunks TEXT DEFAULT '[]',
            status TEXT DEFAULT 'queued',
            speed INTEGER DEFAULT 0,
            eta INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            error TEXT
        )",
        [],
    )?;
    
    Ok(conn)
}

pub fn create_job(conn: &Connection, job: &DownloadJob) -> Result<()> {
    let chunks_json = serde_json::to_string(&job.chunks).unwrap_or_else(|_| "[]".to_string());
    let status_str = job.status.to_string();
    
    conn.execute(
        "INSERT INTO jobs (id, url, filename, destination, total_bytes, downloaded_bytes, chunks, status, speed, eta, created_at, updated_at, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            job.id,
            job.url,
            job.filename,
            job.destination,
            job.total_bytes,
            job.downloaded_bytes,
            chunks_json,
            status_str,
            job.speed,
            job.eta,
            job.created_at,
            job.updated_at,
            job.error,
        ],
    )?;
    Ok(())
}

pub fn update_job(conn: &Connection, job: &DownloadJob) -> Result<()> {
    let chunks_json = serde_json::to_string(&job.chunks).unwrap_or_else(|_| "[]".to_string());
    let status_str = job.status.to_string();
    
    conn.execute(
        "UPDATE jobs
         SET url = ?1, filename = ?2, destination = ?3, total_bytes = ?4, downloaded_bytes = ?5,
             chunks = ?6, status = ?7, speed = ?8, eta = ?9, updated_at = ?10, error = ?11
         WHERE id = ?12",
        params![
            job.url,
            job.filename,
            job.destination,
            job.total_bytes,
            job.downloaded_bytes,
            chunks_json,
            status_str,
            job.speed,
            job.eta,
            job.updated_at,
            job.error,
            job.id,
        ],
    )?;
    Ok(())
}

pub fn get_job(conn: &Connection, id: &str) -> Result<Option<DownloadJob>> {
    let mut stmt = conn.prepare("SELECT id, url, filename, destination, total_bytes, downloaded_bytes, chunks, status, speed, eta, created_at, updated_at, error FROM jobs WHERE id = ?1")?;
    
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let chunks_str: String = row.get(6)?;
        let chunks: Vec<ChunkInfo> = serde_json::from_str(&chunks_str).unwrap_or_default();
        
        let status_str: String = row.get(7)?;
        let status = match status_str.as_str() {
            "downloading" => JobStatus::Downloading,
            "paused" => JobStatus::Paused,
            "completed" => JobStatus::Completed,
            "failed" => JobStatus::Failed,
            _ => JobStatus::Queued,
        };
        
        Ok(Some(DownloadJob {
            id: row.get(0)?,
            url: row.get(1)?,
            filename: row.get(2)?,
            destination: row.get(3)?,
            total_bytes: row.get(4)?,
            downloaded_bytes: row.get(5)?,
            chunks,
            status,
            speed: row.get(8)?,
            eta: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            error: row.get(12)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn list_jobs(conn: &Connection) -> Result<Vec<DownloadJob>> {
    let mut stmt = conn.prepare("SELECT id, url, filename, destination, total_bytes, downloaded_bytes, chunks, status, speed, eta, created_at, updated_at, error FROM jobs ORDER BY created_at DESC")?;
    
    let rows = stmt.query_map([], |row| {
        let chunks_str: String = row.get(6)?;
        let chunks: Vec<ChunkInfo> = serde_json::from_str(&chunks_str).unwrap_or_default();
        
        let status_str: String = row.get(7)?;
        let status = match status_str.as_str() {
            "downloading" => JobStatus::Downloading,
            "paused" => JobStatus::Paused,
            "completed" => JobStatus::Completed,
            "failed" => JobStatus::Failed,
            _ => JobStatus::Queued,
        };
        
        Ok(DownloadJob {
            id: row.get(0)?,
            url: row.get(1)?,
            filename: row.get(2)?,
            destination: row.get(3)?,
            total_bytes: row.get(4)?,
            downloaded_bytes: row.get(5)?,
            chunks,
            status,
            speed: row.get(8)?,
            eta: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            error: row.get(12)?,
        })
    })?;
    
    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row?);
    }
    Ok(jobs)
}

pub fn delete_job(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_completed_jobs(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM jobs WHERE status = 'completed'", [])?;
    Ok(())
}
