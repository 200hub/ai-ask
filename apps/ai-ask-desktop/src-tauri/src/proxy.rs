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
    let parsed = Url::parse(url).map_err(|_| "Invalid provider URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Provider URL must use HTTP(S) with a host".into());
    }
    Ok(parsed)
}

/// 解析代理 URL（仅支持 http / socks5 协议）
pub(crate) fn parse_proxy_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "Invalid proxy URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "socks5") {
        return Err("Unsupported proxy protocol; use HTTP or SOCKS5".into());
    }
    if parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.port_or_known_default().is_none_or(|port| port == 0)
    {
        return Err("Proxy URL must contain only a host and port without credentials".into());
    }
    Ok(parsed)
}

pub(crate) fn custom_proxy_url(config: &ProxyTestConfig) -> Result<Url, String> {
    let host = config
        .host
        .as_deref()
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .ok_or_else(|| "Proxy host is required".to_string())?;
    let input = if host.contains("://") {
        host.to_owned()
    } else {
        format!("http://{host}")
    };
    let mut url = Url::parse(&input).map_err(|_| "Invalid proxy URL".to_string())?;
    if let Some(port) = config
        .port
        .as_deref()
        .map(str::trim)
        .filter(|port| !port.is_empty())
    {
        let port = port
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| "Proxy port must be an integer from 1 to 65535".to_string())?;
        url.set_port(Some(port))
            .map_err(|_| "Invalid proxy port".to_string())?;
    }
    parse_proxy_url(url.as_str())
}

fn configure_proxy(
    builder: reqwest::ClientBuilder,
    config: &ProxyTestConfig,
) -> Result<reqwest::ClientBuilder, String> {
    match config.proxy_type.as_str() {
        "system" => Ok(builder),
        "custom" => {
            let url = custom_proxy_url(config)?;
            let proxy = reqwest::Proxy::all(url.as_str())
                .map_err(|_| "Failed to configure custom proxy".to_string())?;
            Ok(builder.proxy(proxy))
        }
        _ => Err("Unsupported proxy type; use system or custom".into()),
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
    parse_proxy_url(proxy).ok()?;
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
    log::debug!("Testing proxy connection: type={}", config.proxy_type);

    let client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::limited(5));

    let client = configure_proxy(client_builder, &config)?
        .build()
        .map_err(|err| {
            log::error!("Failed to create HTTP client: {}", err);
            err.to_string()
        })?;

    let target_url = "https://www.example.com";
    let start = Instant::now();

    log::debug!("Sending request to: {}", target_url);

    match client.get(target_url).send().await {
        Ok(response) => {
            let latency = start.elapsed().as_millis();
            let status = response.status();

            log::info!(
                "Proxy test completed: status={}, latency={}ms",
                status,
                latency
            );

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

    fn custom(host: &str, port: Option<&str>) -> ProxyTestConfig {
        ProxyTestConfig {
            proxy_type: "custom".into(),
            host: Some(host.into()),
            port: port.map(str::to_owned),
        }
    }

    #[test]
    fn provider_urls_cannot_select_local_or_executable_schemes() {
        for url in [
            "file:///etc/passwd",
            "data:text/html,hello",
            "javascript:alert(1)",
            "tauri://localhost",
            "about:blank",
        ] {
            assert!(parse_external_url(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn custom_proxy_uses_explicit_port_before_embedded_port() {
        let url = custom_proxy_url(&custom("socks5://127.0.0.1:1000", Some("2000"))).unwrap();
        assert_eq!(url.scheme(), "socks5");
        assert_eq!(url.port(), Some(2000));
        assert_eq!(
            custom_proxy_url(&custom("localhost:3000", None))
                .unwrap()
                .port(),
            Some(3000)
        );
        assert_eq!(
            custom_proxy_url(&custom("http://localhost", None))
                .unwrap()
                .port_or_known_default(),
            Some(80)
        );
        assert_eq!(
            custom_proxy_url(&custom("socks5://localhost", Some("1080")))
                .unwrap()
                .port(),
            Some(1080)
        );
    }

    #[test]
    fn custom_proxy_rejects_unsafe_urls_and_invalid_ports() {
        for host in [
            "http://user:secret@localhost:8080",
            "http://localhost:8080/path",
            "http://localhost:8080?token=secret",
            "http://localhost:8080#fragment",
            "https://localhost:8080",
            "socks5://localhost",
        ] {
            assert!(
                custom_proxy_url(&custom(host, None)).is_err(),
                "accepted {host}"
            );
        }
        for port in ["0", "65536", "abc", "-1", "80/path"] {
            assert!(custom_proxy_url(&custom("localhost", Some(port))).is_err());
        }
        let legacy = ProxyTestConfig {
            proxy_type: "none".into(),
            host: None,
            port: None,
        };
        assert!(configure_proxy(reqwest::Client::builder(), &legacy).is_err());
    }

    #[tokio::test]
    async fn socks5_client_uses_the_configured_proxy_and_port_override() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut greeting = [0; 2];
            stream.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting[0], 5);
            let mut methods = vec![0; greeting[1] as usize];
            stream.read_exact(&mut methods).await.unwrap();
            stream.write_all(&[5, 0]).await.unwrap();
            let mut request = [0; 4];
            stream.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [5, 1, 0, 1]);
            let mut address = [0; 6];
            stream.read_exact(&mut address).await.unwrap();
            stream
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 9])
                .await
                .unwrap();
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") {
                headers.push(stream.read_u8().await.unwrap());
                assert!(headers.len() < 4096);
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                .await
                .unwrap();
        });
        let client = configure_proxy(
            reqwest::Client::builder(),
            &custom("socks5://127.0.0.1:1", Some(&port)),
        )
        .unwrap()
        .build()
        .unwrap();
        let response = tokio::time::timeout(
            Duration::from_secs(5),
            client.get("http://127.0.0.1:9/probe").send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(response.text().await.unwrap(), "OK");
        server.await.unwrap();
    }
}
