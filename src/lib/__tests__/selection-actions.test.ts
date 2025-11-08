import { DEFAULT_CONFIG } from "$lib/types/config";
import type { AIPlatform, TranslationPlatform } from "$lib/types/platform";
import { EVENTS } from "$lib/utils/constants";
import type { InjectionAction } from "$lib/types/injection";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();

vi.mock("$lib/i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (eventName: string, callback: (event: { payload: unknown }) => void) => {
      const existing = listeners.get(eventName) ?? [];
      existing.push(callback);
      listeners.set(eventName, existing);

      return Promise.resolve(() => {
        const callbacks = listeners.get(eventName) ?? [];
        listeners.set(
          eventName,
          callbacks.filter((cb) => cb !== callback),
        );
      });
    },
  }),
}));

const appStateMock = {
  switchToTranslationView: vi.fn(),
  switchToChatView: vi.fn(),
  setError: vi.fn(),
};

vi.mock("$lib/stores/app.svelte", () => ({
  appState: appStateMock,
}));

const configStoreMock = {
  config: { ...DEFAULT_CONFIG },
};

vi.mock("$lib/stores/config.svelte", () => ({
  configStore: configStoreMock,
}));

const translationPlatform: TranslationPlatform = {
  id: "google",
  name: "Google Translate",
  icon: "google-icon",
  url: "https://translate.google.com",
  enabled: true,
  supportLanguages: ["en", "zh-CN"],
};

const translationStoreMock = {
  getPlatformById: vi.fn<[string], TranslationPlatform | null>(),
};

vi.mock("$lib/stores/translation.svelte", () => ({
  translationStore: translationStoreMock,
}));

const aiPlatform: AIPlatform = {
  id: "chatgpt",
  name: "ChatGPT",
  icon: "chatgpt-icon",
  url: "https://chat.openai.com",
  enabled: true,
  isCustom: false,
  sortOrder: 1,
};

const platformsStoreMock = {
  getPlatformById: vi.fn<[string], AIPlatform | null>(),
  enabledPlatforms: [aiPlatform],
};

vi.mock("$lib/stores/platforms.svelte", () => ({
  platformsStore: platformsStoreMock,
}));

const generateInjectionScriptMock = vi.fn<[InjectionAction[]], string>();

vi.mock("$lib/utils/injection", () => ({
  generateInjectionScript: generateInjectionScriptMock,
}));

type SelectionActionsModule = typeof import("$lib/utils/selection-actions");
let selectionActions: SelectionActionsModule;

function emitEvent(eventName: string, payload: Record<string, unknown>): void {
  const callbacks = listeners.get(eventName) ?? [];
  callbacks.forEach((callback) => callback({ payload }));
}

beforeEach(async () => {
  vi.resetModules();

  listeners.clear();
  invokeMock.mockReset();
  generateInjectionScriptMock.mockReset();
  generateInjectionScriptMock.mockImplementation(() => "generated-script");

  appStateMock.switchToTranslationView.mockReset();
  appStateMock.switchToChatView.mockReset();
  appStateMock.setError.mockReset();

  translationStoreMock.getPlatformById.mockReset();
  translationStoreMock.getPlatformById.mockImplementation((id: string) =>
    id === translationPlatform.id ? translationPlatform : null,
  );

  platformsStoreMock.getPlatformById.mockReset();
  platformsStoreMock.getPlatformById.mockImplementation((id: string) =>
    id === aiPlatform.id ? aiPlatform : null,
  );
  platformsStoreMock.enabledPlatforms = [aiPlatform];

  configStoreMock.config = { ...DEFAULT_CONFIG };
  configStoreMock.config.currentTranslator = translationPlatform.id;
  configStoreMock.config.locale = "zh-CN";
  configStoreMock.config.defaultExplainPlatformId = null;
  configStoreMock.config.lastUsedPlatform = null;
  configStoreMock.config.defaultPlatform = null;

  invokeMock.mockResolvedValue({ success: true, message: "ok" });

  selectionActions = await import("$lib/utils/selection-actions");
});

