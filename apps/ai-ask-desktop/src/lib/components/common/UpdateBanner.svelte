<script lang='ts'>
  import { i18n } from '$lib/i18n'
  import { APP_INFO } from '$lib/utils/constants'
  import { desktopUpdate } from '$lib/utils/desktop-update.svelte'
  import { logger } from '$lib/utils/logger'
  import { Modal } from '@h-ai/ui/components/compounds/index'
  import { Button } from '@h-ai/ui/components/primitives/index'
  import { openUrl } from '@tauri-apps/plugin-opener'

  const { compact = true }: { compact?: boolean } = $props()
  const t = i18n.t
  let confirming = $state(false)
  const actionable = $derived(['available', 'downloading', 'ready', 'installing', 'install-failed'].includes(desktopUpdate.status))
  const canInstall = $derived(['ready', 'install-failed'].includes(desktopUpdate.status))

  async function openReleases() {
    try {
      await openUrl(`${APP_INFO.repository}/releases`)
    }
    catch (error) {
      logger.warn('Failed to open desktop releases', { error })
    }
  }

  function confirmInstall() {
    confirming = false
    void desktopUpdate.install()
  }
</script>

{#if !compact || actionable}
  <div class:compact class='desktop-update' role='status' aria-live='polite' data-testid='desktop-update-status' data-status={desktopUpdate.status}>
    {#if desktopUpdate.status === 'unavailable'}
      <p>{t('update.unavailable')}</p>
    {:else if desktopUpdate.status === 'check-failed'}
      <p>{t('update.checkFailed')}</p>
    {:else if desktopUpdate.status === 'current'}
      <p>{t('about.updateLatest')}</p>
    {:else if desktopUpdate.status === 'checking' || desktopUpdate.status === 'idle'}
      <span>{t('about.updateLoading')}</span>
    {:else if desktopUpdate.status === 'downloading'}
      <span>{t('update.banner.statusDownloading')}{desktopUpdate.percent === undefined ? '' : ` ${desktopUpdate.percent}%`}</span>
    {:else if desktopUpdate.status === 'installing'}
      <span>{t('update.installing')}</span>
    {:else}
      <span>{desktopUpdate.latestVersion}</span>
      {#if desktopUpdate.status === 'install-failed'}
        <p>{t('update.installFailed')}</p>
      {/if}
    {/if}
    {#if !compact && desktopUpdate.notes}
      <pre>{desktopUpdate.notes}</pre>
    {/if}
    <div class='actions'>
      {#if desktopUpdate.status === 'available'}
        <Button size='xs' onclick={() => void desktopUpdate.download()}>{t('update.banner.actionDownload')}</Button>
      {:else if canInstall}
        <Button size='xs' onclick={() => { confirming = true }}>{t('update.banner.actionRestart')}</Button>
      {/if}
      {#if !compact}
        {#if desktopUpdate.enabled && !desktopUpdate.busy && !canInstall}
          <Button size='xs' onclick={() => void desktopUpdate.check()}>{t('update.check')}</Button>
        {/if}
        <Button size='xs' onclick={() => void openReleases()}>{t('about.updateSeeChangelog')}</Button>
      {/if}
    </div>
  </div>
{/if}

<Modal bind:open={confirming} title={t('update.confirmInstall')}>
  <p>{t('update.saveBeforeInstall')}</p>
  {#snippet footer()}
    <Button onclick={() => { confirming = false }}>{t('common.cancel')}</Button>
    <Button variant='primary' data-testid='desktop-update-confirm' onclick={confirmInstall}>{t('common.confirm')}</Button>
  {/snippet}
</Modal>

<style>
  .desktop-update { display: flex; flex-direction: column; gap: 0.6rem; color: var(--text-primary); }
  .desktop-update.compact { flex-direction: row; align-items: center; font-size: 0.75rem; -webkit-app-region: no-drag; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  p { margin: 0; }
  pre { max-height: 12rem; white-space: pre-wrap; overflow: auto; font: inherit; }
</style>
