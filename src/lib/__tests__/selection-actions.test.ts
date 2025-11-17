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
  selectionToolbarAvailable: true,
};

const platformsStoreMock = {
  getPlatformById: vi.fn<[string], AIPlatform | null>(),
  enabledPlatforms: [aiPlatform],
  selectionToolbarPlatforms: [aiPlatform],
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
  platformsStoreMock.selectionToolbarPlatforms = [aiPlatform];

  configStoreMock.config = { ...DEFAULT_CONFIG };
  configStoreMock.config.currentTranslator = translationPlatform.id;
  configStoreMock.config.locale = "zh-CN";
  configStoreMock.config.selectionToolbarDefaultPlatformId = null;
  configStoreMock.config.lastUsedPlatform = null;
  configStoreMock.config.defaultPlatform = null;

  invokeMock.mockResolvedValue({ success: true, message: "ok" });

  selectionActions = await import("$lib/utils/selection-actions");
});

describe("selection-actions", () => {
  it("注入翻译文本时使用共享模板并定位正确的 WebView", async () => {
    // 执行翻译（现在是异步的，立即返回）
    await selectionActions.executeTranslation("Hello world");

    // 视图应该立即切换
    expect(appStateMock.switchToTranslationView).toHaveBeenCalledOnce();

    // 触发 WebView 加载事件
    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "translator-google" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "translator-google" });

    // 等待异步注入完成
    await vi.waitFor(
      () => {
        expect(generateInjectionScriptMock).toHaveBeenCalledOnce();
      },
      { timeout: 1000 },
    );

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
    // Mock check_child_webview_exists 成功，但后续的 evaluate_child_webview_script 失败
    invokeMock
      .mockResolvedValueOnce(true) // check_child_webview_exists
      .mockRejectedValueOnce(new Error("boom")); // evaluate_child_webview_script

    // 执行翻译（现在是异步的，立即返回）
    await selectionActions.executeTranslation("Text to translate");

    // 触发 WebView 加载事件
    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "translator-google" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "translator-google" });

    // 等待异步错误处理完成
    await vi.waitFor(
      () => {
        expect(appStateMock.setError).toHaveBeenCalledWith(
          "errors.selectionToolbar.translationFailed",
        );
      },
      { timeout: 1000 },
    );
  });

  it("AI 解释时复用聊天模板并注入提示词", async () => {
    configStoreMock.config.locale = "en-US";

    // 执行解释（现在是异步的，立即返回）
    await selectionActions.executeExplanation("Why is the sky blue?");

    // 视图应该立即切换
    expect(appStateMock.switchToChatView).toHaveBeenCalledWith(aiPlatform);

    // 触发 WebView 加载事件
    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "ai-chat-chatgpt" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "ai-chat-chatgpt" });

    // 等待异步注入完成
    await vi.waitFor(
      () => {
        expect(generateInjectionScriptMock).toHaveBeenCalledOnce();
      },
      { timeout: 1000 },
    );

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
    platformsStoreMock.selectionToolbarPlatforms = [];
    configStoreMock.config.selectionToolbarDefaultPlatformId = null;
    configStoreMock.config.lastUsedPlatform = null;
    configStoreMock.config.defaultPlatform = null;

    await selectionActions.executeExplanation("Need explanation");

    expect(appStateMock.switchToChatView).not.toHaveBeenCalled();
    expect(generateInjectionScriptMock).not.toHaveBeenCalled();
    expect(appStateMock.setError).toHaveBeenCalledWith("errors.selectionToolbar.noAiPlatform");
  });

  it("忽略不支持划词的 AI 平台并回退到可用平台", async () => {
    const toolbarDisabledPlatform: AIPlatform = {
      ...aiPlatform,
      id: "claude",
      name: "Claude",
      selectionToolbarAvailable: false,
      sortOrder: 1,
    };

    const fallbackPlatform: AIPlatform = {
      ...aiPlatform,
      id: "copilot",
      name: "Copilot",
      selectionToolbarAvailable: true,
      sortOrder: 2,
    };

    configStoreMock.config.selectionToolbarDefaultPlatformId = toolbarDisabledPlatform.id;
    configStoreMock.config.lastUsedPlatform = null;
    configStoreMock.config.defaultPlatform = fallbackPlatform.id;

    platformsStoreMock.getPlatformById.mockImplementation((id: string) => {
      if (id === toolbarDisabledPlatform.id) {
        return toolbarDisabledPlatform;
      }
      if (id === fallbackPlatform.id) {
        return fallbackPlatform;
      }
      return null;
    });

    platformsStoreMock.enabledPlatforms = [toolbarDisabledPlatform, fallbackPlatform];
    platformsStoreMock.selectionToolbarPlatforms = [fallbackPlatform];

    await selectionActions.executeExplanation("Test toolbar filtering");

    expect(appStateMock.switchToChatView).toHaveBeenCalledWith(fallbackPlatform);
  });

  it("AI 注入失败时会反馈错误", async () => {
    // Mock check_child_webview_exists 成功，但后续的 evaluate_child_webview_script 失败
    invokeMock
      .mockResolvedValueOnce(true) // check_child_webview_exists
      .mockRejectedValueOnce(new Error("network failure")); // evaluate_child_webview_script

    // 执行解释（现在是异步的，立即返回）
    await selectionActions.executeExplanation("Explain this");

    // 触发 WebView 加载事件
    emitEvent(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, { id: "ai-chat-chatgpt" });
    emitEvent(EVENTS.CHILD_WEBVIEW_READY, { id: "ai-chat-chatgpt" });

    // 等待异步错误处理完成
    await vi.waitFor(
      () => {
        expect(appStateMock.setError).toHaveBeenCalledWith(
          "errors.selectionToolbar.explanationFailed",
        );
      },
      { timeout: 1000 },
    );
  });
});
