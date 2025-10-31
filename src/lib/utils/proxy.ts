import type { ProxyConfig } from "$lib/types/config";

export function createProxySignature(proxy: ProxyConfig | null | undefined): string {
    if (!proxy || proxy.type === "system") {
        return "system";
    }

    const host = proxy.host?.trim() ?? "";
    const port = proxy.port?.trim() ?? "";
    return `custom:${host}:${port}`;
}

export function resolveProxyUrl(proxy: ProxyConfig | null | undefined): string | null {
    if (!proxy || proxy.type !== "custom") {
        return null;
    }

    const rawHost = proxy.host?.trim();
    const rawPort = proxy.port?.trim();

    if (!rawHost) {
        return null;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawHost.includes("://") ? rawHost : `http://${rawHost}`);
    } catch (error) {
        console.error("Invalid proxy host", error);
        return null;
    }

    const scheme = parsedUrl.protocol ? parsedUrl.protocol.replace(":", "") : "http";
    const hostname = parsedUrl.hostname || parsedUrl.host;

    if (!hostname) {
        return null;
    }

    const port = (rawPort && rawPort.trim()) || parsedUrl.port;

    if (port) {
        return `${scheme}://${hostname}:${port}`;
    }

    return `${scheme}://${hostname}`;
}
