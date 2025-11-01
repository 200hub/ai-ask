//! 子 WebView 管理模块
//!
//! 负责维护子 WebView 的生命周期，包括创建、边界同步、
//! 可见性切换以及代理配置更新时的安全重建。

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use serde::Deserialize;
use tauri::{
    webview::{Webview, WebviewBuilder},
    LogicalPosition, LogicalSize, Position, Size, State, WebviewUrl, Window,
};

use crate::proxy::{parse_external_url, parse_proxy_url, resolve_proxy_data_directory};

/// 保存所有活跃子 WebView 实例
#[derive(Default)]
pub(crate) struct ChildWebviewManager {
    webviews: Mutex<HashMap<String, ManagedWebview>>,
}

impl ChildWebviewManager {
    /// 向指定子 webview 注入并执行 JavaScript 脚本
    pub fn inject_script(&self, webview_id: &str, script: &str) -> Result<(), String> {
        let webviews = self
            .webviews
            .lock()
            .map_err(|err| format!("failed to lock webview map: {err}"))?;

        if let Some(entry) = webviews.get(webview_id) {
            entry
                .webview
                .eval(script)
                .map_err(|err| format!("脚本执行失败: {err}"))?;
            Ok(())
        } else {
            Err(format!("子 webview 不存在: {}", webview_id))
        }
    }
}

