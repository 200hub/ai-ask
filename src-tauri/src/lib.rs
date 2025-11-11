//! AI Ask - 桌面应用后端
//!
//! 基于 Tauri 2.0 构建的跨平台桌面应用，提供窗口控制、
//! 子 WebView 生命周期管理、代理测试、系统托盘与快捷键支持。

mod global_selection;
mod proxy;
mod selection_toolbar;
mod update;
mod utils;
mod webview;
mod window_control;

pub use utils::{decode_base64, decode_base64url, decode_base64url_to_json};

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    Emitter, Manager, WindowEvent,
};

use global_selection::{check_accessibility_permission, request_accessibility_permission};
use proxy::test_proxy_connection;
use selection_toolbar::{
    get_cursor_position, get_selection_toolbar_state, hide_selection_toolbar,
    set_selection_toolbar_enabled, set_selection_toolbar_ignored_apps,
    set_selection_toolbar_temporary_disabled_until, show_selection_toolbar, ToolbarManager,
};
use update::{
    check_update, download_update, get_download_status, init as init_update, install_update_now,
    schedule_install,
};
use webview::{
    check_child_webview_exists, close_child_webview, ensure_child_webview,
    evaluate_child_webview_script, focus_child_webview, hide_all_child_webviews,
    hide_child_webview, set_child_webview_bounds, show_child_webview, ChildWebviewManager,
};
use window_control::{
    hide_main_window, hide_window, resolve_main_window, show_main_window,
    show_main_window_without_restore, show_window, toggle_main_window_visibility, toggle_window,
};

/// Enable auto launch on system startup
#[tauri::command]
async fn enable_auto_launch(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    log::info!("Enabling auto launch");
    let autostart_manager = app.autolaunch();
    autostart_manager.enable().map_err(|e| {
        log::error!("Failed to enable auto launch: {}", e);
        format!("Failed to enable auto launch: {}", e)
    })?;

    log::info!("Auto launch enabled successfully");
    Ok(())
}

/// Disable auto launch on system startup
#[tauri::command]
async fn disable_auto_launch(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    log::info!("Disabling auto launch");
    let autostart_manager = app.autolaunch();
    autostart_manager.disable().map_err(|e| {
        log::error!("Failed to disable auto launch: {}", e);
        format!("Failed to disable auto launch: {}", e)
    })?;

    log::info!("Auto launch disabled successfully");
    Ok(())
}

/// Check if auto launch is enabled
#[tauri::command]
async fn is_auto_launch_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    let autostart_manager = app.autolaunch();
    autostart_manager.is_enabled().map_err(|e| {
        log::error!("Failed to check auto launch status: {}", e);
        format!("Failed to check auto launch status: {}", e)
    })
}

