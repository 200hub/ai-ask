use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[derive(Deserialize)]
struct ProxyParams {
    url: String,
}

/// 启动本地代理服务器
pub async fn start_proxy_server() -> Result<(), Box<dyn std::error::Error>> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/proxy", get(proxy_handler))
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], 9527));
    println!("Proxy server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// 代理请求处理器
async fn proxy_handler(Query(params): Query<ProxyParams>) -> Response {
    let target_url = params.url;

    // 构建请求
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    match client.get(&target_url).send().await {
        Ok(response) => {
            let body = response.text().await.unwrap_or_default();

            // 返回 HTML 响应
            (
                StatusCode::OK,
                [("content-type", "text/html; charset=utf-8")],
                body,
            )
                .into_response()
        }
        Err(err) => {
            eprintln!("Proxy error: {}", err);
            (StatusCode::BAD_GATEWAY, format!("Failed to fetch: {}", err)).into_response()
        }
    }
}
