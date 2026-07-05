#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod types;
mod db;
mod downloader;
mod server;
mod tray;
mod gui;
mod config;

use eframe::egui;
use tracing::info;

fn main() -> Result<(), eframe::Error> {
    // 0. Initialize GTK on Linux for the system tray
    #[cfg(target_os = "linux")]
    {
        gtk::init().ok();
    }

    // 1. Initialize tracing
    tracing_subscriber::fmt::init();

    // 2. Load config
    let config = config::load_config();
    let port = config.server_port;

    // 3. Resolve DB path
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let db_path = home.join(".grabr/grabr.db");

    // 4. Handle CLI arguments
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        if args.iter().any(|x| x == "--install-manifest") {
            install_manifest(&args);
            return Ok(());
        }

        if args.iter().any(|x| x == "--register-autostart") {
            register_autostart();
            return Ok(());
        }

        if args.iter().any(|x| x == "--unregister-autostart") {
            unregister_autostart();
            return Ok(());
        }

        let is_native_messaging = args.iter().any(|arg| {
            arg.starts_with("chrome-extension://") || arg.contains("extension@") || arg == "--native-messaging"
        });

        if is_native_messaging {
            handle_native_messaging(port);
            return Ok(());
        }

        // Handle CLI action like --add-url
        if let Some(pos) = args.iter().position(|x| x == "--add-url") {
            if let Some(url) = args.get(pos + 1) {
                // Send url to daemon
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let client = reqwest::Client::new();
                    let payload = serde_json::json!({
                        "url": url,
                        "options": null
                    });
                    match client.post(format!("http://127.0.0.1:{}/api/jobs", port))
                        .json(&payload)
                        .send()
                        .await 
                    {
                        Ok(resp) if resp.status().is_success() => {
                            println!("Successfully sent download to Grabr daemon.");
                        }
                        _ => {
                            // If daemon not running, spawn it
                            if let Ok(exe) = std::env::current_exe() {
                                let mut cmd = std::process::Command::new(exe);
                                cmd.stdin(std::process::Stdio::null());
                                cmd.stdout(std::process::Stdio::null());
                                cmd.stderr(std::process::Stdio::null());
                                if cmd.spawn().is_ok() {
                                    // Poll the server for up to 3 seconds
                                    for _ in 0..15 {
                                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                                        if let Ok(resp) = client.get(format!("http://127.0.0.1:{}/api/version", port)).send().await {
                                            if resp.status().is_success() {
                                                break;
                                            }
                                        }
                                    }
                                    // Try sending again
                                    if let Ok(resp) = client.post(format!("http://127.0.0.1:{}/api/jobs", port)).json(&payload).send().await {
                                        if resp.status().is_success() {
                                            println!("Successfully spawned daemon and sent download.");
                                            return;
                                        }
                                    }
                                }
                            }
                            eprintln!("Error: Grabr daemon is not running or rejected request.");
                            std::process::exit(1);
                        }
                    }
                });
                return Ok(());
            }
        }
    }

    info!("Starting Grabr Desktop daemon runtime...");

    // 5. Initialize Tokio Runtime for background daemon tasks
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();

    let manager_arc;
    let db_path_clone = db_path.clone();
    
    // Enter tokio runtime context for spawning background tasks
    let _guard = rt.enter();
    
    let (manager, event_rx) = downloader::DownloadManager::new(&db_path, config);
    manager_arc = manager.clone();
    
    tokio::spawn(async move {
        manager.start(event_rx).await;
    });

    let manager_for_server = manager_arc.clone();
    let db_path_for_server = db_path.clone();
    tokio::spawn(async move {
        if let Err(e) = server::start_server(port, manager_for_server, db_path_for_server).await {
            eprintln!("Failed to start API server: {}", e);
        }
    });

    // Detect if we should start minimized/hidden in system tray
    let minimized = args.iter().any(|x| x == "--minimized" || x == "--hidden");

    // 6. Run GUI on main thread
    let mut viewport = egui::ViewportBuilder::default()
        .with_app_id("grabr-desktop")
        .with_title("Grabr Desktop")
        .with_inner_size([600.0, 450.0])
        .with_min_inner_size([540.0, 380.0])
        .with_visible(!minimized);

    if let Ok(img) = image::load_from_memory(include_bytes!("../assets/icon.png")) {
        let rgba_img = img.to_rgba8();
        let (width, height) = rgba_img.dimensions();
        let icon_data = egui::IconData {
            rgba: rgba_img.into_raw(),
            width,
            height,
        };
        viewport = viewport.with_icon(icon_data);
    }

    let options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };

    eframe::run_native(
        "Grabr Desktop",
        options,
        Box::new(move |cc| {
            Ok(Box::new(gui::GrabrApp::new(cc, db_path_clone, manager_arc, !minimized)))
        }),
    )
}

