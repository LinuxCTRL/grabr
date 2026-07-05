use std::path::PathBuf;
use tracing::{info, warn};
use crate::types::GrabrConfig;

pub fn load_config() -> GrabrConfig {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let config_dir = home.join(".grabr");
    let config_path = config_dir.join("config.json");

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).ok();
    }

    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<GrabrConfig>(&content) {
                let mut resolved_config = config;
                // Migrate relative paths or tilde prefixes
                if resolved_config.output_dir.starts_with("~/") {
                    resolved_config.output_dir = home.join(&resolved_config.output_dir[2..]).to_string_lossy().to_string();
                }
                return resolved_config;
            }
        }
    }

    // Default configuration if missing or corrupted
    let default_downloads = get_default_downloads_dir();
    let config = GrabrConfig {
        output_dir: default_downloads.to_string_lossy().to_string(),
        max_concurrent: 3,
        default_chunks: 4,
        server_port: 7474,
        theme: "dark".to_string(),
    };

    // Attempt to write the default config to file
    if let Ok(content) = serde_json::to_string_pretty(&config) {
        if std::fs::write(&config_path, content).is_err() {
            warn!("Failed to write default config to {}", config_path.display());
        } else {
            info!("Wrote default config to {}", config_path.display());
        }
    }

    config
}

fn get_default_downloads_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    
    // Linux XDG check
    #[cfg(target_os = "linux")]
    {
        let xdg_config = home.join(".config/user-dirs.dirs");
        if xdg_config.exists() {
            if let Ok(content) = std::fs::read_to_string(xdg_config) {
                for line in content.lines() {
                    if line.starts_with("XDG_DOWNLOAD_DIR=") {
                        let path_part = line.trim_start_matches("XDG_DOWNLOAD_DIR=").trim_matches('"');
                        let resolved = path_part.replace("$HOME", &home.to_string_lossy());
                        let pb = PathBuf::from(resolved);
                        if pb.exists() {
                            return pb;
                        }
                    }
                }
            }
        }
    }

    let standard_downloads = home.join("Downloads");
    if standard_downloads.exists() {
        return standard_downloads;
    }

    // Locale fallback list
    let localized_names = [
        "Downloads",
        "Transferências",
        "التنزيلات",
        "Téléchargements",
        "Descargas",
        "Download",
    ];

    for name in &localized_names {
        let pb = home.join(name);
        if pb.exists() {
            return pb;
        }
    }

    standard_downloads
}

pub fn save_config(config: &GrabrConfig) -> Result<(), String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let config_dir = home.join(".grabr");
    let config_path = config_dir.join("config.json");
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}
