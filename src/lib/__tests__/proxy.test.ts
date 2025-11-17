import { describe, expect, it } from "vitest";
import { createProxySignature, resolveProxyUrl } from "$lib/utils/proxy";

describe("proxy utilities", () => {
  it("creates deterministic proxy signatures", () => {
    expect(createProxySignature(null)).toBe("system");
    expect(createProxySignature({ type: "system" })).toBe("system");
    expect(createProxySignature({ type: "custom", host: " 127.0.0.1 ", port: "8080" })).toBe(
      "custom:127.0.0.1:8080",
    );
  });

  it("resolves custom proxy urls with defaults", () => {
    expect(resolveProxyUrl(null)).toBeNull();
    expect(resolveProxyUrl({ type: "system" })).toBeNull();

    expect(resolveProxyUrl({ type: "custom", host: "127.0.0.1", port: "8080" })).toBe(
      "http://127.0.0.1:8080",
    );

    expect(resolveProxyUrl({ type: "custom", host: "socks5://192.168.0.1", port: "1080" })).toBe(
      "socks5://192.168.0.1:1080",
    );

    expect(resolveProxyUrl({ type: "custom", host: "invalid host" })).toBeNull();
  });

  it("uses port embedded in host url when missing explicit port", () => {
    expect(resolveProxyUrl({ type: "custom", host: "http://proxy.example.com:9000" })).toBe(
      "http://proxy.example.com:9000",
    );
  });
});
