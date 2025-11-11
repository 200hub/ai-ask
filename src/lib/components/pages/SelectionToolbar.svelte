<script lang="ts">
  /**
   * SelectionToolbar - 划词工具栏组件
   *
   * 显示在独立 Webview 中的浮动工具栏，提供翻译、解释、收藏操作。
   */
  import '$lib/styles/base.css';
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { i18n } from '$lib/i18n';
  import { logger } from '$lib/utils/logger';
  import {
    requestTranslation,
    requestExplanation,
    requestCollect,
  } from '$lib/utils/selection-bridge';
  import { SELECTION_TOOLBAR } from '$lib/utils/constants';

  type Props = {
    isDarkMode?: boolean;
  };

  let { isDarkMode = false }: Props = $props();
  const iconFill = $derived(isDarkMode ? '#f9fafb' : '#1f2937');

  const t = i18n.t;
  type KeyboardHandlerEvent = globalThis.KeyboardEvent;

  let trimmedText = $state<string>('');
  let hasValidSelection = $state<boolean>(false);
  let canCollect = $state<boolean>(false);
  let isProcessing = $state<boolean>(false);
  let unlistenSelection: UnlistenFn | null = null;
  let autoHideTimer: number | null = null;

  const MIN_SELECTION_LENGTH = SELECTION_TOOLBAR.MIN_SELECTION_LENGTH;

  function refreshSelectionStates(rawText: string): void {
    trimmedText = rawText.trim();
    hasValidSelection = trimmedText.length >= MIN_SELECTION_LENGTH;
    canCollect = trimmedText.length > 0;
  }

  function clearAutoHideTimer(): void {
    if (autoHideTimer !== null) {
      window.clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function restartAutoHideTimer(): void {
    clearAutoHideTimer();
    autoHideTimer = window.setTimeout(() => {
      void hideToolbar();
    }, SELECTION_TOOLBAR.AUTO_HIDE_DELAY_MS);
  }

  async function hideToolbar(): Promise<void> {
    clearAutoHideTimer();
    refreshSelectionStates('');
    try {
      await invoke('hide_selection_toolbar');
    } catch (error) {
      logger.error('Failed to hide selection toolbar', error);
    }
  }

  function handlePointerEnter(): void {
    clearAutoHideTimer();
  }

  function handlePointerLeave(): void {
    if (canCollect) {
      restartAutoHideTimer();
    } else {
      void hideToolbar();
    }
  }

  async function handleTranslate(): Promise<void> {
    if (!hasValidSelection || isProcessing) {
      return;
    }

    const text = trimmedText;
    logger.info('Selection toolbar: translate clicked', { textLength: text.length });

    isProcessing = true;
    try {
      await hideToolbar();
      await requestTranslation(text);
    } catch (error) {
      logger.error('Failed to trigger translation', error);
    } finally {
      isProcessing = false;
    }
  }

  async function handleExplain(): Promise<void> {
    if (!hasValidSelection || isProcessing) {
      return;
    }

    const text = trimmedText;
    logger.info('Selection toolbar: explain clicked', { textLength: text.length });

    isProcessing = true;
    try {
      await hideToolbar();
      await requestExplanation(text);
    } catch (error) {
      logger.error('Failed to trigger explanation', error);
    } finally {
      isProcessing = false;
    }
  }

  async function handleCollect(): Promise<void> {
    if (!canCollect || isProcessing) {
      return;
    }

    const text = trimmedText;
    logger.info('Selection toolbar: collect clicked', { textLength: text.length });

    try {
      await hideToolbar();
      await requestCollect(text);
    } catch (error) {
      logger.error('Failed to trigger collect', error);
    }
  }

  function handleKeydown(event: KeyboardHandlerEvent): void {
    if (event.key === 'Escape') {
      void hideToolbar();
    }
  }

  function handleWindowBlur(): void {
    void hideToolbar();
  }

  onMount(async () => {
    try {
      unlistenSelection = await listen<string>('toolbar-text-selected', (event) => {
        const payload = event.payload ?? '';
        const trimmed = payload.trim();
        
        if (!trimmed || trimmed.length === 0) {
          logger.debug('Empty selection received, hiding toolbar');
          void hideToolbar();
          return;
        }

        refreshSelectionStates(payload);
        isProcessing = false;

        if (!canCollect) {
          void hideToolbar();
          return;
        }

        restartAutoHideTimer();
  logger.debug('Selection toolbar received text', { textLength: trimmedText.length });
      });
    } catch (error) {
      logger.error('Failed to listen for toolbar text', error);
    }

    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('blur', handleWindowBlur);

    logger.info('Selection toolbar mounted');
  });

  onDestroy(() => {
    unlistenSelection?.();
    clearAutoHideTimer();
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('blur', handleWindowBlur);

    logger.info('Selection toolbar destroyed');
  });
</script>

<div
  class="toolbar-container"
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  <button
    class="toolbar-button"
    type="button"
    onclick={handleTranslate}
    title={t('errors.selectionToolbar.tooltipTranslate')}
    aria-label={t('errors.selectionToolbar.translate')}
    disabled={!hasValidSelection || isProcessing}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6.5h8c.6 0 1 .4 1 1v2h-2V8.5H5V17a.5.5 0 0 0 .5.5H11v-1.5h2V19a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7.5C3 6.9 3.4 6.5 4 6.5Zm13.2 2.8a1 1 0 0 1 1.6 0l3 4.5a1 1 0 0 1-.84 1.57h-1.12l1.06 1.8a1 1 0 0 1-1.74 1L18 15.5l-1.62 2.17a1 1 0 0 1-1.74-1l1.06-1.8h-1.12a1 1 0 0 1-.84-1.57l3-4.5Z"
        fill={iconFill}
      />
    </svg>
    <span class="sr-only">{t('errors.selectionToolbar.translate')}</span>
  </button>

  <button
    class="toolbar-button"
    type="button"
    onclick={handleExplain}
    title={t('errors.selectionToolbar.tooltipExplain')}
    aria-label={t('errors.selectionToolbar.explain')}
    disabled={!hasValidSelection || isProcessing}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.6L12 18.5 8.6 14H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 3a1 1 0 0 0-1 1v.5a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm0 3.5a1 1 0 0 0-1 1V12a1 1 0 1 0 2 0v-.5a1 1 0 0 0-1-1Z"
        fill={iconFill}
      />
    </svg>
    <span class="sr-only">{t('errors.selectionToolbar.explain')}</span>
  </button>

  <button
    class="toolbar-button"
    type="button"
    onclick={handleCollect}
    title={t('errors.selectionToolbar.tooltipCollect')}
    aria-label={t('errors.selectionToolbar.collect')}
    disabled={!canCollect || isProcessing}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.5 5h7a1.5 1.5 0 0 1 1.5 1.5v12.3a.2.2 0 0 1-.31.16L12 16.5l-4.69 2.46A.2.2 0 0 1 7 18.8V6.5A1.5 1.5 0 0 1 8.5 5Z"
        fill={iconFill}
      />
    </svg>
    <span class="sr-only">{t('errors.selectionToolbar.collect')}</span>
  </button>
</div>

<style>
  .toolbar-container {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.45rem;
    -webkit-user-select: none;
    user-select: none;
  }

  .toolbar-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.16s ease, transform 0.16s ease;
  }

  .toolbar-button:hover:not(:disabled) {
    background: var(--bg-secondary);
  }

  .toolbar-button:active:not(:disabled) {
    background: var(--bg-tertiary);
    transform: scale(0.95);
  }

  .toolbar-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon {
    width: 1.1rem;
    height: 1.1rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