describe("selection-actions", () => {
  it("注入翻译文本时使用共享模板并定位正确的 WebView", async () => {
    const promise = selectionActions.executeTranslation("Hello world");

    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "translator-google" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "translator-google" });

    await promise;

    expect(appStateMock.switchToTranslationView).toHaveBeenCalledOnce();
    expect(generateInjectionScriptMock).toHaveBeenCalledOnce();
    const lastCall = generateInjectionScriptMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();

    const actions = (lastCall?.[0] ?? []) as InjectionAction[];
    expect(actions).toHaveLength(1);

    const fillAction = actions[0];
    expect(fillAction).toBeDefined();
    if (!fillAction || fillAction.type !== "fill") {
      throw new Error("Expected fill action as first action");
    }

    expect(fillAction.selector).toContain('textarea[aria-label*="Source text"]');
    expect(fillAction.content).toBe("Hello world");

    expect(invokeMock).toHaveBeenCalledWith("evaluate_child_webview_script", {
      payload: {
        id: "translator-google",
        script: "generated-script",
      },
    });
    expect(appStateMock.setError).not.toHaveBeenCalled();
  });

  it("当翻译平台不可用时提示用户启用平台", async () => {
    translationStoreMock.getPlatformById.mockReturnValueOnce(null);

    await selectionActions.executeTranslation("Hello world");

    expect(appStateMock.setError).toHaveBeenCalledWith(
      "errors.selectionToolbar.noTranslatorConfigured",
    );
    expect(generateInjectionScriptMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("翻译执行失败时会提示错误", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    const promise = selectionActions.executeTranslation("Text to translate");

    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "translator-google" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "translator-google" });

    await expect(promise).rejects.toThrowError();
    expect(appStateMock.setError).toHaveBeenCalledWith(
      "errors.selectionToolbar.translationFailed",
    );
  });

  it("AI 解释时复用聊天模板并注入提示词", async () => {
    configStoreMock.config.locale = "en-US";

    const promise = selectionActions.executeExplanation("Why is the sky blue?");

    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "ai-chat-chatgpt" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "ai-chat-chatgpt" });

    await promise;

    expect(appStateMock.switchToChatView).toHaveBeenCalledWith(aiPlatform);
    expect(generateInjectionScriptMock).toHaveBeenCalledOnce();
    const lastCall = generateInjectionScriptMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();

    const actions = (lastCall?.[0] ?? []) as InjectionAction[];
    expect(actions).toHaveLength(2);

    const fillAction = actions[0];
    expect(fillAction).toBeDefined();
    if (!fillAction || fillAction.type !== "fill") {
      throw new Error("Expected fill action as first action");
    }

    expect(fillAction.content).toBe("Please explain the following:\n\nWhy is the sky blue?");
    expect(fillAction.selector).toContain("#prompt-textarea");

    const clickAction = actions[1];
    expect(clickAction).toBeDefined();
    if (!clickAction || clickAction.type !== "click") {
      throw new Error("Expected click action as second action");
    }

    expect(clickAction.selector).toContain('button[data-testid="send-button"]');

    expect(invokeMock).toHaveBeenCalledWith("evaluate_child_webview_script", {
      payload: {
        id: "ai-chat-chatgpt",
        script: "generated-script",
      },
    });
    expect(appStateMock.setError).not.toHaveBeenCalled();
  });

  it("当没有可用的 AI 平台时提示用户启用平台", async () => {
    platformsStoreMock.getPlatformById.mockReturnValue(null);
    platformsStoreMock.enabledPlatforms = [];
    configStoreMock.config.defaultExplainPlatformId = null;
    configStoreMock.config.lastUsedPlatform = null;
    configStoreMock.config.defaultPlatform = null;

    await selectionActions.executeExplanation("Need explanation");

    expect(appStateMock.switchToChatView).not.toHaveBeenCalled();
    expect(generateInjectionScriptMock).not.toHaveBeenCalled();
    expect(appStateMock.setError).toHaveBeenCalledWith(
      "errors.selectionToolbar.noAiPlatform",
    );
  });

  it("AI 注入失败时会反馈错误", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network failure"));

    const promise = selectionActions.executeExplanation("Explain this");

    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "ai-chat-chatgpt" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "ai-chat-chatgpt" });

    await expect(promise).rejects.toThrowError();
    expect(appStateMock.setError).toHaveBeenCalledWith(
      "errors.selectionToolbar.explanationFailed",
    );
  });
});
