<script lang='ts'>
  /**
   * 头部栏组件
   *
   * 包含窗口控制按钮（最小化、最大化、关闭）和更新提示 Banner
   */
  import UpdateBanner from '$lib/components/common/UpdateBanner.svelte'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { logger } from '$lib/utils/logger'
  import { updateManager } from '$lib/utils/update-manager.svelte'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import { Maximize2, Minimize2, Minus, X } from 'lucide-svelte'
  import { onDestroy, onMount } from 'svelte'

  const t = i18n.t
  const appWindow = getCurrentWebviewWindow()

  // 窗口最大化状态
  let isMaximized = $state(false)

  // ============ 窗口控制 ============

  /**
   * 分发隐藏所有 WebView 的事件
   */
  function dispatchHideWebviews(): void {
    window.dispatchEvent(
      new CustomEvent('hideAllWebviews', {
        detail: { markForRestore: true },
      }),
    )
  }

  /**
   * 关闭按钮 - 隐藏到系统托盘
   */
  async function handleClose(): Promise<void> {
    dispatchHideWebviews()
    try {
      await appWindow.hide()
    }
    catch (error) {
      logger.error('Failed to hide window', error)
    }
  }

  /**
   * 最小化到任务栏
   */
  async function handleMinimize(): Promise<void> {
    try {
      await appWindow.minimize()
    }
    catch (error) {
      logger.error('Failed to minimize window', error)
    }
  }

  /**
   * 切换最大化状态
   */
  async function toggleMaximize(): Promise<void> {
    try {
      await appWindow.toggleMaximize()
      isMaximized = await appWindow.isMaximized()
    }
    catch (error) {
      logger.error('Failed to toggle maximize window', error)
    }
  }

  /**
   * 双击标题栏切换最大化
   */
  function handleDoubleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement
    // 确保不是在按钮区域双击
    if (target.closest('.header-right') || target.closest('button')) {
      return
    }
    toggleMaximize()
  }

  // ============ 更新管理 ============

  /**
   * 下载更新
   */
  function handleDownload(): void {
    void updateManager.download()
  }

  /**
   * 安装更新并重启
   */
  function handleRestart(): void {
    void updateManager.installAndRestart()
  }

  // ============ 生命周期 ============

  onMount(async () => {
    // 初始化最大化状态
    try {
      isMaximized = await appWindow.isMaximized()
    }
    catch {
    // 忽略错误
    }

    // 初始化更新管理器
    void updateManager.init()
  })

  onDestroy(() => {
    updateManager.destroy()
  })

  // 监听窗口大小变化更新最大化状态
  $effect(() => {
    const handleResize = async () => {
      try {
        isMaximized = await appWindow.isMaximized()
      }
      catch {
      // 忽略错误
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  })

  // ============ 派生状态 ============

  const showBanner = $derived(updateManager.status !== 'hidden')
  const bannerStatus = $derived(
    updateManager.status === 'available'
      ? 'available'
      : updateManager.status === 'downloading'
      ? 'downloading'
      : updateManager.status === 'ready'
      ? 'ready'
      : 'failed',
  )
  const canDownload = $derived(
    updateManager.status === 'available' || updateManager.status === 'failed',
  )
  const canRestart = $derived(updateManager.status === 'ready')
</script>

<header class='header' data-tauri-drag-region ondblclick={handleDoubleClick} role='presentation'>
  <div class='header-left'>
    {#if appState.selectedPlatform}
      <img
        src={appState.selectedPlatform.icon}
        alt={appState.selectedPlatform.name}
        class='platform-icon'
        onerror={(e) => {
          const target = e.currentTarget as HTMLImageElement
          target.src
            = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22/%3E%3C/svg%3E'
        }}
      />
      <h1 class='platform-name'>{appState.selectedPlatform.name}</h1>
    {:else if appState.currentView === 'translation'}
      <h1 class='platform-name'>{t('sidebar.translation')}</h1>
    {:else if appState.currentView === 'settings'}
      <h1 class='platform-name'>{t('settings.title')}</h1>
    {:else}
      <h1 class='app-title'>{t('app.name')}</h1>
    {/if}
  </div>

  <div class='header-right'>
    {#if showBanner}
      <UpdateBanner
        status={bannerStatus}
        version={updateManager.version}
        releaseNotes={updateManager.releaseNotes}
        releaseUrl={updateManager.releaseUrl}
        onDownload={canDownload ? handleDownload : null}
        onRestart={canRestart ? handleRestart : null}
      />
    {/if}
    <!-- 最小化按钮 -->
    <button
      class='icon-btn'
      onclick={handleMinimize}
      type='button'
      aria-label={t('header.minimize')}
    >
      <Minus size={16} />
    </button>
    <!-- 最大化/还原按钮 -->
    <button
      class='icon-btn'
      onclick={toggleMaximize}
      type='button'
      aria-label={isMaximized ? t('header.restore') : t('header.maximize')}
    >
      {#if isMaximized}
        <Minimize2 size={14} />
      {:else}
        <Maximize2 size={14} />
      {/if}
    </button>
    <!-- 关闭按钮 -->
    <button
      class='icon-btn hover-close'
      onclick={handleClose}
      type='button'
      aria-label={t('header.close')}
    >
      <X size={16} />
    </button>
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 0.75rem;
    background-color: var(--bg-primary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
    /* Enable window dragging for the entire header */
    -webkit-app-region: drag;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex: 1;
    min-width: 0;
  }

  .platform-icon {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .platform-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    background: linear-gradient(135deg, var(--accent-color) 0%, #8b5cf6 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    /* Disable drag for button area - CRITICAL */
    -webkit-app-region: no-drag;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: all 0.15s ease;
    padding: 0;
    /* Force no-drag on buttons - CRITICAL */
    -webkit-app-region: no-drag !important;
    position: relative;
    z-index: 10;
  }

  .icon-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-secondary);
  }

  .icon-btn:active {
    transform: scale(0.92);
  }

  .hover-close:hover {
    background-color: #ef4444 !important;
    color: white !important;
  }
</style>
