use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::cors::{CorsLayer, Any};
use axum::{
    extract::{Path, State, Query},
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use tracing::{info, error};

use crate::db;
use crate::downloader::{DownloadManager, ensure_yt_dlp_downloaded};
use crate::types::DownloadOptions;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<DownloadManager>,
    pub db_path: PathBuf,
}

pub async fn start_server(
    port: u16,
    manager: Arc<DownloadManager>,
    db_path: PathBuf,
) -> Result<(), String> {
    let state = AppState { manager, db_path };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/version", get(get_version))
        .route("/api/jobs", get(get_jobs).post(add_job))
        .route("/api/jobs/:id", get(get_job).delete(delete_job))
        .route("/api/jobs/:id/pause", post(pause_job))
        .route("/api/jobs/:id/resume", post(resume_job))
        .route("/api/jobs/pause-all", post(pause_all))
        .route("/api/jobs/resume-all", post(resume_all))
        .route("/api/jobs/clear-completed", post(clear_completed))
        .route("/api/youtube/formats", get(get_yt_formats));

    if let Some(static_dir) = find_static_dir() {
        info!("Serving static dashboard files from {}", static_dir.display());
        app = app.fallback_service(ServeDir::new(static_dir));
    } else {
        error!("Warning: Could not locate static dashboard folder 'src/server/static'");
    }

    let app = app.layer(cors).with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("Starting Grabr Axum server on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind port: {}", e))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server run error: {}", e))?;

    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    state: State<AppState>,
) -> impl IntoResponse {
    let State(state) = state;
    ws.on_upgrade(move |socket| handle_websocket(socket, state))
}

async fn handle_websocket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.manager.ws_sender().subscribe();
    
    // We only need to write stats to the client
    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let msg_text = match serde_json::to_string(&event) {
                Ok(t) => t,
                Err(e) => {
                    error!("WS serialization error: {}", e);
                    continue;
                }
            };
            if socket.send(Message::Text(msg_text.into())).await.is_err() {
                // Client disconnected
                break;
            }
        }
    });
}

async fn get_version() -> impl IntoResponse {
    Json(serde_json::json!({ "version": "1.0.11" }))
}

async fn get_jobs(state: State<AppState>) -> impl IntoResponse {
    let State(state) = state;
    let conn = match db::init_db(&state.db_path) {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "DB error").into_response(),
    };

    match db::list_jobs(&conn) {
        Ok(jobs) => Json(jobs).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DB query error").into_response(),
    }
}

#[derive(Deserialize)]
struct AddJobPayload {
    url: String,
    options: Option<DownloadOptions>,
}

async fn add_job(
    state: State<AppState>,
    Json(payload): Json<AddJobPayload>,
) -> impl IntoResponse {
    let State(state) = state;
    if payload.url.is_empty() {
        return (StatusCode::BAD_REQUEST, "URL is required").into_response();
    }

    let opts = payload.options.unwrap_or(DownloadOptions {
        output_dir: None,
        filename: None,
        chunks: None,
    });

    match state.manager.add_job(&payload.url, opts).await {
        Ok(job) => Json(job).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn get_job(
    state: State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let State(state) = state;
    let conn = match db::init_db(&state.db_path) {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "DB error").into_response(),
    };

    match db::get_job(&conn, &id) {
        Ok(Some(job)) => Json(job).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Job not found").into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DB error").into_response(),
    }
}

async fn pause_job(
    state: State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.pause_job(&id).await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn resume_job(
    state: State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.resume_job(&id).await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn delete_job(
    state: State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.remove_job(&id).await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn pause_all(state: State<AppState>) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.pause_all().await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn resume_all(state: State<AppState>) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.resume_all().await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn clear_completed(state: State<AppState>) -> impl IntoResponse {
    let State(state) = state;
    match state.manager.clear_completed().await {
        Ok(_) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

fn find_static_dir() -> Option<PathBuf> {
    // 1. Check relative to current working dir
    let path = PathBuf::from("src/server/static");
    if path.exists() && path.is_dir() {
        return Some(path);
    }
    
    // 2. Check parent (if running inside grabr-desktop folder)
    let path = PathBuf::from("../src/server/static");
    if path.exists() && path.is_dir() {
        return Some(path);
    }
    
    // 3. Check relative to current executable
    if let Ok(mut exe) = std::env::current_exe() {
        exe.pop(); // Pop binary name
        let mut dir = exe.clone();
        for _ in 0..5 {
            let static_path = dir.join("src/server/static");
            if static_path.exists() && static_path.is_dir() {
                return Some(static_path);
            }
            if !dir.pop() {
                break;
            }
        }
    }
    
    None
}

#[derive(Deserialize)]
struct YtFormatsQuery {
    url: String,
}

async fn get_yt_formats(
    Query(query): Query<YtFormatsQuery>,
) -> impl IntoResponse {
    if query.url.is_empty() {
        return (StatusCode::BAD_REQUEST, "URL query parameter is required").into_response();
    }

    // Resolve local or system yt-dlp path
    let exe_path = match ensure_yt_dlp_downloaded().await {
        Ok(path) => path,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };

    let output = match tokio::process::Command::new(&exe_path)
        .arg("-j")
        .arg(&query.url)
        .output()
        .await
    {
        Ok(out) => out,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to run yt-dlp: {}", e)).into_response(),
    };

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("yt-dlp error: {}", err_msg)).into_response();
    }

    let info: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(val) => val,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse JSON: {}", e)).into_response(),
    };

    Json(info).into_response()
}
