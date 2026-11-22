<script lang='ts'>
  import { i18n } from '$lib/i18n'
  import { desktopPages, desktopRouter } from '$lib/navigation/router.svelte'

  const t = i18n.t
  const pageComponent = $derived(desktopPages[desktopRouter.file]())
</script>

{#key `${desktopRouter.path}${desktopRouter.search}`}
  {#await pageComponent}
    <div class='route-loading' role='status'>{t('common.loading')}</div>
  {:then { default: Page }}
    <Page />
  {/await}
{/key}

<style>
  .route-loading {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    background: var(--bg-primary);
    color: var(--text-primary);
  }
</style>
