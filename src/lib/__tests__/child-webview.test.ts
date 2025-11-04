import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildWebviewBounds } from "$lib/utils/childWebview";

const invokeMock = vi.fn();
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("$lib/utils/logger", () => ({
  logger: loggerMock,
}));

describe("child webview utilities", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    document.body.innerHTML = "";
  });

  it("compares bounds with epsilon tolerance", async () => {
    const { boundsEqual, BOUNDS_EPSILON } = await import("$lib/utils/childWebview");

    const a = {
      positionLogical: { x: 10, y: 10 },
      sizeLogical: { width: 100, height: 100 },
      scaleFactor: 1,
    } satisfies ChildWebviewBounds;

    const b = {
      positionLogical: { x: 10 + BOUNDS_EPSILON / 2, y: 10 },
      sizeLogical: { width: 100, height: 100 },
      scaleFactor: 1,
    } satisfies ChildWebviewBounds;

    expect(boundsEqual(a, b)).toBe(true);
  });

  it("calculates bounds based on layout elements", async () => {
    const sidebar = document.createElement("div");
    sidebar.className = "sidebar";
    Object.defineProperty(sidebar, "offsetWidth", { value: 120, configurable: true });

    const header = document.createElement("div");
    header.className = "header";
    Object.defineProperty(header, "offsetHeight", { value: 60, configurable: true });

    const main = document.createElement("div");
    main.className = "main-content";
    main.getBoundingClientRect = () => ({
      left: 140,
      top: 80,
      width: 640,
      height: 480,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    document.body.append(sidebar, header, main);

    const { calculateChildWebviewBounds } = await import("$lib/utils/childWebview");

    const mainWindow = {
      scaleFactor: vi.fn().mockResolvedValue(1),
      innerSize: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    } as unknown as import("@tauri-apps/api/webviewWindow").WebviewWindow;

    const result = await calculateChildWebviewBounds(mainWindow);

    expect(result.positionLogical).toEqual({ x: 140, y: 80 });
    expect(result.sizeLogical).toEqual({ width: 640, height: 480 });
    expect(result.scaleFactor).toBe(1);
  });

  it("falls back to defaults when calculation fails", async () => {
    const { calculateChildWebviewBounds } = await import("$lib/utils/childWebview");

    loggerMock.error.mockClear();

    const faultyWindow = {
      scaleFactor: vi.fn().mockRejectedValue(new Error("boom")),
      innerSize: vi.fn(),
    } as unknown as import("@tauri-apps/api/webviewWindow").WebviewWindow;

    const result = await calculateChildWebviewBounds(faultyWindow);

    expect(result).toEqual({
      positionLogical: { x: 100, y: 100 },
      sizeLogical: { width: 800, height: 600 },
      scaleFactor: 1,
    });

    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("manages child webview lifecycle calls", async () => {
    const { ChildWebviewProxy } = await import("$lib/utils/childWebview");
    const bounds: ChildWebviewBounds = {
      positionLogical: { x: 0, y: 0 },
      sizeLogical: { width: 400, height: 300 },
      scaleFactor: 1,
    };

    const proxy = new ChildWebviewProxy("webview-1", "https://ai.example.com", null);

    await proxy.ensure(bounds);
    expect(invokeMock).toHaveBeenCalledWith("ensure_child_webview", {
      payload: {
        id: "webview-1",
        url: "https://ai.example.com",
        bounds,
        proxyUrl: null,
      },
    });

    invokeMock.mockClear();

    await proxy.updateBounds(bounds);
    expect(invokeMock).not.toHaveBeenCalled();

    const newBounds = { ...bounds, sizeLogical: { width: 480, height: 300 } };
    await proxy.updateBounds(newBounds);
    expect(invokeMock).toHaveBeenCalledWith("set_child_webview_bounds", {
      payload: { id: "webview-1", bounds: newBounds },
    });

    invokeMock.mockClear();

    await proxy.show();
    expect(invokeMock).toHaveBeenCalledWith("show_child_webview", {
      payload: { id: "webview-1" },
    });
    expect(proxy.isVisible()).toBe(true);

    invokeMock.mockClear();

    await proxy.show();
    expect(invokeMock).not.toHaveBeenCalled();

    await proxy.hide();
    expect(invokeMock).toHaveBeenCalledWith("hide_child_webview", {
      payload: { id: "webview-1" },
    });
    expect(proxy.isVisible()).toBe(false);

    invokeMock.mockClear();

    await proxy.hide();
    expect(invokeMock).not.toHaveBeenCalled();

    await proxy.setFocus();
    expect(invokeMock).toHaveBeenCalledWith("focus_child_webview", {
      payload: { id: "webview-1" },
    });

    await proxy.show();
    await proxy.close();
    expect(invokeMock).toHaveBeenLastCalledWith("close_child_webview", {
      payload: { id: "webview-1" },
    });
    expect(proxy.isVisible()).toBe(false);
  });
});
