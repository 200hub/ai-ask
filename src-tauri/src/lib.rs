// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::{Emitter, Manager, State, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Config {
    model: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            model: "chatgpt".to_string(),
        }
    }
}

struct AppState {
    config: std::sync::Mutex<Config>,
}

fn get_config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("ai-ask");
    fs::create_dir_all(&path).ok();
    path.push("config.json");
    path
}

fn load_config() -> Config {
    let path = get_config_path();
    if let Ok(content) = fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Config::default()
    }
}

fn save_config_to_disk(config: &Config) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
async fn save_config(model: String, state: State<'_, AppState>) -> Result<(), String> {
    let config = Config { model };
    {
        let mut state_config = state.config.lock().unwrap();
        *state_config = config.clone();
    }
    save_config_to_disk(&config)
}

#[tauri::command]
async fn search_with_ai(query: String, model: String) -> Result<String, String> {
    let url = get_search_url(&query, &model);
    Ok(url)
}

fn get_search_url(query: &str, model: &str) -> String {
    match model {
        "chatgpt" => format!("https://chatgpt.com/?q={}", urlencoding::encode(query)),
        "claude" => format!("https://claude.ai/new?q={}", urlencoding::encode(query)),
        "gemini" => format!(
            "https://gemini.google.com/app?q={}",
            urlencoding::encode(query)
        ),
        "perplexity" => format!(
            "https://www.perplexity.ai/search?q={}",
            urlencoding::encode(query)
        ),
        _ => format!(
            "https://www.google.com/search?q={}",
            urlencoding::encode(query)
        ),
    }
}

#[tauri::command]
async fn get_clipboard_text() -> Result<String, String> {
    // This will be called when global hotkey is pressed
    // The clipboard will be read using the clipboard manager plugin from frontend
    Ok(String::new())
}

#[tauri::command]
async fn show_main_window(window: Window) -> Result<(), String> {
    window
        .get_webview_window("main")
        .ok_or("Main window not found")?
        .show()
        .map_err(|e| e.to_string())?;
    window
        .get_webview_window("main")
        .ok_or("Main window not found")?
        .set_focus()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let config = load_config();
            app.manage(AppState {
                config: std::sync::Mutex::new(config),
            });

            // Register global shortcut for Ctrl/Cmd+Shift+S
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+S",
                move |app_handle, _shortcut, _event| {
                    // Read clipboard text and emit to frontend
                    if let Ok(clipboard_text) = app_handle.clipboard().read_text() {
                        let _ = handle.emit("global-search-triggered", clipboard_text);
                    }
                },
            )?;

            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            search_with_ai,
            show_main_window,
            get_clipboard_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
