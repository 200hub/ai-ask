<script lang="ts">
  /**
   * GlobalSelectionMonitor - 全局文本选择监听器
   * 
   * 监听用户的文本选择事件,并在满足条件时显示划词工具栏
   */
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emit } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { configStore } from '$lib/stores/config.svelte';
  import { logger } from '$lib/utils/logger';
  import { SELECTION_TOOLBAR } from '$lib/utils/constants';

  let selectionTimeout: number | null = null;
  let selectionChangeTimeout: number | null = null;

  function clearDocumentSelection(): void {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    if (selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  }

  async function hideToolbar(clearSelection = false) {
    try {
      await invoke('hide_selection_toolbar');
    } catch (error) {
      logger.error('Failed to hide selection toolbar', error);
    } finally {
      if (clearSelection) {
        clearDocumentSelection();
      }
    }
  }

  /**
   * 处理文本选择事件
   */
  async function handleSelection(event: MouseEvent) {
    // 清除之前的超时
    if (selectionTimeout !== null) {
      window.clearTimeout(selectionTimeout);
      selectionTimeout = null;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    const initialPreview = (selectedText ?? '').replace(/\s+/g, ' ').slice(0, 80);

    const isLeftButton = event.button === 0;
    const isPlainSelection = isLeftButton && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

    const mouseupPayload = {
      stage: 'mouseup',
      isPlainSelection,
      textLength: selectedText?.length ?? 0,
      preview: initialPreview,
    };
    logger.info('Selection monitor mouseup', mouseupPayload);
    void emit('selection-monitor-log', mouseupPayload);

    if (!isPlainSelection || !selectedText || selectedText.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
      await hideToolbar(true);
      return;
    }

    // 防抖处理
    selectionTimeout = window.setTimeout(async () => {
      selectionTimeout = null;
      const debouncedSelection = window.getSelection();
      const debouncedText = debouncedSelection?.toString().trim();
      const debouncedPreview = (debouncedText ?? '').replace(/\s+/g, ' ').slice(0, 80);

      const debouncedPayload = {
        stage: 'debounce',
        textLength: debouncedText?.length ?? 0,
        preview: debouncedPreview,
      };
      logger.info('Selection monitor debounced selection', debouncedPayload);
      void emit('selection-monitor-log', debouncedPayload);

      // 检查是否启用了划词工具栏
      if (!configStore.config.selectionToolbarEnabled) {
        await hideToolbar(true);
        return;
      }

      if (!debouncedText || debouncedText.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
        await hideToolbar(true);
        return;
      }

      try {
        const currentWindow = getCurrentWindow();
        const windowPosition = await currentWindow.outerPosition();
        const scaleFactor = window.devicePixelRatio || 1;

        type BoundingRect = { left: number; top: number; width: number; height: number };
        let rect: BoundingRect | null = null;
        try {
          if (selection && selection.rangeCount > 0) {
            rect = selection.getRangeAt(0).getBoundingClientRect();
          }
        } catch (error) {
          logger.warn('Failed to read selection range', error);
        }

        if ((!rect || (rect.width === 0 && rect.height === 0)) && event.target instanceof HTMLElement) {
          rect = event.target.getBoundingClientRect();
        }

        if (!rect || (rect.width === 0 && rect.height === 0)) {
          logger.debug('Selection toolbar aborted: unable to determine bounding rect');
          await hideToolbar(true);
          return;
        }

        const rectCenterX = rect.left + rect.width / 2;
        const rectTop = rect.top;

        await invoke('show_selection_toolbar', {
          text: selectedText,
          position: {
            x: windowPosition.x + rectCenterX * scaleFactor,
            y: windowPosition.y + rectTop * scaleFactor,
          },
        });

        logger.info('Selection toolbar shown', {
          textLength: selectedText.length,
          position: {
            x: windowPosition.x + rectCenterX * scaleFactor,
            y: windowPosition.y + rectTop * scaleFactor,
          },
          scaleFactor,
        });
      } catch (error) {
        logger.error('Failed to show selection toolbar', error);
      }
    }, SELECTION_TOOLBAR.SELECTION_DEBOUNCE_MS);
  }

  function handleSelectionChange() {
    if (selectionChangeTimeout !== null) {
      window.clearTimeout(selectionChangeTimeout);
      selectionChangeTimeout = null;
    }

    selectionChangeTimeout = window.setTimeout(() => {
      selectionChangeTimeout = null;

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? '';
      const preview = selectedText.replace(/\s+/g, ' ').slice(0, 80);

      const selectionChangePayload = {
        stage: 'selectionchange',
        textLength: selectedText.length,
        preview,
      };
      logger.info('Selection monitor selectionchange', selectionChangePayload);
      void emit('selection-monitor-log', selectionChangePayload);

      if (!selectedText || selectedText.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
        void hideToolbar(true);
      }
    }, SELECTION_TOOLBAR.SELECTION_CLEAR_DEBOUNCE_MS);
  }

  function handleWindowBlur() {
    void hideToolbar(true);

    if (selectionTimeout !== null) {
      window.clearTimeout(selectionTimeout);
      selectionTimeout = null;
    }

    if (selectionChangeTimeout !== null) {
      window.clearTimeout(selectionChangeTimeout);
      selectionChangeTimeout = null;
    }
  }

  onMount(() => {
    // 监听鼠标松开事件（表示选择完成）
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('blur', handleWindowBlur);

    logger.info('Global selection monitor initialized');
  });

  onDestroy(() => {
    document.removeEventListener('mouseup', handleSelection);
    document.removeEventListener('selectionchange', handleSelectionChange);
    window.removeEventListener('blur', handleWindowBlur);
    
    if (selectionTimeout !== null) {
      window.clearTimeout(selectionTimeout);
    }

    if (selectionChangeTimeout !== null) {
      window.clearTimeout(selectionChangeTimeout);
    }

    logger.info('Global selection monitor destroyed');
  });
</script>

<!-- 此组件不渲染任何内容 -->
