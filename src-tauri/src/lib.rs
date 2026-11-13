//! AI Ask - 跨平台应用后端
//!
//! 基于 Tauri 2.0 构建的跨平台应用，提供窗口控制、
//! 子 WebView 生命周期管理、代理测试等功能。
//! 桌面平台额外支持：系统托盘、全局快捷键、划词工具栏。

// 仅桌面平台编译的模块
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop_notes;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod global_selection;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod proxy;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod selection_toolbar;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shortcuts;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod update;
mod utils;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod webview;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod window_control;

pub use utils::{decode_base64, decode_base64url, decode_base64url_to_json};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::time::Duration;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    Emitter, Listener, Manager, WindowEvent,
};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use desktop_notes::{
    capture_desktop_note_bounds, close_desktop_note_window, ensure_desktop_note_window,
    persist_desktop_note_patches, suspend_desktop_note_windows, DesktopNoteWindows,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use global_selection::{check_accessibility_permission, request_accessibility_permission};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use proxy::test_proxy_connection;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use selection_toolbar::{
    allocate_selection_request_id, dismiss_selection_result_window, get_cursor_position,
    get_selection_result_state, get_selection_toolbar_state, hide_selection_toolbar,
    publish_selection_result, set_selection_result_pinned, set_selection_toolbar_enabled,
    set_selection_toolbar_ignored_apps, set_selection_toolbar_temporary_disabled_until,
    show_selection_result_window, show_selection_toolbar, ResultWindowManager, ToolbarManager,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use shortcuts::{get_global_shortcut_statuses, set_global_shortcut, ShortcutManager};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use update::{
    check_update, download_update, get_download_status, init as init_update, install_update_now,
    schedule_install,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use webview::{
    check_child_webview_exists, clear_child_webview_cache, close_child_webview,
    ensure_child_webview, evaluate_child_webview_script, focus_child_webview,
    hide_all_child_webviews, hide_child_webview, run_selection_injection, set_child_webview_bounds,
    show_child_webview, wait_child_webview_ready, ChildWebviewManager,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use window_control::{
    hide_main_window, hide_window, open_platform_in_main_window, resolve_main_window,
    show_main_window, show_main_window_without_restore, show_window, toggle_main_window_visibility,
    toggle_window,
};

/// Enable auto launch on system startup (desktop only)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

/// Disable auto launch on system startup (desktop only)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

/// Check if auto launch is enabled (desktop only)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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

    // 根据平台选择不同的初始化流程
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    run_desktop();

    #[cfg(any(target_os = "android", target_os = "ios"))]
    run_mobile();
}

/// 移动端应用初始化
#[cfg(any(target_os = "android", target_os = "ios"))]
fn run_mobile() {
    log::info!("Initializing mobile application");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            log::debug!("Mobile application setup starting");
            log::info!("Mobile application setup completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("AI Ask mobile application exited");
}

/// 桌面端应用初始化
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn run_desktop() {
    log::info!("Initializing desktop application");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_window("main") {
                tauri::async_runtime::spawn(async move {
                    let _ = show_main_window(&window).await;
                });
            }
        }))
        .manage(ChildWebviewManager::default())
        .manage(DesktopNoteWindows::default())
        .manage(ToolbarManager::default())
        .manage(ResultWindowManager::default())
        .manage(ShortcutManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .setup(|app| {
            desktop_notes::watch_displays(app.handle().clone());
            log::debug!("Desktop application setup starting");

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
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            // 退出前广播事件，给便签窗口/主窗口留出落盘与云同步机会。
                            // 等待前端发送 `app-exit-ready` 回执（表示所有便签位置已落盘、内容已同步），
                            // 最长等 3 秒超时，避免前端异常导致永久挂起。
                            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                            let tx_shared = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
                            let tx_for_listener = tx_shared.clone();
                            let listener_handle =
                                app_handle.listen("app-exit-ready", move |_event| {
                                    if let Ok(mut guard) = tx_for_listener.lock() {
                                        if let Some(tx) = guard.take() {
                                            let _ = tx.send(());
                                        }
                                    }
                                });
                            let _ = app_handle.emit("app-before-exit", ());

                            match tokio::time::timeout(Duration::from_secs(3), rx).await {
                                Ok(Ok(())) => log::info!("Received app-exit-ready from frontend"),
                                Ok(Err(_)) => log::warn!("app-exit-ready sender dropped"),
                                Err(_) => log::warn!("Timed out waiting for app-exit-ready (3s)"),
                            }
                            app_handle.unlisten(listener_handle);
                            app_handle.exit(0);
                        });
                    }
                    _ => {}
                });
            }

            let handle = app.handle().clone();
            init_update(handle.clone());
            shortcuts::initialize(&handle);

            log::info!("Desktop application setup completed");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 仅主窗口拦截关闭并隐藏到托盘；其他窗口（便签、工具栏等）允许正常关闭
                if window.label() != "main" {
                    return;
                }

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
            open_platform_in_main_window,
            window_control::show_main_window_for_selection,
            ensure_child_webview,
            set_child_webview_bounds,
            show_child_webview,
            hide_child_webview,
            close_child_webview,
            clear_child_webview_cache,
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
            get_global_shortcut_statuses,
            set_global_shortcut,
            show_selection_toolbar,
            hide_selection_toolbar,
            set_selection_toolbar_enabled,
            set_selection_toolbar_ignored_apps,
            set_selection_toolbar_temporary_disabled_until,
            get_selection_toolbar_state,
            get_cursor_position,
            allocate_selection_request_id,
            show_selection_result_window,
            dismiss_selection_result_window,
            get_selection_result_state,
            publish_selection_result,
            set_selection_result_pinned,
            run_selection_injection,
            wait_child_webview_ready,
            ensure_desktop_note_window,
            close_desktop_note_window,
            capture_desktop_note_bounds,
            persist_desktop_note_patches,
            suspend_desktop_note_windows,
            check_accessibility_permission,
            request_accessibility_permission
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("AI Ask desktop application exited");
}
