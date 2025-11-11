<script lang="ts">
  /**
   * GlobalSelectionMonitor - 全局文本选择监听器
   * 
   * 监听用户的文本选择事件,并在满足条件时显示划词工具栏
   */
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { configStore } from '$lib/stores/config.svelte';
  import { logger } from '$lib/utils/logger';
  import { EVENTS, SELECTION_TOOLBAR } from '$lib/utils/constants';

  // 性能优化：缓存主窗体句柄，避免每次选择时重复获取
  const mainWindow = getCurrentWindow();
  
  let selectionTimeout: number | null = null;
  let selectionChangeTimeout: number | null = null;
  let toolbarVisible = false;
  let unlistenTempDisable: UnlistenFn | null = null;

  /**
   * 选区签名（文本+位置），用于跳过重复的展示请求
   * 格式: "selectedText:centerX:topY"
   * 在隐藏工具栏后复位为 null
   */
  let lastSelectionSignature: string | null = null;

  /**
   * 清除文档选区
   * 
   * 安全守卫：检查当前焦点元素，如果是表单控件（input/textarea/select），
   * 则跳过清除操作，避免干扰用户正在进行的输入操作。
   * 
   * 此修复解决了全局选区监听器在设置页面中干扰表单交互的问题，
   * 特别是下拉框和文本输入框的焦点管理。
   */
  function clearDocumentSelection(): void {
    const selection = window.getSelection();
    const active = document.activeElement;
    
    // 修复：如果当前焦点在表单控件上，不清除选区
    // 这防止了全局选区监听器干扰设置页面中的输入框和下拉框操作
    if (
      active instanceof globalThis.HTMLInputElement ||
      active instanceof globalThis.HTMLTextAreaElement ||
      active instanceof globalThis.HTMLSelectElement
    ) {
      return;
    }

    if (!selection) {
      return;
    }

    if (selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  }

  /**
   * 隐藏划词工具栏
   * 
   * 性能优化：仅在工具栏可见时才调用原生 hide_selection_toolbar 命令，
   * 避免重复调用带来的跨进程开销。隐藏后清空选区签名，允许后续相同选区重新显示。
   * 
   * @param clearSelection - 是否清空文档选区
   * @param reason - 隐藏原因（用于调试日志）
   */
  async function hideToolbar(clearSelection = false, reason = 'unspecified') {
    logger.debug('Hiding selection toolbar', {
      clearSelection,
      reason,
      toolbarVisible,
    });
  const wasVisible = toolbarVisible;
  const shouldInvoke = wasVisible;
    try {
      // 性能优化：仅在工具栏已显示时才发起原生调用
      if (shouldInvoke) {
        await invoke('hide_selection_toolbar');
      }
    } catch (error) {
      logger.error('Failed to hide selection toolbar', error);
    } finally {
      toolbarVisible = false;
      // 性能优化：清空选区签名，允许后续相同选区重新显示
      lastSelectionSignature = null;
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
    logger.debug('Selection monitor mouseup', mouseupPayload);

    if (!isPlainSelection || !selectedText || selectedText.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
      await hideToolbar(false, 'selection-too-short-on-mouseup');
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
      logger.debug('Selection monitor debounced selection', debouncedPayload);

      // 检查是否启用了划词工具栏
      if (!configStore.config.selectionToolbarEnabled) {
        await hideToolbar(true, 'toolbar-disabled');
        return;
      }

      if (!debouncedText || debouncedText.length < SELECTION_TOOLBAR.MIN_SELECTION_LENGTH) {
        await hideToolbar(true, 'selection-too-short-after-debounce');
        return;
      }

      try {
        // 性能优化：使用缓存的主窗体句柄，避免每次选择时重复获取
        const windowPosition = await mainWindow.outerPosition();
        const scaleFactor = window.devicePixelRatio || 1;

        type BoundingRect = { left: number; top: number; width: number; height: number };
        let rect: BoundingRect | null = null;
        try {
          // 性能优化：优先使用去抖后的选区对象计算位置，确保精确性
          const selectionForRect = debouncedSelection ?? selection;
          if (selectionForRect && selectionForRect.rangeCount > 0) {
            rect = selectionForRect.getRangeAt(0).getBoundingClientRect();
          }
        } catch (error) {
          logger.warn('Failed to read selection range', error);
        }

        if ((!rect || (rect.width === 0 && rect.height === 0)) && event.target instanceof HTMLElement) {
          rect = event.target.getBoundingClientRect();
        }

        if (!rect || (rect.width === 0 && rect.height === 0)) {
          logger.debug('Selection toolbar aborted: unable to determine bounding rect');
          await hideToolbar(true, 'missing-bounding-rect');
          return;
        }

        const rectCenterX = rect.left + rect.width / 2;
        const rectTop = rect.top;
        // 性能优化：生成选区签名（文本+位置），用于跳过重复的展示请求
        const selectionSignature = `${debouncedText ?? ''}:${Math.round(rectCenterX)}:${Math.round(rectTop)}`;

        // 性能优化：若选区内容和位置均未变化且工具栏已显示，则跳过原生调用
        if (selectionSignature === lastSelectionSignature && toolbarVisible) {
          logger.debug('Selection toolbar show skipped due to unchanged selection');
          return;
        }

        await invoke('show_selection_toolbar', {
          text: debouncedText,
          position: {
            x: windowPosition.x + rectCenterX * scaleFactor,
            y: windowPosition.y + rectTop * scaleFactor,
          },
        });
        toolbarVisible = true;
        // 性能优化：记录当前选区签名，用于后续去重
        lastSelectionSignature = selectionSignature;

        logger.info('Selection toolbar shown', {
          textLength: debouncedText.length,
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

  /**
   * 处理选区变化事件（selectionchange）
   * 
   * 性能优化：仅在工具栏已显示或有待处理的选择定时器时才处理，
   * 避免在空闲状态下产生不必要的去抖定时器和日志开销。
   */
  function handleSelectionChange() {
    // 性能优化：若工具栏未显示且无待处理的选择定时器，直接跳过
    if (!toolbarVisible && selectionTimeout === null) {
      return;
    }
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
      logger.debug('Selection monitor selectionchange', selectionChangePayload);

      // 只在选择被完全清空时才隐藏工具栏
      // 不要在选择变化过程中隐藏，避免工具栏闪烁
      if (!selectedText || selectedText.length === 0) {
        if (selectionTimeout !== null) {
          window.clearTimeout(selectionTimeout);
          selectionTimeout = null;
        }

        // 性能优化：仅在工具栏已显示时才调用隐藏逻辑
        if (toolbarVisible) {
          void hideToolbar(true, 'selection-cleared');
        }
        // 性能优化：清空选区签名，允许后续相同选区重新显示
        lastSelectionSignature = null;
      }
    }, SELECTION_TOOLBAR.SELECTION_CLEAR_DEBOUNCE_MS);
  }

  async function handleWindowBlur() {
    // 延迟检查，避免因工具栏窗口获取焦点而误隐藏
    await new Promise(resolve => setTimeout(resolve, 100));

    // 检查焦点是否转移到了工具栏窗口
    // 如果是，则不隐藏工具栏
    if (document.hasFocus()) {
      // 焦点又回来了，不隐藏
      return;
    }

    if (toolbarVisible) {
      logger.debug('Window blur ignored because toolbar is active');
      return;
    }

    void hideToolbar(true, 'window-blur');

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

    (async () => {
      try {
        unlistenTempDisable = await listen<{ until: number | null }>(
          EVENTS.SELECTION_TOOLBAR_TEMP_DISABLE_CHANGED,
          async (event) => {
            const payload = event.payload;
            const until = payload && typeof payload.until === 'number' ? payload.until : null;
            await configStore.applySelectionToolbarTemporaryDisableSnapshot(until);
            await configStore.refreshSelectionToolbarTemporaryDisableIfExpired();
          }
        );
      } catch (error) {
        logger.error('Failed to listen temporary disable updates', error);
      }
    })();

    logger.info('Global selection monitor initialized');
  });

  onDestroy(() => {
  document.removeEventListener('mouseup', handleSelection);
    document.removeEventListener('selectionchange', handleSelectionChange);
    window.removeEventListener('blur', handleWindowBlur);

  unlistenTempDisable?.();
    
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
