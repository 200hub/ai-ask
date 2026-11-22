<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { i18n } from '$lib/i18n'
  import { MARKDOWN_PREVIEW } from '$lib/utils/constants'
  import { renderMarkdown } from '$lib/utils/markdown'

  type Props = {
    content: string
    scope: string | number
    children?: Snippet
  }

  const { content, scope, children }: Props = $props()

  let imagePermission = $state<{ scope: string | number } | null>(null)
  const t = i18n.t
  const remoteImagesAllowed = $derived(imagePermission?.scope === scope)
  const privateHtml = $derived(renderMarkdown(content))
  const hasBlockedImages = $derived(privateHtml.includes(`class="${MARKDOWN_PREVIEW.BLOCKED_IMAGE_CLASS}"`))
  const html = $derived(remoteImagesAllowed ? renderMarkdown(content, { remoteImages: true }) : privateHtml)

  // 许可只属于当前便签或当前划词请求；切换后不能沿用先前内容的许可。
  $effect(() => {
    if (imagePermission && imagePermission.scope !== scope)
      imagePermission = null
  })

  function toggleExternalImages() {
    imagePermission = remoteImagesAllowed ? null : { scope }
  }
</script>

{#if hasBlockedImages}
  <button
    type='button'
    class='external-images-button'
    aria-pressed={remoteImagesAllowed}
    onclick={toggleExternalImages}
  >
    {t(remoteImagesAllowed ? 'markdown.hideExternalImages' : 'markdown.showExternalImages')}
  </button>
{/if}
{#if html}
  <!-- Hai 公共解析器始终负责标签和 URL 白名单；许可仅切换其网络图片选项。 -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
{:else}
  {@render children?.()}
{/if}

<style>
  .external-images-button {
    display: block;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
    background: var(--bg-secondary);
    color: inherit;
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .external-images-button:hover {
    background: var(--bg-tertiary);
  }

  .external-images-button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 0.125rem;
  }
</style>
