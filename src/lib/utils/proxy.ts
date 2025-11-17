/**
 * 代理配置工具模块
 *
 * 提供代理配置的处理和验证功能：
 * - 生成代理配置签名（用于检测配置变化）
 * - 解析和验证代理URL
 * - 标准化代理配置格式
 */

import type { ProxyConfig } from "$lib/types/config";
import { logger } from "$lib/utils/logger";

/**
 * 创建代理配置签名
 *
 * 用于检测代理配置是否发生变化，避免不必要的 webview 重建
 *
 * 签名格式：
 * - 系统代理：'system'
 * - 自定义代理：'custom:host:port'
 *
 * @param proxy - 代理配置对象
 * @returns 代理配置的唯一签名字符串
 *
 * @example
 * ```typescript
 * createProxySignature({ type: 'system' }) // 返回: 'system'
 * createProxySignature({ type: 'custom', host: '127.0.0.1', port: '8080' }) // 返回: 'custom:127.0.0.1:8080'
 * ```
 */
let lastLoggedSignature: string | null = null;

export function createProxySignature(proxy: ProxyConfig | null | undefined): string {
  const signature =
    !proxy || proxy.type === "system"
      ? "system"
      : `custom:${(proxy.host ?? "").trim()}:${(proxy.port ?? "").trim()}`;

  if (signature !== lastLoggedSignature) {
    lastLoggedSignature = signature;

    if (signature === "system") {
      logger.debug("Proxy mode changed to system proxy");
    } else {
      const [, host = "", port = ""] = signature.split(":");
      logger.debug("Proxy mode changed to custom proxy", { host, port });
    }
  }

  return signature;
}

/**
 * 解析代理配置为标准 URL 格式
 *
 * 将用户输入的代理配置转换为标准的代理 URL 字符串，
 * 支持以下输入格式：
 * - IP地址：127.0.0.1
 * - 域名：proxy.example.com
 * - 完整URL：http://proxy.example.com
 * - 带协议：socks5://127.0.0.1
 *
 * @param proxy - 代理配置对象
 * @returns 标准化的代理 URL 字符串，无效配置返回 null
 *
 * @example
 * ```typescript
 * resolveProxyUrl({ type: 'custom', host: '127.0.0.1', port: '8080' })
 * // 返回: 'http://127.0.0.1:8080'
 *
 * resolveProxyUrl({ type: 'custom', host: 'socks5://127.0.0.1', port: '1080' })
 * // 返回: 'socks5://127.0.0.1:1080'
 *
 * resolveProxyUrl({ type: 'system' })
 * // 返回: null
 * ```
 */
export function resolveProxyUrl(proxy: ProxyConfig | null | undefined): string | null {
  // 如果是系统代理或未配置，返回 null
  if (!proxy || proxy.type !== "custom") {
    return null;
  }

  const rawHost = proxy.host?.trim();
  const rawPort = proxy.port?.trim();

  // 验证：必须有主机地址
  if (!rawHost) {
    logger.warn("Custom proxy missing host address");
    return null;
  }

  // 解析主机地址为 URL 对象
  let parsedUrl: URL;
  try {
    // 如果没有协议前缀，默认添加 http://
    const urlString = rawHost.includes("://") ? rawHost : `http://${rawHost}`;
    parsedUrl = new URL(urlString);

    logger.debug("Successfully parsed proxy host", {
      raw: rawHost,
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
    });
  } catch (error) {
    logger.error("Invalid proxy host address", { host: rawHost, error });
    return null;
  }

  // 提取协议（移除结尾的冒号）
  const scheme = parsedUrl.protocol ? parsedUrl.protocol.replace(":", "") : "http";

  // 获取主机名
  const hostname = parsedUrl.hostname || parsedUrl.host;

  // 验证：主机名不能为空
  if (!hostname) {
    logger.error("Failed to extract valid hostname from proxy configuration", {
      parsedUrl: parsedUrl.href,
    });
    return null;
  }

  // 确定端口：优先使用用户配置的端口，其次使用 URL 中的端口
  const port = (rawPort && rawPort.trim()) || parsedUrl.port;

  // 构建最终的代理 URL
  const proxyUrl = port ? `${scheme}://${hostname}:${port}` : `${scheme}://${hostname}`;

  logger.info("Resolved proxy URL", {
    scheme,
    hostname,
    port,
    finalUrl: proxyUrl,
  });

  return proxyUrl;
}
