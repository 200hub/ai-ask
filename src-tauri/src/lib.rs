//! AI Ask - 桌面应用后端
//!
//! 基于 Tauri 2.0 构建的跨平台桌面应用，提供窗口控制、
//! 子 WebView 生命周期管理、代理测试、系统托盘与快捷键支持。

mod proxy;
mod updater;
mod webview;
mod window_control;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    Emitter, WindowEvent,
};

use proxy::test_proxy_connection;
use webview::{
    close_child_webview, ensure_child_webview, focus_child_webview, hide_all_child_webviews,
    hide_child_webview, set_child_webview_bounds, show_child_webview, ChildWebviewManager,
};
use window_control::{
    hide_main_window, hide_window, resolve_main_window, show_main_window, show_window,
    toggle_main_window_visibility, toggle_window,
};

/// 应用程序主入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    log::info!("AI Ask 应用启动");

    tauri::Builder::default()
        .manage(ChildWebviewManager::default())
        .manage(updater::UpdateManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            log::debug!("开始应用设置");

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
                            log::debug!("托盘图标被点击");
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
                        log::debug!("托盘菜单: 显示主窗口");
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                let _ = show_main_window(&window).await;
                            });
                        }
                    }
                    "settings" => {
                        log::debug!("托盘菜单: 打开设置");
                        if let Some(window) = resolve_main_window(app) {
                            tauri::async_runtime::spawn(async move {
                                if show_main_window(&window).await.is_ok() {
                                    let _ = window.emit("open-settings", ());
                                }
                            });
                        }
                    }
                    "quit" => {
                        log::info!("托盘菜单: 退出应用");
                        app.exit(0);
                    }
                    _ => {}
                });
            }

            let handle = app.handle().clone();
            let last_shortcut_trigger = Arc::new(Mutex::new(None::<Instant>));
            #[cfg(target_os = "macos")]
            let shortcut = "Cmd+Shift+A";
            #[cfg(not(target_os = "macos"))]
            let shortcut = "Ctrl+Shift+A";

            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
            if let Ok(shortcut) = shortcut.parse::<Shortcut>() {
                log::info!("注册全局快捷键: {}", shortcut);
                let throttle = last_shortcut_trigger.clone();
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            let mut last = throttle.lock().unwrap();
                            let now = Instant::now();
                            if let Some(previous) = *last {
                                let elapsed = now.duration_since(previous);
                                if elapsed < Duration::from_millis(350) {
                                    log::debug!(
                                        "快捷键触发被限流: {}ms < 350ms",
                                        elapsed.as_millis()
                                    );
                                    return;
                                }
                            }

                            *last = Some(now);
                            log::debug!("快捷键被触发");

                            let app_handle = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = resolve_main_window(&app_handle) {
                                    let _ = toggle_main_window_visibility(&window).await;
                                }
                            });
                        });
            }

            updater::check_pending_updates_on_startup(&app.handle());

            log::info!("应用设置完成");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                log::debug!("窗口关闭请求被拦截，隐藏到托盘");
                api.prevent_close();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = hide_main_window(&window).await {
                        log::error!("隐藏窗口失败: {}", err);
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
            hide_all_child_webviews,
            test_proxy_connection,
            updater::start_update_service,
            updater::download_update_now
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("AI Ask 应用退出");
}
