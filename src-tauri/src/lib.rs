// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    menu::{Menu, MenuItem},
    Manager, tray::TrayIconEvent, Emitter,
};

/// Tauri命令：切换窗口显示状态
#[tauri::command]
async fn toggle_window(window: tauri::Window) -> Result<(), String> {
    if window.is_visible().map_err(|e| e.to_string())? {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri命令：显示窗口
#[tauri::command]
async fn show_window(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Tauri命令：隐藏窗口
#[tauri::command]
async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 插件初始化
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        // 设置处理程序
        .setup(|app| {
            // 创建托盘菜单
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "偏好设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            // 设置托盘菜单
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;

                // 托盘图标点击事件
                let _app_handle = app.handle().clone();
                tray.on_tray_icon_event(move |tray, event| {
                    match event {
                        TrayIconEvent::Click { button, button_state, .. } => {
                            if button == tauri::tray::MouseButton::Left
                                && button_state == tauri::tray::MouseButtonState::Up {
                                let app = tray.app_handle();
                                if let Some(window) = app.get_webview_window("main") {
                                    if window.is_visible().unwrap_or(false) {
                                        let _ = window.hide();
                                    } else {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                });

                // 托盘菜单事件
                tray.on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("open-settings", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                });
            }

            // 注册全局快捷键（默认）
            let handle = app.handle().clone();
            #[cfg(target_os = "macos")]
            let shortcut = "Cmd+Shift+A";
            #[cfg(not(target_os = "macos"))]
            let shortcut = "Ctrl+Shift+A";

            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
            if let Ok(shortcut) = shortcut.parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _event, _shortcut| {
                    if let Some(window) = handle.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }

            Ok(())
        })
        // 窗口事件处理
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 阻止窗口关闭，而是隐藏到托盘
                api.prevent_close();
                window.hide().unwrap();
            }
        })
        // 注册命令
        .invoke_handler(tauri::generate_handler![
            toggle_window,
            show_window,
            hide_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
