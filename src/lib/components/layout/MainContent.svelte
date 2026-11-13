<script lang='ts'>
  import type { ViewType } from '$lib/types/config'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { logger } from '$lib/utils/logger'
  import { onMount } from 'svelte'
  import LoadingSpinner from '../common/LoadingSpinner.svelte'
  import WelcomePage from '../pages/WelcomePage.svelte'

  type LazyView = Exclude<ViewType, 'welcome' | 'toolbar'>

  const loaders = {
    chat: () => import('../pages/AIChatPage.svelte'),
    translation: () => import('../pages/TranslationPage.svelte'),
    settings: () => import('../settings/SettingsPage.svelte'),
    debug: () => import('../pages/DebugInjectionPage.svelte'),
  }
  type ViewComponent = Awaited<ReturnType<typeof loaders[LazyView]>>['default']

  const t = i18n.t
  const viewNames = Object.keys(loaders) as LazyView[]
  const imports: Partial<Record<LazyView, Promise<{ default: ViewComponent }>>> = {}
  const mounted = $state<Partial<Record<LazyView, ViewComponent>>>({})

  function loadView(view: LazyView) {
    const existing = imports[view]
    if (existing) {
      return existing
    }

    const pending = loaders[view]().catch((error) => {
      delete imports[view]
      throw error
    })
    imports[view] = pending
    return pending
  }

  $effect(() => {
    const view = appState.currentView
    if (view === 'welcome' || view === 'toolbar') {
      return
    }

    void loadView(view).then(({ default: Component }) => {
      mounted[view] = Component
    }).catch((error) => {
      logger.error('Failed to load application view', { view, error })
      if (appState.currentView === view) {
        appState.setError(t('errors.loadFailed'))
      }
    })
  })

  onMount(() => {
    if (!window.requestIdleCallback) {
      return
    }
    const idle = window.requestIdleCallback(() => {
      void loadView('translation').catch(error => logger.debug('Translation view prefetch failed', error))
    })
    return () => window.cancelIdleCallback(idle)
  })
</script>

<main class='main-content'>
  <div class='view welcome' class:active={appState.currentView === 'welcome'}>
    <WelcomePage />
  </div>

  {#each viewNames as view (view)}
    {@const Component = mounted[view]}
    {@const active = appState.currentView === view}
    {#if Component || active}
      <div class='view' class:active>
        {#if Component}
          <Component />
        {:else}
          <div class='loading-container'>
            <LoadingSpinner size='large' message={t(view === 'chat' ? 'chat.loading' : 'common.loading')} />
          </div>
        {/if}
      </div>
    {/if}
  {/each}

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
