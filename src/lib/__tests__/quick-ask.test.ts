import { describe, it, expect, beforeEach, vi } from "vitest";
import { quickAskStore } from "$lib/stores/quick-ask.svelte";

// Mocks
vi.mock("$lib/utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("$lib/stores/config.svelte", () => ({
  configStore: {
    initialized: true,
    config: {
      quickAsk: {
        enabled: true,
        selectedPlatformId: "chatgpt",
        hotkeyInterval: 400,
        voiceEnabled: false,
      },
    },
    init: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("$lib/stores/platforms.svelte", () => ({
  platformsStore: {
    platforms: [{ id: "chatgpt", name: "ChatGPT", enabled: true, url: "https://chat.openai.com" }],
    getPlatformById: (id: string) => ({ id, name: "ChatGPT", enabled: true, url: "https://chat.openai.com" }),
    init: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/event", () => {
  const emit = vi.fn().mockResolvedValue(undefined);
  const listen = vi.fn(
    (
      event: string,
      handler: (payload: { payload: { platformId: string; success?: boolean } }) => void,
    ) => {
    if (event === "quick-ask-platform-ready") {
      setTimeout(() => {
        handler({ payload: { platformId: "chatgpt", success: true } });
      }, 0);
    }
    return Promise.resolve(() => {});
    },
  );

  return {
    emit,
    listen,
  };
});

vi.mock("$lib/utils/injection", () => ({
  injectQuestionToPlatform: vi.fn().mockRejectedValue(new Error("NOT_LOGGED_IN")),
}));

describe("QuickAsk submit error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quickAskStore.close();
  });

  it("sets notLoggedIn error and returns false when platform not logged in", async () => {
    await quickAskStore.init();
    quickAskStore.setQuestion("Hello world");

    const result = await quickAskStore.submit();

    expect(result).toBe(false);
    expect(quickAskStore.error).toBe("quickAsk.errors.notLoggedIn");
  });
});
