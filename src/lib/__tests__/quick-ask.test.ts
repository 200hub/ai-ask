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

  return {
    emit,
  };
});

describe("QuickAsk submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quickAskStore.close();
  });

  it("successfully emits quick-ask-submit event with platform and question", async () => {
    const { emit } = await import("@tauri-apps/api/event");
    
    await quickAskStore.init();
    quickAskStore.setQuestion("Hello world");

    const result = await quickAskStore.submit();

    expect(result).toBe(true);
    expect(emit).toHaveBeenCalledWith("quick-ask-submit", {
      platformId: "chatgpt",
      question: "Hello world",
    });
  });
});
