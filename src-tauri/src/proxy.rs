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
#[derive(Debug, Deserialize, Clone)]
pub struct ProxyTestConfig {
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
        log::error!("Failed to parse URL: {} - {}", url, err);
        err.to_string()
    })
}

/// 解析代理 URL（仅支持 http / socks5 协议）
pub(crate) fn parse_proxy_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|err| {
        log::error!("Failed to parse proxy URL: {} - {}", url, err);
        err.to_string()
    })?;

    match parsed.scheme() {
        "http" | "socks5" => Ok(parsed),
        scheme => {
            log::error!("Unsupported proxy protocol: {}", scheme);
            Err(format!("Unsupported proxy protocol: {scheme}"))
        }
    }
}

/// 为代理配置生成数据目录路径
///
/// Windows WebView2 在不同代理配置下需要使用隔离的数据目录，
/// 否则网络设置会被忽略。
pub(crate) fn resolve_proxy_data_directory(
    window: &Window,
    proxy: Option<&str>,
) -> Option<PathBuf> {
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
        log::error!("Failed to create proxy data directory {:?}: {}", dir, err);
        return None;
    }

    log::debug!("Proxy data directory: {:?}", dir);
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
pub(crate) async fn test_proxy_connection(
    config: ProxyTestConfig,
) -> Result<ProxyTestResult, String> {
    log::debug!("Starting proxy test: type={}", config.proxy_type);

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
                    log::error!("Proxy host is empty");
                    "Proxy host cannot be empty".to_string()
                })?;

            let port = config
                .port
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    log::error!("Proxy port is empty");
                    "Proxy port cannot be empty".to_string()
                })?;

            let proxy_url = if host.contains("://") {
                host.to_string()
            } else {
                format!("http://{}:{}", host, port)
            };

            log::debug!("Using custom proxy: {}", proxy_url);

            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|err| {
                log::error!("Failed to create proxy configuration: {}", err);
                err.to_string()
            })?;
            client_builder = client_builder.proxy(proxy);
        }
        "system" => {
            log::debug!("Using system proxy");
        }
        "none" => {
            log::debug!("Not using proxy");
        }
        other => {
            log::error!("Unsupported proxy type: {}", other);
            return Err(format!("Unsupported proxy type: {other}"));
        }
    }

    let client = client_builder.build().map_err(|err| {
        log::error!("Failed to create HTTP client: {}", err);
        err.to_string()
    })?;

    let target_url = "https://www.example.com";
    let start = Instant::now();

    log::debug!("Starting request: {}", target_url);

    match client.get(target_url).send().await {
        Ok(response) => {
            let latency = start.elapsed().as_millis();
            let status = response.status();

            log::info!("Proxy test completed: status={}, latency={}ms", status, latency);

            if status.is_success() {
                Ok(ProxyTestResult {
                    success: true,
                    message: "Connection successful".into(),
                    latency: Some(latency),
                })
            } else {
                Ok(ProxyTestResult {
                    success: false,
                    message: format!("Target returned status code {}", status),
                    latency: Some(latency),
                })
            }
        }
        Err(error) => {
            log::warn!("Proxy connection failed: {}", error);
            Ok(ProxyTestResult {
                success: false,
                message: error.to_string(),
                latency: None,
            })
        }
    }
}

/// 根据代理配置构建 reqwest 客户端
pub fn build_client_with_proxy(config: &ProxyTestConfig) -> Result<reqwest::Client, String> {
    use reqwest::redirect::Policy;
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(Policy::limited(5));

    match config.proxy_type.as_str() {
        "custom" => {
            let host = config
                .host
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| "Proxy host cannot be empty".to_string())?;
            let port = config
                .port
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| "Proxy port cannot be empty".to_string())?;
            let proxy_url = if host.contains("://") {
                host.to_string()
            } else {
                format!("http://{}:{}", host, port)
            };
            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| e.to_string())?;
            builder = builder.proxy(proxy);
        }
        "system" => { /* no explicit proxy; reqwest picks env/system if set */ }
        "none" => { /* no proxy */ }
        other => return Err(format!("Unsupported proxy type: {}", other)),
    }

    builder.build().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_external_url_accepts_valid_http() {
        let result = parse_external_url("https://example.com/path?query=1");
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.host_str(), Some("example.com"));
        assert_eq!(parsed.scheme(), "https");
    }

    #[test]
    fn parse_external_url_rejects_invalid_input() {
        let result = parse_external_url("not a url");
        assert!(result.is_err());
    }

    #[test]
    fn parse_proxy_url_accepts_http_and_socks5() {
        assert!(parse_proxy_url("http://localhost:8080").is_ok());
        assert!(parse_proxy_url("socks5://127.0.0.1:1080").is_ok());
    }

    #[test]
    fn parse_proxy_url_rejects_unsupported_scheme() {
        let error = parse_proxy_url("ftp://proxy:21").expect_err("expected unsupported scheme");
        assert!(error.contains("Unsupported proxy protocol"));
    }

    #[test]
    fn sanitize_for_directory_replaces_non_alphanumeric() {
        let sanitized = sanitize_for_directory("http://127.0.0.1:8080/path?query");
        assert_eq!(sanitized, "http___127_0_0_1_8080_path_query");
    }

    #[test]
    fn sanitize_for_directory_keeps_alphanumeric() {
        let sanitized = sanitize_for_directory("abcXYZ123");
        assert_eq!(sanitized, "abcXYZ123");
    }

    #[test]
    fn parse_proxy_url_rejects_missing_host() {
        assert!(parse_proxy_url("http://:8080").is_err());
    }

    #[test]
    fn parse_proxy_url_handles_trailing_slash() {
        let parsed = parse_proxy_url("http://localhost:8080/").expect("expected valid proxy url");
        assert_eq!(parsed.host_str(), Some("localhost"));
        assert_eq!(parsed.port_or_known_default(), Some(8080));
    }
}
