/**
 * Selection Toolbar Actions - 划词工具栏操作逻辑
 * 
 * 提供翻译和AI解释的注入逻辑
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

import { i18n } from '$lib/i18n';
import { appState } from '$lib/stores/app.svelte';
import { configStore } from '$lib/stores/config.svelte';
import { translationStore } from '$lib/stores/translation.svelte';
import { platformsStore } from '$lib/stores/platforms.svelte';
import { generateInjectionScript } from '$lib/utils/injection';
import { logger } from '$lib/utils/logger';
import { EVENTS, TIMING, TRANSLATION_INJECTION } from '$lib/utils/constants';
import {
  getDefaultChatTemplate,
  getDefaultTranslationTemplate,
} from '$lib/utils/injection-templates';
import type { AIPlatform, TranslationPlatform } from '$lib/types/platform';
import type { ClickAction, FillTextAction, InjectionAction } from '$lib/types/injection';

type WebviewReadyEntry = {
  ready: boolean;
  resolvers: Array<() => void>;
};

const webviewReadyState = new Map<string, WebviewReadyEntry>();
let webviewEventListenersRegistered = false;
const t = i18n.t;

function getOrCreateReadyEntry(id: string): WebviewReadyEntry {
  const existing = webviewReadyState.get(id);
  if (existing) {
    return existing;
  }

  const entry: WebviewReadyEntry = {
    ready: false,
    resolvers: [],
  };
  webviewReadyState.set(id, entry);
  return entry;
}

function markWebviewLoading(id: string): void {
  const entry = getOrCreateReadyEntry(id);
  entry.ready = false;
}

function markWebviewReady(id: string): void {
  const entry = getOrCreateReadyEntry(id);
  entry.ready = true;
  const resolvers = [...entry.resolvers];
  entry.resolvers = [];
  resolvers.forEach((resolver) => resolver());
}

async function ensureWebviewEventListeners(): Promise<void> {
  if (webviewEventListenersRegistered || typeof window === 'undefined') {
    return;
  }

  try {
    const mainWindow = getCurrentWebviewWindow();

    await Promise.all([
      mainWindow.listen(EVENTS.CHILD_WEBVIEW_LOAD_STARTED, (event) => {
        const payload = event.payload as { id?: string } | undefined;
        if (!payload?.id) {
          return;
        }

        markWebviewLoading(payload.id);
      }),
      mainWindow.listen(EVENTS.CHILD_WEBVIEW_READY, (event) => {
        const payload = event.payload as { id?: string } | undefined;
        if (!payload?.id) {
          return;
        }

        markWebviewReady(payload.id);
      }),
    ]);

    webviewEventListenersRegistered = true;
  } catch (error) {
    logger.warn('Failed to register child webview readiness listeners', error);
  }
}

async function waitForWebviewReady(id: string, timeoutMs: number): Promise<void> {
  await ensureWebviewEventListeners();

  const entry = webviewReadyState.get(id);
  if (entry?.ready) {
    return;
  }

  await new Promise<void>((resolve) => {
    const targetEntry = entry ?? getOrCreateReadyEntry(id);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const wrappedResolve = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }

      const currentEntry = webviewReadyState.get(id);
      if (currentEntry) {
        currentEntry.resolvers = currentEntry.resolvers.filter((resolver) => resolver !== wrappedResolve);
        currentEntry.ready = true;
      }

      resolve();
    };

    timeoutHandle = setTimeout(() => {
      const currentEntry = webviewReadyState.get(id);
      if (currentEntry) {
        currentEntry.resolvers = currentEntry.resolvers.filter((resolver) => resolver !== wrappedResolve);
      }

      logger.warn('Wait for child webview ready timed out, proceeding anyway', {
        webviewId: id,
        timeoutMs,
      });
      resolve();
    }, timeoutMs);

    targetEntry.resolvers.push(wrappedResolve);
  });
}

/**
 * 执行翻译操作
 * 
 * @param selectedText - 选中的文本
 */
export async function executeTranslation(selectedText: string): Promise<void> {
  try {
    logger.info('Executing translation', { textLength: selectedText.length });

    appState.switchToTranslationView();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ensureTranslationVisible'));
    }

    // 切换到翻译视图
    const currentTranslatorId = configStore.config.currentTranslator;
    const currentTranslator = currentTranslatorId
      ? translationStore.getPlatformById(currentTranslatorId)
      : null;

    if (!currentTranslator || !currentTranslator.enabled) {
      logger.warn('No translation platform available for selection toolbar', {
        translatorId: currentTranslatorId ?? 'unknown',
      });
      appState.setError(t('errors.selectionToolbar.noTranslatorConfigured'));
      return;
    }

    const webviewId = `translator-${currentTranslator.id}`;

    await waitForWebviewReady(webviewId, TIMING.CHILD_WEBVIEW_READY_TIMEOUT_MS);

    // 执行翻译注入
    await injectTranslationText(selectedText, currentTranslator, webviewId);

    logger.info('Translation executed successfully');
  } catch (error) {
    logger.error('Failed to execute translation', error);
    appState.setError(t('errors.selectionToolbar.translationFailed'));
    throw error;
  }
}

/**
 * 注入文本到翻译器
 * 
 * @param text - 要翻译的文本
 * @param translator - 翻译平台
 */
