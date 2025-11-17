<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import SelectionToolbarPage from '$lib/components/pages/SelectionToolbarPage.svelte'
  import { logger } from '$lib/utils/logger'
  import { getConfig } from '$lib/utils/storage'
  import { listen } from '@tauri-apps/api/event'
  /**
   * Toolbar Route Page
   *
   * 独立的工具栏路由页面，用于在单独的webview窗口中显示
   */
  import { onMount } from 'svelte'
  import '$lib/styles/base.css'

  let isDarkMode = $state<boolean>(false)
  let currentTheme = $state<'system' | 'light' | 'dark'>('system')
  let unlistenTheme: UnlistenFn | null = null
  let mediaQuery: ReturnType<typeof window.matchMedia> | null = null

  function computeIsDark(theme: 'system' | 'light' | 'dark'): boolean {
    return (
      theme === 'dark'
      || (theme === 'system' && mediaQuery?.matches === true)
    )
  }

  function applyTheme(theme: 'system' | 'light' | 'dark'): void {
    currentTheme = theme
    isDarkMode = computeIsDark(theme)
    document.documentElement.classList.toggle('dark', isDarkMode)
  }

  async function loadThemeFromStore(): Promise<void> {
    try {
      const config = await getConfig()
      applyTheme(config.theme)
    }
    catch (error) {
      logger.error('Failed to load config in toolbar window', error)
    }
  }

  onMount(() => {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleSystemThemeChange = () => {
      if (currentTheme === 'system') {
        applyTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)

    void (async () => {
      await loadThemeFromStore()

      try {
        unlistenTheme = await listen<{ theme?: 'system' | 'light' | 'dark' }>('theme-changed', async (event) => {
          const theme = event.payload?.theme
          if (theme) {
            applyTheme(theme)
          }
          else {
            await loadThemeFromStore()
          }
        })
      }
      catch (error) {
        logger.error('Failed to listen for theme changes in toolbar window', error)
      }
    })()

    return () => {
      unlistenTheme?.()
      mediaQuery?.removeEventListener('change', handleSystemThemeChange)
    }
  })
</script>

<svelte:head>
  <title>Selection Toolbar</title>
</svelte:head>

<div class='toolbar-page' class:dark={isDarkMode}>
  <SelectionToolbarPage {isDarkMode} />
</div>

<style>
  .toolbar-page {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    padding: 0;
    margin: 0;
  }

  :global(body) {
    overflow: hidden;
  }
</style>
