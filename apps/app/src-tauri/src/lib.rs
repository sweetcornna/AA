// Shared entry point for desktop (main.rs) and mobile (mobile_entry_point).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // deep links carry installed-app invitation URLs into the router
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error while running AA application");
}
