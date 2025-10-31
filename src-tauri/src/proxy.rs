//! 代理工具与测试模块/// 代理测试模块

//!///

//! 代理相关工具模块
//!
//! 提供以下能力：
//! - 解析外部 URL 与代理 URL
//! - 为不同代理配置生成独立的数据目录
//! - 测试代理连通性

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Url, Window};

/// 代理测试配置
#[derive(Debug, Deserialize)]
pub(crate) struct ProxyTestConfig {
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub host: Option<String>,
    pub port: Option<String>,
}

/// 代理测试结果
#[derive(Debug, Serialize)]
pub(crate) struct ProxyTestResult {
    pub success: bool,
    pub message: String,
    pub latency: Option<u128>,
}

/// 解析外部 URL
pub(crate) fn parse_external_url(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|err| {
        log::error!("解析 URL 失败: {} - {}", url, err);
        err.to_string()
    })
}

/// 解析代理 URL（仅支持 http / socks5 协议）
pub(crate) fn parse_proxy_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|err| {
        log::error!("解析代理 URL 失败: {} - {}", url, err);
        err.to_string()
    })?;

    match parsed.scheme() {
        "http" | "socks5" => Ok(parsed),
        scheme => {
            log::error!("不支持的代理协议: {}", scheme);
            Err(format!("不支持的代理协议: {scheme}"))
        }
    }
}

/// 为代理配置生成数据目录路径
///
/// Windows WebView2 在不同代理配置下需要使用隔离的数据目录，
/// 否则网络设置会被忽略。
pub(crate) fn resolve_proxy_data_directory(window: &Window, proxy: Option<&str>) -> Option<PathBuf> {
    let proxy = proxy?;
    let resolver = window.app_handle().path();
    let base_dir = resolver
        .app_data_dir()
        .or_else(|_| resolver.app_cache_dir())
        .ok()?;

    let dir = base_dir
        .join("webview-proxies")
        .join(sanitize_for_directory(proxy));

    if let Err(err) = fs::create_dir_all(&dir) {
        log::error!("创建代理数据目录失败 {:?}: {}", dir, err);
        return None;
    }

    log::debug!("代理数据目录: {:?}", dir);
    Some(dir)
}

fn sanitize_for_directory(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

/// 测试代理连通性
#[tauri::command]
pub(crate) async fn test_proxy_connection(config: ProxyTestConfig) -> Result<ProxyTestResult, String> {
    log::debug!("开始测试代理: type={}", config.proxy_type);

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
                .ok_or_else(|| {
                    log::error!("代理地址为空");
                    "代理地址不能为空".to_string()
                })?;

            let port = config
                .port
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    log::error!("代理端口为空");
                    "代理端口不能为空".to_string()
                })?;

            let proxy_url = if host.contains("://") {
                host.to_string()
            } else {
                format!("http://{}:{}", host, port)
            };

            log::debug!("使用自定义代理: {}", proxy_url);

            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| {
                log::error!("创建代理配置失败: {}", err);
                err.to_string()
            })?;
            client_builder = client_builder.proxy(proxy);
        }
        "system" => {
            log::debug!("使用系统代理");
        }
        "none" => {
            log::debug!("不使用代理");
        }
        other => {
            log::error!("不支持的代理类型: {}", other);
            return Err(format!("不支持的代理类型: {other}"));
        }
    }

    let client = client_builder.build().map_err(|err| {
        log::error!("创建 HTTP 客户端失败: {}", err);
        err.to_string()
    })?;

    let target_url = "https://www.example.com";
    let start = Instant::now();

    log::debug!("开始请求: {}", target_url);

    match client.get(target_url).send().await {
        Ok(response) => {
            let latency = start.elapsed().as_millis();
            let status = response.status();

            log::info!("代理测试完成: 状态码={}, 延迟={}ms", status, latency);

            if status.is_success() {
                Ok(ProxyTestResult {
                    success: true,
                    message: "连接成功".into(),
                    latency: Some(latency),
                })
            } else {
                Ok(ProxyTestResult {
                    success: false,
                    message: format!("目标返回状态码 {}", status),
                    latency: Some(latency),
                })
            }
        }
        Err(error) => {
            log::warn!("代理连接失败: {}", error);
            Ok(ProxyTestResult {
                success: false,
                message: error.to_string(),
                latency: None,
            })
        }
    }
}
