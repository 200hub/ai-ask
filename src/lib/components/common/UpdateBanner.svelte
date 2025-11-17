<script lang='ts'>
  /**
   * Compact update indicator shown in the header.
   */
  import { i18n } from '$lib/i18n'
  import { summarizeReleaseNotes } from '$lib/utils/update'

  type BannerStatus = 'available' | 'downloading' | 'ready' | 'failed'

  interface Props {
    status: BannerStatus
    version?: string
    onDownload?: (() => void) | null
    onRestart?: (() => void) | null
    releaseNotes?: string | null
    releaseUrl?: string | null
  }

  const t = i18n.t

  const {
    status,
    version = '',
    onDownload = null,
    onRestart = null,
    releaseNotes = null,
    releaseUrl = null,
  }: Props = $props()

  function handleDownload() {
    if (onDownload) {
      onDownload()
    }
  }

  function handleRestart() {
    if (onRestart) {
      onRestart()
    }
  }

  function formatTranslation(
    key: string,
    params: Record<string, string | number> = {},
  ): string {
    let output = t(key)
    for (const [paramKey, paramValue] of Object.entries(params)) {
      output = output.replace(`{${paramKey}}`, String(paramValue))
    }
    return output
  }

  function buildTooltip(action: 'download' | 'restart' | 'retry' | 'progress'): string {
    const summary = summarizeReleaseNotes(releaseNotes)
    const parts: string[] = []

    if (action === 'download') {
      parts.push(formatTranslation('update.banner.tooltipDownload', { version }))
    }
    else if (action === 'restart') {
      parts.push(formatTranslation('update.banner.tooltipRestart', { version }))
    }
    else if (action === 'retry') {
      parts.push(formatTranslation('update.banner.tooltipRetry', { version }))
    }
    else {
      parts.push(formatTranslation('update.banner.tooltipDownloading', { version }))
    }

    if (summary) {
      parts.push(t('update.banner.tooltipSummaryLabel'))
      parts.push(summary)
    }

    if (releaseUrl) {
      parts.push(formatTranslation('update.banner.tooltipMore', { url: releaseUrl }))
    }

    return parts.join('\n')
  }
</script>

<div
  class='update-pill'
  aria-live='polite'
  role='status'
>
  {#if status === 'downloading'}
    <span class='pill-text' title={buildTooltip('progress')}>
      <span class='dot' aria-hidden='true'></span>
      {t('update.banner.statusDownloading')}
    </span>
  {:else if status === 'available' && onDownload}
    <button
      type='button'
      class='pill-button'
      onclick={handleDownload}
      title={buildTooltip('download')}
    >
      {t('update.banner.actionDownload')}
    </button>
  {:else if status === 'ready' && onRestart}
    <button
      type='button'
      class='pill-button accent'
      onclick={handleRestart}
      title={buildTooltip('restart')}
    >
      {t('update.banner.actionRestart')}
    </button>
  {:else if status === 'failed' && onDownload}
    <button
      type='button'
      class='pill-button'
      onclick={handleDownload}
      title={buildTooltip('retry')}
    >
      {t('update.banner.actionRetry')}
    </button>
  {/if}
</div>

<style>
  .update-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    color: var(--text-primary);
    -webkit-app-region: no-drag;
    line-height: 1.2;
    max-width: 200px;
  }

  .pill-button {
    border: none;
    background: none;
    color: var(--accent-color);
    font-weight: 600;
    font-size: 0.75rem;
    padding: 0;
    cursor: pointer;
  }

  .pill-button:hover {
    color: var(--accent-hover);
  }

  .pill-button.accent {
    color: var(--text-on-accent, #fff);
    background-color: var(--accent-color);
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
  }

  .pill-button.accent:hover {
    background-color: var(--accent-hover);
  }

  .pill-text {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-secondary);
  }

  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background-color: var(--accent-color);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 0.4;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0.4;
      transform: scale(0.8);
    }
  }
</style>