async function injectTranslationText(
  text: string,
  translator: TranslationPlatform,
  webviewId: string
): Promise<void> {
  try {
    const template = getDefaultTranslationTemplate(translator.id);

    if (!template) {
      logger.warn('No injection template for translator', { translatorId: translator.id });
      return;
    }

    const fillTemplate = template.actions.find(
      (action): action is FillTextAction => action.type === 'fill'
    );

    if (!fillTemplate) {
      logger.warn('Translation template missing fill action', { translatorId: translator.id });
      return;
    }

    const fillAction: FillTextAction = {
      ...fillTemplate,
      content: text,
      triggerEvents: fillTemplate.triggerEvents ?? true,
      delay: fillTemplate.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
      timeout: fillTemplate.timeout ?? TRANSLATION_INJECTION.FILL_TIMEOUT_MS,
    };

    const actions: InjectionAction[] = [fillAction];

    const clickTemplate = template.actions.find(
      (action): action is ClickAction => action.type === 'click'
    );

    if (clickTemplate) {
      const clickAction: ClickAction = {
        ...clickTemplate,
        delay: clickTemplate.delay ?? fillAction.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
        timeout: clickTemplate.timeout ?? TRANSLATION_INJECTION.CLICK_TIMEOUT_MS,
      };
      actions.push(clickAction);
    }

    const script = generateInjectionScript(actions);

    await invoke('evaluate_child_webview_script', {
      payload: {
        id: webviewId,
        script,
      },
    });

    logger.info('Translation text injected successfully', {
      translatorId: translator.id,
      webviewId,
    });
  } catch (error) {
    logger.error('Failed to inject translation text', error);
    throw error;
  }
}

/**
 * 执行AI解释操作
 * 
 * @param selectedText - 选中的文本
 */
export async function executeExplanation(selectedText: string): Promise<void> {
  try {
    logger.info('Executing AI explanation', { textLength: selectedText.length });

    // 获取默认解释平台
    const platform = resolveExplainPlatform();
    if (!platform) {
      logger.warn('No AI platform available for explanation');
      appState.setError(t('errors.selectionToolbar.noAiPlatform'));
      return;
    }

    // 切换到AI聊天视图
    appState.switchToChatView(platform);

    const webviewId = `ai-chat-${platform.id}`;

    await waitForWebviewReady(webviewId, TIMING.CHILD_WEBVIEW_READY_TIMEOUT_MS);

    // 构建解释提示词
    const prompt = buildExplanationPrompt(selectedText);

    // 执行AI注入
    await injectAIPrompt(prompt, platform, webviewId);

    logger.info('AI explanation executed successfully');
  } catch (error) {
    logger.error('Failed to execute AI explanation', error);
    appState.setError(t('errors.selectionToolbar.explanationFailed'));
    throw error;
  }
}

/**
 * 注入提示词到AI平台
 * 
 * @param prompt - 提示词
 * @param platform - AI平台
 */
async function injectAIPrompt(
  prompt: string,
  platform: AIPlatform,
  webviewId: string
): Promise<void> {
  try {
    const template = getDefaultChatTemplate(platform.id);

    if (!template) {
      logger.warn('No injection template for AI platform', { platformId: platform.id });
      return;
    }

    const fillTemplate = template.actions.find(
      (action): action is FillTextAction => action.type === 'fill'
    );

    if (!fillTemplate) {
      logger.warn('AI template missing fill action', { platformId: platform.id });
      return;
    }

    const fillAction: FillTextAction = {
      ...fillTemplate,
      content: prompt,
      triggerEvents: fillTemplate.triggerEvents ?? true,
      delay: fillTemplate.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
      timeout: fillTemplate.timeout ?? TRANSLATION_INJECTION.FILL_TIMEOUT_MS,
    };

    const actions: InjectionAction[] = [fillAction];

    const clickTemplate = template.actions.find(
      (action): action is ClickAction => action.type === 'click'
    );

    if (clickTemplate) {
      const clickAction: ClickAction = {
        ...clickTemplate,
        delay: clickTemplate.delay ?? fillAction.delay ?? TRANSLATION_INJECTION.FILL_DELAY_MS,
        timeout: clickTemplate.timeout ?? TRANSLATION_INJECTION.CLICK_TIMEOUT_MS,
      };
      actions.push(clickAction);
    }

    const script = generateInjectionScript(actions);

    await invoke('evaluate_child_webview_script', {
      payload: {
        id: webviewId,
        script,
      },
    });

    logger.info('AI prompt injected successfully', {
      platformId: platform.id,
      webviewId,
    });
  } catch (error) {
    logger.error('Failed to inject AI prompt', error);
    throw error;
  }
}

/**
 * 构建解释提示词
 * 
 * @param text - 选中的文本
 * @returns 格式化的提示词
 */
function buildExplanationPrompt(text: string): string {
  // 根据当前语言构建不同的提示词
  const locale = configStore.config.locale || 'zh-CN';
  
  const prompts: Record<string, string> = {
    'zh-CN': `请解释以下内容：\n\n${text}`,
    'en-US': `Please explain the following:\n\n${text}`,
    'ja-JP': `以下の内容を説明してください：\n\n${text}`,
    'ko-KR': `다음 내용을 설명해 주세요:\n\n${text}`,
  };

  return prompts[locale] || prompts['zh-CN'];
}

function resolveExplainPlatform(): AIPlatform | null {
  const candidateIds = [
    configStore.config.defaultExplainPlatformId ?? undefined,
    configStore.config.lastUsedPlatform ?? undefined,
    configStore.config.defaultPlatform ?? undefined,
  ].filter((id): id is string => Boolean(id));

  for (const id of candidateIds) {
    const platform = platformsStore.getPlatformById(id);
    if (platform && platform.enabled) {
      return platform;
    }
  }

  const fallback = platformsStore.enabledPlatforms[0];
  if (fallback) {
    return fallback;
  }

  return null;
}


