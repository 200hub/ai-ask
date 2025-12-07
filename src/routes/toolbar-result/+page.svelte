<script lang='ts'>
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import SelectionResultPage from '$lib/components/pages/SelectionResultPage.svelte'
  import { logger } from '$lib/utils/logger'
  import { getConfig } from '$lib/utils/storage'
  import { listen } from '@tauri-apps/api/event'
  /**
   * Toolbar Result Route Page
   *
   * 独立的浮动结果窗口路由页面，用于显示翻译/解释结果
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
      logger.error('Failed to load config in toolbar result window', error)
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
        logger.error('Failed to listen for theme changes in toolbar result window', error)
      }
    })()

    return () => {
      unlistenTheme?.()
      mediaQuery?.removeEventListener('change', handleSystemThemeChange)
    }
  })
</script>

<svelte:head>
  <title>Selection Result</title>
</svelte:head>

<div class='result-page' class:dark={isDarkMode}>
  <SelectionResultPage {isDarkMode} />
</div>

<style>
  .result-page {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    padding: 0;
    margin: 0;
    overflow: hidden;
  }

  :global(body) {
    overflow: hidden;
  }
</style>
