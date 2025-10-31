import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIPlatform } from "$lib/types/platform";

const createPlatform = (id: string): AIPlatform => ({
  id,
  name: `Platform ${id}`,
  icon: "icon.svg",
  url: "https://example.com",
  enabled: true,
  isCustom: false,
  sortOrder: 1,
});

let appState: typeof import("$lib/stores/app.svelte")["appState"];

beforeEach(async () => {
  vi.resetModules();
  ({ appState } = await import("$lib/stores/app.svelte"));
  appState.reset();
});

describe("AppState", () => {
  it("resets to welcome view with no platform selected", () => {
    const platform = createPlatform("chat");
    appState.switchToChatView(platform);
    appState.setLoading(true);
    appState.setWebviewLoading(true);
    appState.setError("boom");

    appState.reset();

    expect(appState.currentView).toBe("welcome");
    expect(appState.selectedPlatform).toBeNull();
    expect(appState.showSettings).toBe(false);
    expect(appState.isLoading).toBe(false);
    expect(appState.error).toBeNull();
    expect(appState.webviewLoading).toBe(false);
  });

  it("switches to chat view and stores selected platform", () => {
    const platform = createPlatform("chatgpt");
    appState.switchToChatView(platform);

    expect(appState.currentView).toBe("chat");
    expect(appState.selectedPlatform).toEqual(platform);
    expect(appState.showSettings).toBe(false);
  });

  it("switches to translation view while hiding settings", () => {
    appState.openSettings();
    appState.switchToTranslationView();

    expect(appState.currentView).toBe("translation");
    expect(appState.showSettings).toBe(false);
    expect(appState.selectedPlatform).toBeNull();
  });

  it("re-opens welcome view when closing settings without platform", () => {
    appState.openSettings();
    appState.closeSettings();

    expect(appState.currentView).toBe("welcome");
    expect(appState.showSettings).toBe(false);
  });

  it("restores chat view when closing settings with platform selected", () => {
    const platform = createPlatform("gemini");
    appState.switchToChatView(platform);
    appState.openSettings();
    appState.closeSettings();

    expect(appState.currentView).toBe("chat");
    expect(appState.selectedPlatform).toEqual(platform);
    expect(appState.showSettings).toBe(false);
  });

  it("marks loading states and clears after update", () => {
    appState.setLoading(true);
    appState.setWebviewLoading(true);

    expect(appState.isLoading).toBe(true);
    expect(appState.webviewLoading).toBe(true);

    appState.setLoading(false);
    appState.setWebviewLoading(false);

    expect(appState.isLoading).toBe(false);
    expect(appState.webviewLoading).toBe(false);
  });

  it("automatically clears errors after timeout", () => {
    vi.useFakeTimers();

    try {
      appState.setError("network");
      expect(appState.error).toBe("network");

      vi.advanceTimersByTime(5000);
      expect(appState.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