fn install_manifest(args: &[String]) {
    let exe_path = std::env::current_exe().expect("Failed to get current executable path");
    let exe_str = exe_path.to_string_lossy().to_string();
    
    // Check if custom chrome ID is passed after --install-manifest
    let mut allowed_origins = vec![
        "chrome-extension://gbchgciagnolnoliocgbghlhbjonbenj/".to_string()
    ];
    if let Some(pos) = args.iter().position(|x| x == "--install-manifest") {
        if let Some(custom_id) = args.get(pos + 1) {
            if !custom_id.starts_with("-") {
                allowed_origins.push(format!("chrome-extension://{}/", custom_id));
            }
        }
    }

    let chrome_manifest = serde_json::json!({
        "name": "org.grabr.desktop",
        "description": "Grabr Desktop Native Messaging Host",
        "path": exe_str,
        "type": "stdio",
        "allowed_origins": allowed_origins
    });
    
    let firefox_manifest = serde_json::json!({
        "name": "org.grabr.desktop",
        "description": "Grabr Desktop Native Messaging Host",
        "path": exe_str,
        "type": "stdio",
        "allowed_extensions": [
            "grabr@linuxctrl"
        ]
    });
    
    // Write to folders
    let home = dirs::home_dir().expect("Failed to get home directory");
    
    // Chrome
    let chrome_dir = home.join(".config/google-chrome/NativeMessagingHosts");
    std::fs::create_dir_all(&chrome_dir).ok();
    let _ = std::fs::write(
        chrome_dir.join("org.grabr.desktop.json"),
        serde_json::to_string_pretty(&chrome_manifest).unwrap()
    );
    
    // Chromium
    let chromium_dir = home.join(".config/chromium/NativeMessagingHosts");
    std::fs::create_dir_all(&chromium_dir).ok();
    let _ = std::fs::write(
        chromium_dir.join("org.grabr.desktop.json"),
        serde_json::to_string_pretty(&chrome_manifest).unwrap()
    );
    
    // Firefox
    let firefox_dir = home.join(".mozilla/native-messaging-hosts");
    std::fs::create_dir_all(&firefox_dir).ok();
    let _ = std::fs::write(
        firefox_dir.join("org.grabr.desktop.json"),
        serde_json::to_string_pretty(&firefox_manifest).unwrap()
    );
    
    println!("Successfully installed Grabr Desktop native messaging manifests!");
}

fn handle_native_messaging(port: u16) {
    use std::io::{self, Read};
    
    // Read length prefix (4 bytes)
    let mut len_bytes = [0u8; 4];
    if io::stdin().read_exact(&mut len_bytes).is_err() {
        return;
    }
    let len = u32::from_ne_bytes(len_bytes) as usize;
    
    // Read payload
    let mut payload_bytes = vec![0u8; len];
    if io::stdin().read_exact(&mut payload_bytes).is_err() {
        return;
    }
    
    let payload: serde_json::Value = match serde_json::from_slice(&payload_bytes) {
        Ok(v) => v,
        Err(_) => return,
    };
    
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() {
        send_native_response(serde_json::json!({ "success": false, "error": "Empty URL" }));
        return;
    }
    
    let filename = payload.get("filename").and_then(|v| v.as_str()).map(|s| s.to_string());
    let chunks = payload.get("chunks").and_then(|v| v.as_u64()).map(|n| n as usize);
    
    // Send to daemon
    let rt = tokio::runtime::Runtime::new().unwrap();
    let success = rt.block_on(async {
        let client = reqwest::Client::new();
        let req_payload = serde_json::json!({
            "url": url,
            "options": {
                "filename": filename,
                "chunks": chunks
            }
        });
        
        let daemon_url = format!("http://127.0.0.1:{}/api/jobs", port);
        match client.post(&daemon_url).json(&req_payload).send().await {
            Ok(resp) if resp.status().is_success() => true,
            _ => {
                // Daemon not running? Try to launch it.
                if let Ok(exe) = std::env::current_exe() {
                    let mut cmd = std::process::Command::new(exe);
                    cmd.stdin(std::process::Stdio::null());
                    cmd.stdout(std::process::Stdio::null());
                    cmd.stderr(std::process::Stdio::null());
                    if cmd.spawn().is_ok() {
                        // Poll the server for up to 3 seconds
                        for _ in 0..15 {
                            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                            if let Ok(resp) = client.get(format!("http://127.0.0.1:{}/api/version", port)).send().await {
                                if resp.status().is_success() {
                                    break;
                                }
                            }
                        }
                        // Try sending again
                        if let Ok(resp) = client.post(&daemon_url).json(&req_payload).send().await {
                            return resp.status().is_success();
                        }
                    }
                }
                false
            }
        }
    });
    
    if success {
        send_native_response(serde_json::json!({ "success": true }));
    } else {
        send_native_response(serde_json::json!({ "success": false, "error": "Failed to connect to daemon" }));
    }
}

fn send_native_response(value: serde_json::Value) {
    use std::io::{self, Write};
    let response_str = value.to_string();
    let len = response_str.len() as u32;
    let len_bytes = len.to_ne_bytes();
    let mut stdout = io::stdout();
    let _ = stdout.write_all(&len_bytes);
    let _ = stdout.write_all(response_str.as_bytes());
    let _ = stdout.flush();
}

fn register_autostart() {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let autostart_dir = home.join(".config/autostart");
    std::fs::create_dir_all(&autostart_dir).ok();
    
    let exe_path = std::env::current_exe().expect("Failed to get current executable path");
    let exe_str = exe_path.to_string_lossy().to_string();
    
    let desktop_content = format!(
        "[Desktop Entry]\n\
        Type=Application\n\
        Name=Grabr Desktop\n\
        Exec={} --minimized\n\
        Icon=grabr-desktop\n\
        Comment=Modern, elegant file downloader\n\
        Terminal=false\n\
        X-GNOME-Autostart-enabled=true\n",
        exe_str
    );
    
    match std::fs::write(autostart_dir.join("grabr-desktop.desktop"), desktop_content) {
        Ok(_) => println!("Successfully registered Grabr Desktop to autostart on boot!"),
        Err(e) => eprintln!("Failed to write autostart entry: {}", e),
    }
}

fn unregister_autostart() {
    let home = dirs::home_dir().expect("Failed to get home directory");
    let autostart_file = home.join(".config/autostart/grabr-desktop.desktop");
    if autostart_file.exists() {
        match std::fs::remove_file(autostart_file) {
            Ok(_) => println!("Successfully removed Grabr Desktop autostart registration."),
            Err(e) => eprintln!("Failed to remove autostart entry: {}", e),
        }
    } else {
        println!("Grabr Desktop is not registered to autostart.");
    }
}
