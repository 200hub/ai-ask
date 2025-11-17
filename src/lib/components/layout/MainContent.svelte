<script lang='ts'>
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { logger } from '$lib/utils/logger'
  /**
   * 主内容区域组件 - 根据当前视图显示不同内容
   */
  import { onMount } from 'svelte'
  import LoadingSpinner from '../common/LoadingSpinner.svelte'
  import WelcomePage from '../pages/WelcomePage.svelte'

  // 懒加载 AIChat，避免未进入聊天视图时的任何潜在副作用
  type AIChatComponent = typeof import('../pages/AIChatPage.svelte').default
  let AIChatComp = $state<AIChatComponent | null>(null)

  // 懒加载翻译页，降低初始包体积
  type TranslationComponent = typeof import('../pages/TranslationPage.svelte').default
  let TranslationComp = $state<TranslationComponent | null>(null)

  // 懒加载设置视图，按需加载设置相关依赖
  type SettingsViewComponent = typeof import('../settings/SettingsPage.svelte').default
  let SettingsViewComp = $state<SettingsViewComponent | null>(null)

  // 懒加载调试页面
  type DebugInjectionPageComponent = typeof import('../pages/DebugInjectionPage.svelte').default
  let DebugInjectionPageComp = $state<DebugInjectionPageComponent | null>(null)

  const t = i18n.t

  $effect(() => {
    if (appState.currentView === 'chat' && !AIChatComp) {
      (async () => {
        const mod = await import('../pages/AIChatPage.svelte')
        AIChatComp = mod.default
      })()
    }
  })

  $effect(() => {
    if (appState.currentView === 'translation' && !TranslationComp) {
      (async () => {
        const mod = await import('../pages/TranslationPage.svelte')
        TranslationComp = mod.default
      })()
    }
  })

  $effect(() => {
    if (appState.currentView === 'settings' && !SettingsViewComp) {
      (async () => {
        try {
          const mod = await import('../settings/SettingsPage.svelte')
          SettingsViewComp = mod.default
        }
        catch (error) {
          logger.error('Failed to load settings view on demand:', error)
        }
      })()
    }
  })

  $effect(() => {
    if (appState.currentView === 'debug' && !DebugInjectionPageComp) {
      (async () => {
        try {
          const mod = await import('../pages/DebugInjectionPage.svelte')
          DebugInjectionPageComp = mod.default
        }
        catch (error) {
          logger.error('Failed to load debug page:', error)
        }
      })()
    }
  })

  onMount(() => {
    const timers: number[] = []

    // 工具函数：在指定延迟后执行预加载逻辑，并记录定时器方便卸载时清理
    const schedulePrefetch = (delay: number, loader: () => void) => {
      const id = window.setTimeout(loader, delay)
      timers.push(id)
    }

    // 1）优先预加载 AI 聊天页面：
        // 应用启动后稍等 200ms，在后台静默 import AIChat，
        // 这样划词触发“解释”或从侧边栏直接进入聊天视图时，不会被首次动态 import 卡住。
    schedulePrefetch(200, () => {
      if (AIChatComp) {
        return
      }

      void import('../pages/AIChatPage.svelte')
        .then((mod) => {
          AIChatComp = mod.default
        })
        .catch((error) => {
          logger.error('Failed to preload AI chat page:', error)
        })
    })

    // 2）随后预加载翻译页面：
        // 再等 320ms 预取 TranslationPage，用于划词翻译场景的首次切换优化。
    schedulePrefetch(320, () => {
      if (TranslationComp) {
        return
      }

      void import('../pages/TranslationPage.svelte')
        .then((mod) => {
          TranslationComp = mod.default
        })
        .catch((error) => {
          logger.error('Failed to preload translation page:', error)
        })
    })

    // 3）最后预加载设置面板：
        // 设置打开频率相对较低，放在最后，避免抢占启动阶段的资源。
    schedulePrefetch(450, () => {
      if (SettingsViewComp) {
        return
      }

      void import('../settings/SettingsPage.svelte')
        .then((mod) => {
          SettingsViewComp = mod.default
        })
        .catch((error) => {
          logger.error('Failed to preload settings view:', error)
        })
    })

    // 组件卸载时统一清理所有预加载定时器，防止潜在的内存泄漏。
    return () => {
      timers.forEach(id => window.clearTimeout(id))
    }
  })
</script>

<main class='main-content'>
  <div class='view welcome' class:active={appState.currentView === 'welcome'}>
    <WelcomePage />
  </div>

  <div class='view chat' class:active={appState.currentView === 'chat'}>
    {#if AIChatComp}
      <AIChatComp />
    {:else}
      <div class='loading-container'>
        <LoadingSpinner size='large' message={t('chat.loading')} />
      </div>
    {/if}
  </div>

  <div class='view translation' class:active={appState.currentView === 'translation'}>
    {#if TranslationComp}
      <TranslationComp />
    {:else}
      <div class='loading-container'>
        <LoadingSpinner size='large' message={t('common.loading')} />
      </div>
    {/if}
  </div>

  <div class='view settings' class:active={appState.currentView === 'settings'}>
    {#if SettingsViewComp}
      <SettingsViewComp />
    {:else}
      <div class='loading-container'>
        <LoadingSpinner size='large' message={t('common.loading')} />
      </div>
    {/if}
  </div>

  <div class='view debug' class:active={appState.currentView === 'debug'}>
    {#if DebugInjectionPageComp}
      <DebugInjectionPageComp />
    {:else}
      <div class='loading-container'>
        <LoadingSpinner size='large' message={t('common.loading')} />
      </div>
    {/if}
  </div>

  {#if appState.error}
    <div class='error-toast'>
      <svg
        class='error-icon'
        fill='none'
        stroke='currentColor'
        viewBox='0 0 24 24'
      >
        <path
          stroke-linecap='round'
          stroke-linejoin='round'
          stroke-width='2'
          d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
        />
      </svg>
      <span>{appState.error}</span>
      <button
        class='close-toast'
        onclick={() => appState.clearError()}
        aria-label={t('common.close')}
      >
        <svg fill='none' stroke='currentColor' viewBox='0 0 24 24'>
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='2'
            d='M6 18L18 6M6 6l12 12'
          />
        </svg>
      </button>
    </div>
  {/if}
</main>

<style>
    .main-content {
        flex: 1;
        position: relative;
        overflow: hidden;
        background-color: var(--bg-primary);
    }

    .view {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: none;
    }

    .view.active {
        display: block;
    }

    .error-toast {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1.25rem;
        background-color: var(--error-color);
        color: white;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideUp 0.3s ease-out;
        max-width: 90%;
    }

    @keyframes slideUp {
        from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
        }
        to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }

    .error-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .error-toast span {
        font-size: 0.875rem;
        font-weight: 500;
    }

    .close-toast {
        width: 20px;
        height: 20px;
        padding: 0;
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        flex-shrink: 0;
        opacity: 0.8;
        transition: opacity 0.2s ease;
    }

    .close-toast:hover {
        opacity: 1;
    }

    .close-toast svg {
        width: 100%;
        height: 100%;
    }

    .loading-container {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

</style>
