use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    TrayIcon, TrayIconBuilder,
};

pub struct TrayManager {
    _tray_icon: TrayIcon,
    pub open_id: String,
    pub pause_all_id: String,
    pub quit_id: String,
}

impl TrayManager {
    pub fn new() -> Self {
        let tray_menu = Menu::new();
        
        let open_item = MenuItem::new("Open Queue", true, None);
        let pause_all_item = MenuItem::new("Pause All", true, None);
        let quit_item = MenuItem::new("Quit", true, None);
        
        let open_id = open_item.id().clone().0;
        let pause_all_id = pause_all_item.id().clone().0;
        let quit_id = quit_item.id().clone().0;

        tray_menu.append_items(&[
            &open_item,
            &pause_all_item,
            &PredefinedMenuItem::separator(),
            &quit_item,
        ]).ok();

        let icon = create_default_icon();

        let tray_icon = TrayIconBuilder::new()
            .with_menu(Box::new(tray_menu))
            .with_tooltip("Grabr Download Manager")
            .with_icon(icon)
            .build()
            .expect("Failed to build tray icon");

        Self {
            _tray_icon: tray_icon,
            open_id,
            pause_all_id,
            quit_id,
        }
    }

    pub fn poll_event(&self) -> Option<TrayAction> {
        if let Ok(event) = MenuEvent::receiver().try_recv() {
            let id = event.id.0;
            if id == self.open_id {
                return Some(TrayAction::Open);
            } else if id == self.pause_all_id {
                return Some(TrayAction::PauseAll);
            } else if id == self.quit_id {
                return Some(TrayAction::Quit);
            }
        }
        None
    }
}

pub enum TrayAction {
    Open,
    PauseAll,
    Quit,
}

fn create_default_icon() -> tray_icon::Icon {
    if let Ok(img) = image::load_from_memory(include_bytes!("../assets/icon.png")) {
        let rgba_img = img.to_rgba8();
        let (width, height) = rgba_img.dimensions();
        if let Ok(icon) = tray_icon::Icon::from_rgba(rgba_img.into_raw(), width, height) {
            return icon;
        }
    }
    
    // Fallback to basic solid amber square
    let rgba = vec![217u8; 16 * 16 * 4];
    tray_icon::Icon::from_rgba(rgba, 16, 16).unwrap()
}
