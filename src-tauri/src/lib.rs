// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    Emitter, Manager,
};

#[derive(Debug, Deserialize)]
struct ProxyTestConfig {
    #[serde(rename = "type")]
    proxy_type: String,
    host: Option<String>,
    port: Option<String>,
}

#[derive(Debug, Serialize)]
struct ProxyTestResult {
    success: bool,
    message: String,
    latency: Option<u128>,
}

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

/// 测试代理连通性
#[tauri::command]
async fn test_proxy_connection(config: ProxyTestConfig) -> Result<ProxyTestResult, String> {
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::limited(5));

    match config.proxy_type.as_str() {
        "custom" => {
            let host = config
                .host
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "代理地址不能为空".to_string())?;

            let port = config
                .port
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "代理端口不能为空".to_string())?;

            let proxy_url = if host.contains("://") {
                host.to_string()
            } else {
                format!("http://{}:{}", host, port)
            };

            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| err.to_string())?;
            client_builder = client_builder.proxy(proxy);
        }
        "none" => {
            client_builder = client_builder.no_proxy();
        }
        _ => {}
    }

    let client = client_builder.build().map_err(|err| err.to_string())?;
    let target_url = "https://www.example.com";
    let start = Instant::now();

    match client.get(target_url).send().await {
        Ok(response) => {
            let latency = start.elapsed().as_millis();
            if response.status().is_success() {
                Ok(ProxyTestResult {
                    success: true,
                    message: "连接成功".into(),
                    latency: Some(latency),
                })
            } else {
                Ok(ProxyTestResult {
                    success: false,
                    message: format!("目标返回状态码 {}", response.status()),
                    latency: Some(latency),
                })
            }
        }
        Err(error) => Ok(ProxyTestResult {
            success: false,
            message: error.to_string(),
            latency: None,
        }),
    }
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
                tray.on_tray_icon_event(move |tray, event| match event {
                    TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } => {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            let app = tray.app_handle().clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = app.get_webview_window("main") {
                                    let is_visible = window.is_visible().unwrap_or(false);
                                    println!("[托盘] 窗口当前状态: visible={}", is_visible);

                                    if is_visible {
                                        println!("[托盘] 开始隐藏流程...");
                                        // 先通知前端隐藏所有 webview
                                        let _ = window.emit("hideAllWebviews", ());
                                        // 等待 webview 隐藏完成
                                        tokio::time::sleep(tokio::time::Duration::from_millis(100))
                                            .await;
                                        // 然后隐藏主窗口
                                        match window.hide() {
                                            Ok(_) => println!("[托盘] 主窗口隐藏成功"),
                                            Err(e) => println!("[托盘] 主窗口隐藏失败: {}", e),
                                        }
                                    } else {
                                        println!("[托盘] 开始显示流程...");
                                        match window.show() {
                                            Ok(_) => println!("[托盘] 主窗口显示成功"),
                                            Err(e) => println!("[托盘] 主窗口显示失败: {}", e),
                                        }
                                        let _ = window.set_focus();
                                    }
                                }
                            });
                        }
                    }
                    _ => {}
                });

                // 托盘菜单事件
                tray.on_menu_event(move |app, event| match event.id.as_ref() {
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
                let _ =
                    app.global_shortcut()
                        .on_shortcut(shortcut, move |_app, _event, _shortcut| {
                            let handle = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some(window) = handle.get_webview_window("main") {
                                    let is_visible = window.is_visible().unwrap_or(false);
                                    println!("[快捷键] 窗口当前状态: visible={}", is_visible);

                                    if is_visible {
                                        println!("[快捷键] 开始隐藏流程...");
                                        // 先通知前端隐藏所有 webview
                                        let _ = window.emit("hideAllWebviews", ());
                                        // 等待 webview 隐藏完成
                                        tokio::time::sleep(tokio::time::Duration::from_millis(100))
                                            .await;
                                        // 然后隐藏主窗口
                                        match window.hide() {
                                            Ok(_) => println!("[快捷键] 主窗口隐藏成功"),
                                            Err(e) => println!("[快捷键] 主窗口隐藏失败: {}", e),
                                        }
                                    } else {
                                        println!("[快捷键] 开始显示流程...");
                                        match window.show() {
                                            Ok(_) => println!("[快捷键] 主窗口显示成功"),
                                            Err(e) => println!("[快捷键] 主窗口显示失败: {}", e),
                                        }
                                        let _ = window.set_focus();
                                    }
                                }
                            });
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
            hide_window,
            test_proxy_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