struct ManagedWebview {
    webview: Webview,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PositionPayload {
    #[serde(rename = "x")]
    x: f64,
    #[serde(rename = "y")]
    y: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SizePayload {
    #[serde(rename = "width")]
    width: f64,
    #[serde(rename = "height")]
    height: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BoundsPayload {
    #[serde(rename = "positionLogical")]
    position_logical: PositionPayload,
    #[serde(rename = "sizeLogical")]
    size_logical: SizePayload,
    #[serde(rename = "scaleFactor")]
    _scale_factor: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnsureChildWebviewPayload {
    id: String,
    url: String,
    bounds: BoundsPayload,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewBoundsUpdatePayload {
    id: String,
    bounds: BoundsPayload,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChildWebviewIdPayload {
    id: String,
}

/// 读取子 WebView 的 URL fragment（如果存在）
#[tauri::command]
pub(crate) async fn get_child_webview_fragment(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<Option<String>, String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        match entry.webview.url() {
            Ok(url) => Ok(url.fragment().map(|s| s.to_string())),
            Err(err) => Err(err.to_string()),
        }
    } else {
        Err(format!("子 webview 不存在: {}", payload.id))
    }
}

/// 清空子 WebView 的 URL fragment
#[tauri::command]
pub(crate) async fn clear_child_webview_fragment(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;
    if let Some(entry) = webviews.get(&payload.id) {
        if let Ok(mut url) = entry.webview.url() {
            if url.fragment().is_some() {
                url.set_fragment(None);
                entry.webview.navigate(url).map_err(|err| err.to_string())?;
            }
        }
        Ok(())
    } else {
        Err(format!("子 webview 不存在: {}", payload.id))
    }
}

fn logical_position(bounds: &BoundsPayload) -> LogicalPosition<f64> {
    LogicalPosition::new(bounds.position_logical.x, bounds.position_logical.y)
}

fn logical_size(bounds: &BoundsPayload) -> LogicalSize<f64> {
    LogicalSize::new(bounds.size_logical.width, bounds.size_logical.height)
}

/// 确保子 WebView 存在或在代理发生变化时重建
#[tauri::command]
pub(crate) async fn ensure_child_webview(
    window: Window,
    state: State<'_, ChildWebviewManager>,
    payload: EnsureChildWebviewPayload,
) -> Result<(), String> {
    log::debug!(
        "确保子 webview 存在: id={}, url={}, proxy={:?}",
        payload.id,
        payload.url,
        payload.proxy_url
    );

    let position = logical_position(&payload.bounds);
    let size = logical_size(&payload.bounds);

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    let requested_proxy = payload.proxy_url.as_deref();
    let should_recreate = webviews
        .get(&payload.id)
        .map(|entry| entry.proxy_url.as_deref() != requested_proxy)
        .unwrap_or(false);

    if should_recreate {
        log::info!("代理配置变化，重建子 webview: {}", payload.id);
        if let Some(entry) = webviews.remove(&payload.id) {
            let _ = entry.webview.close();
        }
    }

    if let Some(entry) = webviews.get(&payload.id) {
        let webview = &entry.webview;

        if let Ok(current_url) = webview.url() {
            if current_url.as_str() != payload.url {
                log::debug!("更新子 webview URL: {} -> {}", current_url, payload.url);
                webview
                    .navigate(parse_external_url(&payload.url)?)
                    .map_err(|err| err.to_string())?;
            }
        }

        webview
            .set_position(Position::Logical(position))
            .map_err(|err| err.to_string())?;
        webview
            .set_size(Size::Logical(size))
            .map_err(|err| err.to_string())?;
        log::debug!("子 webview 已更新: {}", payload.id);
    } else {
        log::info!("创建新的子 webview: {}", payload.id);

        // Quick Ask 初始化脚本：在 webview 页面加载时执行
        // 这个脚本会在页面的全局作用域中注入一个函数，供 Quick Ask 调用
        // 同时监听 URL hash 变化（#__qa=...）以便从宿主侧通过导航触发注入（Plan A）
        let init_script = r#"
(function() {
    // Quick Ask 注入函数
    window.__quickAskInject = function(question) {
        // 尝试各种平台的输入选择器和发送按钮
        const strategies = [
            // ChatGPT
            {
                input: document.querySelector('#prompt-textarea'),
                send: document.querySelector('button[data-testid="send-button"]'),
                setInput: (el, text) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
            },
            // Claude
            {
                input: document.querySelector('div[contenteditable="true"]'),
                send: document.querySelector('button[aria-label="Send Message"]'),
                setInput: (el, text) => { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
            },
            // Gemini
            {
                input: document.querySelector('.ql-editor'),
                send: document.querySelector('button[aria-label="Send message"]'),
                setInput: (el, text) => { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
            }
        ];

        for (const strategy of strategies) {
            if (strategy.input && strategy.send) {
                strategy.setInput(strategy.input, question);
                setTimeout(() => strategy.send.click(), 200);
                return { success: true };
            }
        }

        return { success: false, error: 'No matching input/send found' };
    };

        // Plan A: 通过 URL Hash 传递问题文本
        // 约定格式：#__qa=<encodeURIComponent(base64(question))>
        function b64DecodeUnicode(str) {
            try {
                return decodeURIComponent(Array.prototype.map.call(atob(str), function(c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
            } catch (e) {
                return null;
            }
        }

        function processHash() {
            try {
                if (!location.hash) return;
                const hash = location.hash.replace(/^#/, '');
                if (!hash.startsWith('__qa=')) return;
                const b64 = hash.slice('__qa='.length);
                const decoded = b64DecodeUnicode(b64);
                if (decoded) {
                    // 执行注入
                    window.__quickAskInject(decoded);
                }
                // 清理 hash，避免重复触发
                try {
                    const url = new URL(location.href);
                    url.hash = '';
                    history.replaceState(null, document.title, url.toString());
                } catch (_) {}
            } catch (err) {
                // no-op
            }
        }

        // 初次加载时尝试处理一次
        processHash();
        // 监听后续 hash 变化
        window.addEventListener('hashchange', processHash, false);
})();
"#;

        let mut builder = WebviewBuilder::new(
            payload.id.clone(),
            WebviewUrl::External(parse_external_url(&payload.url)?),
        )
        .initialization_script(init_script);

        if let Some(proxy_url) = requested_proxy {
            builder = builder.proxy_url(parse_proxy_url(proxy_url)?);
            if let Some(data_dir) = resolve_proxy_data_directory(&window, requested_proxy) {
                builder = builder.data_directory(data_dir);
            }
        }

        let child = window
            .add_child(builder, position, size)
            .map_err(|err| err.to_string())?;

        let _ = child.hide();

        webviews.insert(
            payload.id.clone(),
            ManagedWebview {
                webview: child,
                proxy_url: payload.proxy_url.clone(),
            },
        );
        log::info!(
            "子 webview 创建成功（含 Quick Ask 初始化脚本）: {}",
            payload.id
        );
    }

    Ok(())
}

/// 更新子 WebView 边界
#[tauri::command]
pub(crate) async fn set_child_webview_bounds(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewBoundsUpdatePayload,
) -> Result<(), String> {
    log::debug!("设置子 webview 边界: {}", payload.id);

    let position = logical_position(&payload.bounds);
    let size = logical_size(&payload.bounds);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry
            .webview
            .set_position(Position::Logical(position))
            .map_err(|err| err.to_string())?;
        entry
            .webview
            .set_size(Size::Logical(size))
            .map_err(|err| err.to_string())?;
        log::debug!("子 webview 边界已更新: {}", payload.id);
    }

    Ok(())
}

/// 显示指定子 WebView
#[tauri::command]
pub(crate) async fn show_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("显示子 webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.show().map_err(|err| err.to_string())?;
        let _ = entry.webview.set_focus();
        log::debug!("子 webview 已显示: {}", payload.id);
    }

    Ok(())
}

/// 隐藏指定子 WebView
#[tauri::command]
pub(crate) async fn hide_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("隐藏子 webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.hide().map_err(|err| err.to_string())?;
        log::debug!("子 webview 已隐藏: {}", payload.id);
    }

    Ok(())
}

/// 关闭并移除指定子 WebView
#[tauri::command]
pub(crate) async fn close_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("关闭子 webview: {}", payload.id);

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.remove(&payload.id) {
        entry.webview.close().map_err(|err| err.to_string())?;
        log::info!("子 webview 已关闭: {}", payload.id);
    }

    Ok(())
}

/// 聚焦指定子 WebView
#[tauri::command]
pub(crate) async fn focus_child_webview(
    state: State<'_, ChildWebviewManager>,
    payload: ChildWebviewIdPayload,
) -> Result<(), String> {
    log::debug!("聚焦子 webview: {}", payload.id);

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        entry.webview.set_focus().map_err(|err| err.to_string())?;
        log::debug!("子 webview 已聚焦: {}", payload.id);
    }

    Ok(())
}

/// 隐藏所有子 WebView
#[tauri::command]
pub(crate) async fn hide_all_child_webviews(
    state: State<'_, ChildWebviewManager>,
) -> Result<(), String> {
    log::debug!("隐藏所有子 webview");

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    for entry in webviews.values() {
        let _ = entry.webview.hide();
    }

    log::debug!("所有子 webview 已隐藏");
    Ok(())
}

/// Quick Ask 注入脚本 payload
#[derive(Debug, Deserialize)]
pub(crate) struct InjectScriptPayload {
    /// 目标平台 ID
    pub id: String,
    /// 要执行的 JavaScript 脚本
    pub script: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct QuickAskPayload {
    /// 目标平台 ID
    id: String,
    /// 注入的问题文本
    question: String,
}

/// 向指定子 WebView 注入并执行 JavaScript 脚本
///
/// 直接执行传入的 JavaScript 代码，返回执行结果的 JSON 字符串。
/// 如果脚本执行出错，返回错误信息。
#[tauri::command]
pub(crate) async fn inject_script_to_child_webview(
    _window: Window,
    state: State<'_, ChildWebviewManager>,
    payload: InjectScriptPayload,
) -> Result<String, String> {
    log::debug!(
        "Quick Ask: 向 {} 注入脚本 (长度: {} 字节)",
        payload.id,
        payload.script.len()
    );

    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        log::debug!(
            "Quick Ask: 脚本预览: {}...",
            &payload.script[..payload.script.len().min(200)]
        );

        // Execute JS script in child webview using eval
        entry
            .webview
            .eval(&payload.script)
            .map_err(|err| format!("脚本执行失败: {err}"))?;

        log::info!("Quick Ask: 脚本执行已提交到 {}", payload.id);
        Ok(String::from("{\"status\":\"injected\"}"))
    } else {
        let err_msg = format!("子 webview 不存在: {}", payload.id);
        log::warn!("{}", err_msg);
        Err(err_msg)
    }
}

/// 通过修改 URL hash 将问题文本传入子 webview（Plan A）
/// 约定：设置 hash 为 `#__qa=<base64(question)>`，由初始化脚本监听并注入。
#[tauri::command]
pub(crate) async fn quick_ask_via_hash(
    state: State<'_, ChildWebviewManager>,
    payload: QuickAskPayload,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|err| format!("failed to lock webview map: {err}"))?;

    if let Some(entry) = webviews.get(&payload.id) {
        // 获取当前 URL，并更新其 hash
        if let Ok(current_url) = entry.webview.url() {
            let mut url = current_url;
            // 使用 base64 编码（JS 端会解码并执行注入）
            let b64 = base64::engine::general_purpose::STANDARD.encode(payload.question.as_bytes());
            let new_hash = format!("__qa={}", b64);
            url.set_fragment(Some(&new_hash));
            log::debug!("Quick Ask: 导航到包含问题的 hash: {}", url.as_str());
            entry
                .webview
                .navigate(parse_external_url(url.as_str())?)
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    } else {
        Err(format!("子 webview 不存在: {}", payload.id))
    }
}
