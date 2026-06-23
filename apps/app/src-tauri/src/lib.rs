// Shared entry point for desktop (main.rs) and mobile (mobile_entry_point).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // deep links carry invite tokens / OTP magic-link redirects into the app
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error while running AA application");
}