/// 应用程序主入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::init();
    log::info!("AI Ask application starting");

    tauri::Builder::default()
        .manage(ChildWebviewManager::default())
        .manage(ToolbarManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .setup(|app| {
            log::debug!("Application setup starting");

            global_selection::start_global_selection_monitor(app.handle().clone());

            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "偏好设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;

                tray.on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            log::debug!("Tray icon clicked");
                            let app = tray.app_handle().clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app) {
                                    let _ = toggle_main_window_visibility(&window).await;
                                }
                            });
                        }
                    }
                });

                tray.on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        log::debug!("Tray menu: show main window");
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                let _ = show_main_window(&window).await;
                            });
                        }
                    }
                    "settings" => {
                        log::debug!("Tray menu: open settings");
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                if show_main_window_without_restore(&window).await.is_ok() {
                                    let _ = window.emit("open-settings", ());
                                }
                            });
                        }
                    }
                    "quit" => {
                        log::info!("Tray menu: quit application");
                        app.exit(0);
                    }
                    _ => {}
                });
            }

            let handle = app.handle().clone();
            init_update(handle.clone());
            let last_shortcut_trigger = Arc::new(Mutex::new(None::<Instant>));

            // 注册主快捷键
            #[cfg(target_os = "macos")]
            let main_shortcut = "Cmd+Shift+A";
            #[cfg(not(target_os = "macos"))]
            let main_shortcut = "Ctrl+Shift+A";

            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
            if let Ok(shortcut) = main_shortcut.parse::<Shortcut>() {
                log::info!("Registering main shortcut: {}", shortcut);
                let throttle = last_shortcut_trigger.clone();
                let handle_clone = handle.clone();
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            let mut last = throttle.lock().unwrap();
                            let now = Instant::now();
                            if let Some(previous) = *last {
                                let elapsed = now.duration_since(previous);
                                if elapsed < Duration::from_millis(350) {
                                    log::debug!(
                                        "Shortcut trigger throttled: {}ms < 350ms",
                                        elapsed.as_millis()
                                    );
                                    return;
                                }
                            }

                            *last = Some(now);
                            log::debug!("Main shortcut triggered");

                            let app_handle = handle_clone.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app_handle) {
                                    let _ = toggle_main_window_visibility(&window).await;
                                }
                            });
                        });
            }

            // 注册翻译快捷键
            #[cfg(target_os = "macos")]
            let translation_shortcut = "Cmd+Shift+T";
            #[cfg(not(target_os = "macos"))]
            let translation_shortcut = "Ctrl+Shift+T";

            if let Ok(shortcut) = translation_shortcut.parse::<Shortcut>() {
                log::info!("Registering translation shortcut: {}", shortcut);
                let handle_clone = handle.clone();
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            log::debug!("Translation shortcut triggered");

                            let app_handle = handle_clone.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app_handle) {
                                    if show_main_window(&window).await.is_ok() {
                                        let _ = window.emit("translation-hotkey-triggered", ());
                                    }
                                }
                            });
                        });
            }

            // 注册划词工具栏快捷键
            #[cfg(target_os = "macos")]
            let selection_shortcut = "Cmd+Shift+S";
            #[cfg(not(target_os = "macos"))]
            let selection_shortcut = "Ctrl+Shift+S";

            if let Ok(shortcut) = selection_shortcut.parse::<Shortcut>() {
                log::info!("Registering selection toolbar shortcut: {}", shortcut);
                let handle_clone = handle.clone();
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            log::debug!("Selection toolbar shortcut triggered");

                            let app_handle = handle_clone.clone();
                            if let Some(toolbar_state) = app_handle.try_state::<ToolbarManager>() {
                                let toolbar_manager = toolbar_state.inner().clone();
                                global_selection::trigger_toolbar_from_hotkey(
                                    app_handle,
                                    toolbar_manager,
                                );
                            } else {
                                log::warn!(
                                    "Selection toolbar shortcut triggered but manager state missing"
                                );
                            }
                        });
            }

            log::info!("Application setup completed");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                log::debug!("Window close request intercepted, hiding to tray");
                api.prevent_close();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = hide_main_window(&window).await {
                        log::error!("Failed to hide window: {}", err);
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_window,
            show_window,
            hide_window,
            ensure_child_webview,
            set_child_webview_bounds,
            show_child_webview,
            hide_child_webview,
            close_child_webview,
            focus_child_webview,
            check_child_webview_exists,
            hide_all_child_webviews,
            evaluate_child_webview_script,
            test_proxy_connection,
            check_update,
            download_update,
            get_download_status,
            install_update_now,
            schedule_install,
            enable_auto_launch,
            disable_auto_launch,
            is_auto_launch_enabled,
            show_selection_toolbar,
            hide_selection_toolbar,
            set_selection_toolbar_enabled,
            set_selection_toolbar_ignored_apps,
            set_selection_toolbar_temporary_disabled_until,
            get_selection_toolbar_state,
            get_cursor_position,
            check_accessibility_permission,
            request_accessibility_permission
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("AI Ask application exited");
}
