<script lang='ts'>
  /**
   * AI 平台设置页面 - 重构版
   *
   * 将所有平台相关设置集成在一起：
   * - 启用/禁用
   * - 预加载设置
   * - 排序
   * - 划词工具栏可用性
   */
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { platformsStore } from '$lib/stores/platforms.svelte'
  import { logger } from '$lib/utils/logger'
  import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronUp,
    Loader,
    MousePointer2,
    Plus,
    Trash2,
    Zap,
  } from 'lucide-svelte'
  import { onMount, tick } from 'svelte'
  import Button from '../common/Button.svelte'

  const t = i18n.t

  // 备用图标 SVG
  const FALLBACK_ICON
    = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\'/%3E%3C/svg%3E'

  // 添加平台模态框状态
  let showAddModal = $state(false)
  let isSubmitting = $state(false)
  let formError = $state<string | null>(null)

  // 新平台表单字段
  let newPlatformName = $state('')
  let newPlatformUrl = $state('')
  let newPlatformIcon = $state('')
  let newPlatformEnabled = $state(true)
  let newPlatformPreload = $state(false)

  // 展开/收起的平台 ID 集合
  let expandedPlatforms = $state<Set<string>>(new Set())

  // 派生：按排序顺序排列的平台列表
  const orderedPlatforms = $derived(
    [...platformsStore.platforms].sort((a, b) => a.sortOrder - b.sortOrder),
  )

  // 组件挂载时初始化
  onMount(async () => {
    if (platformsStore.platforms.length === 0) {
      try {
        await platformsStore.init()
      }
      catch (error) {
        logger.error('Failed to load AI platforms', error)
      }
    }
  })

  // 自动聚焦指令
  function focusOnMount(node: HTMLElement) {
    tick().then(() => node.focus())
    return { destroy() {} }
  }

  // 重置表单
  function resetForm() {
    newPlatformName = ''
    newPlatformUrl = ''
    newPlatformIcon = ''
    newPlatformEnabled = true
    newPlatformPreload = false
    formError = null
  }

  // 图标加载失败处理
  function handleIconError(event: Event) {
    const target = event.currentTarget as HTMLImageElement | null
    if (target && target.src !== FALLBACK_ICON) {
      target.src = FALLBACK_ICON
    }
  }

  // 切换平台启用状态
  async function togglePlatform(id: string) {
    try {
      await platformsStore.togglePlatform(id)
    }
    catch {
      // eslint-disable-next-line no-alert
      window.alert(t('platforms.errorToggle'))
    }
  }

  // 切换预加载状态
  async function togglePreload(id: string) {
    try {
      await platformsStore.togglePreload(id)
    }
    catch {
      // eslint-disable-next-line no-alert
      window.alert(t('platforms.preloadToggleError'))
    }
  }

  // 删除平台
  async function deletePlatform(id: string) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('platforms.confirmRemove'))) return

    try {
      await platformsStore.removePlatform(id)
    }
    catch {
      // eslint-disable-next-line no-alert
      window.alert(t('platforms.errorDelete'))
    }
  }

  // 移动平台排序
  async function movePlatform(id: string, direction: 'up' | 'down') {
    logger.info('Moving platform', { id, direction })

    try {
      await platformsStore.movePlatform(id, direction)
    }
    catch {
      // eslint-disable-next-line no-alert
      window.alert(t('platforms.errorOrder'))
    }
  }

  // 切换平台展开/收起状态
  function toggleExpanded(id: string) {
    const newSet = new Set(expandedPlatforms)
    if (newSet.has(id)) {
      newSet.delete(id)
    }
    else {
      newSet.add(id)
    }
    expandedPlatforms = newSet
  }

  // 打开添加模态框
  function openAddModal() {
    resetForm()
    showAddModal = true
  }

  // 关闭添加模态框
  function closeAddModal() {
    showAddModal = false
  }

  // 表单验证
  function validateForm() {
    if (!newPlatformName.trim()) {
      throw new Error(t('platforms.required'))
    }

    if (!newPlatformUrl.trim()) {
      throw new Error(t('platforms.required'))
    }

    try {
      const parsed = new URL(newPlatformUrl.trim())
      if (!parsed.protocol.startsWith('http')) {
        // eslint-disable-next-line unicorn/error-message
        throw new Error()
      }
    }
    catch {
      throw new Error(t('platforms.invalidUrl'))
    }

    if (newPlatformIcon.trim()) {
      try {
        const parsed = new URL(newPlatformIcon.trim())
        if (!parsed.protocol.startsWith('http')) {
          // eslint-disable-next-line unicorn/error-message
          throw new Error()
        }
      }
      catch {
        throw new Error(t('platforms.invalidUrl'))
      }
    }
  }

  // 添加平台
  async function handleAddPlatform() {
    formError = null

    try {
      validateForm()
    }
    catch (error) {
      formError = error instanceof Error ? error.message : t('errors.unknownError')
      return
    }

    isSubmitting = true

    try {
      await platformsStore.addPlatform({
        name: newPlatformName.trim(),
        url: newPlatformUrl.trim(),
        icon: newPlatformIcon.trim() || FALLBACK_ICON,
        enabled: newPlatformEnabled,
      })
      closeAddModal()
    }
    catch (error) {
      logger.error('Failed to add platform', error)
      formError = t('platforms.errorAdd')
    }
    finally {
      isSubmitting = false
    }
  }

  // 切换全局预加载开关
  async function handleGlobalPreloadChange(event: Event) {
    const target = event.target as HTMLInputElement
    const enabled = target.checked

    try {
      await configStore.setPreloadDefaultPlatforms(enabled)
    }
    catch (error) {
      logger.error('Failed to change preload setting', error)
      target.checked = !enabled
    }
  }
</script>

<div class='settings-section'>
  <!-- 预加载全局设置 -->
  <div class='setting-group'>
    <div class='group-header'>
      <div class='header-content'>
        <h3 class='group-title'>{t('platforms.preloadTitle')}</h3>
        <p class='group-description'>{t('platforms.preloadDescription')}</p>
      </div>
      <label class='toggle-switch'>
        <input
          type='checkbox'
          checked={configStore.config.preloadDefaultPlatforms}
          onchange={handleGlobalPreloadChange}
        />
        <span class='toggle-slider'></span>
      </label>
    </div>
  </div>

  <!-- 平台列表 -->
  <div class='setting-group'>
    <div class='group-header'>
      <div class='header-content'>
        <h3 class='group-title'>{t('platforms.listTitle')}</h3>
        <p class='group-description'>{t('platforms.listDescription')}</p>
      </div>
      <Button variant='primary' size='sm' onclick={openAddModal}>
        <Plus size={16} />
        {t('platforms.addPlatform')}
      </Button>
    </div>

    <div class='platform-list'>
      {#if orderedPlatforms.length === 0}
        <p class='empty-message'>{t('platforms.noPlatforms')}</p>
      {:else}
        {#each orderedPlatforms as platform, index (platform.id)}
          {@const isExpanded = expandedPlatforms.has(platform.id)}
          <div class='platform-card' class:expanded={isExpanded} class:disabled={!platform.enabled}>
            <!-- 主行：图标、名称、状态、展开/排序按钮 -->
            <div class='platform-main'>
              <div class='platform-info'>
                <span class='order-number'>{index + 1}</span>
                <img
                  src={platform.icon || FALLBACK_ICON}
                  alt={platform.name}
                  class='platform-icon'
                  onerror={handleIconError}
                />
                <div class='platform-details'>
                  <div class='platform-name-row'>
                    <span class='platform-name'>{platform.name}</span>
                    {#if platform.isCustom}
                      <span class='custom-tag'>{t('platforms.customTag')}</span>
                    {/if}
                  </div>
                  <div class='platform-badges'>
                    {#if platform.preload && configStore.config.preloadDefaultPlatforms}
                      <span class='badge badge-preload' title={t('platforms.preloadEnabled')}>
                        <Zap size={12} />
                      </span>
                    {/if}
                    {#if platform.selectionToolbarAvailable}
                      <span class='badge badge-selection' title={t('platforms.selectionToolbarAvailable')}>
                        <MousePointer2 size={12} />
                      </span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class='platform-actions'>
                <!-- 启用开关 -->
                <label class='toggle-switch'>
                  <input
                    type='checkbox'
                    checked={platform.enabled}
                    onchange={() => togglePlatform(platform.id)}
                  />
                  <span class='toggle-slider'></span>
                </label>

                <!-- 排序按钮 -->
                <div class='order-buttons'>
                  <button
                    type='button'
                    class='order-btn'
                    onclick={() => movePlatform(platform.id, 'up')}
                    disabled={index === 0}
                    aria-label={t('platforms.moveUp')}
                    title={t('platforms.moveUp')}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type='button'
                    class='order-btn'
                    onclick={() => movePlatform(platform.id, 'down')}
                    disabled={index === orderedPlatforms.length - 1}
                    aria-label={t('platforms.moveDown')}
                    title={t('platforms.moveDown')}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>

                <!-- 展开/收起按钮 -->
                <button
                  type='button'
                  class='expand-btn'
                  onclick={() => toggleExpanded(platform.id)}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {#if isExpanded}
                    <ChevronUp size={18} />
                  {:else}
                    <ChevronDown size={18} />
                  {/if}
                </button>
              </div>
            </div>

            <!-- 展开区域：详细设置 -->
            {#if isExpanded}
              <div class='platform-expanded'>
                <div class='expanded-row'>
                  <span class='expanded-label'>{t('platforms.url')}</span>
                  <span class='expanded-value url'>{platform.url}</span>
                </div>

                <!-- 预加载设置 -->
                <div class='expanded-row'>
                  <span class='expanded-label'>{t('platforms.preload')}</span>
                  <label class='toggle-switch small'>
                    <input
                      type='checkbox'
                      checked={platform.preload ?? false}
                      onchange={() => togglePreload(platform.id)}
                      disabled={!configStore.config.preloadDefaultPlatforms}
                    />
                    <span class='toggle-slider'></span>
                  </label>
                </div>

                <!-- 划词可用性（只读显示） -->
                <div class='expanded-row'>
                  <span class='expanded-label'>{t('platforms.selectionToolbar')}</span>
                  <span class='expanded-value'>
                    {platform.selectionToolbarAvailable
                      ? t('platforms.selectionToolbarAvailable')
                      : t('platforms.selectionToolbarUnavailable')}
                  </span>
                </div>

                <!-- 删除按钮（仅自定义平台） -->
                {#if platform.isCustom}
                  <div class='expanded-actions'>
                    <button
                      type='button'
                      class='btn-danger'
                      onclick={() => deletePlatform(platform.id)}
                    >
                      <Trash2 size={14} />
                      {t('common.delete')}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<!-- 添加平台模态框 -->
{#if showAddModal}
  <div
    class='modal-overlay'
    role='button'
    tabindex='0'
    aria-label={t('common.close')}
    onclick={(event) => {
      if (event.target === event.currentTarget) closeAddModal()
    }}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAddModal()
      }
    }}
  >
    <div class='modal' role='dialog' aria-modal='true' tabindex='-1' use:focusOnMount>
      <h3 class='modal-title'>{t('platforms.addPlatform')}</h3>

      <div class='form-group'>
        <label class='form-label' for='platform-name'>
          {t('platforms.name')} *
        </label>
        <input
          id='platform-name'
          type='text'
          class='form-input'
          placeholder={t('platforms.namePlaceholder')}
          bind:value={newPlatformName}
        />
      </div>

      <div class='form-group'>
        <label class='form-label' for='platform-url'>
          {t('platforms.url')} *
        </label>
        <input
          id='platform-url'
          type='url'
          class='form-input'
          placeholder={t('platforms.urlPlaceholder')}
          bind:value={newPlatformUrl}
        />
      </div>

      <div class='form-group'>
        <label class='form-label' for='platform-icon'>{t('platforms.icon')}</label>
        <input
          id='platform-icon'
          type='url'
          class='form-input'
          placeholder={t('platforms.iconPlaceholder')}
          bind:value={newPlatformIcon}
        />
        <p class='form-hint'>{t('platforms.iconOptionalHint')}</p>
      </div>

      <div class='toggle-field'>
        <span class='toggle-text'>{t('platforms.enableAfterAdding')}</span>
        <label class='toggle-switch'>
          <input
            type='checkbox'
            aria-label={t('platforms.enableAfterAdding')}
            checked={newPlatformEnabled}
            onchange={() => (newPlatformEnabled = !newPlatformEnabled)}
          />
          <span class='toggle-slider'></span>
        </label>
      </div>

      <div class='toggle-field'>
        <span class='toggle-text'>{t('platforms.preload')}</span>
        <label class='toggle-switch'>
          <input
            type='checkbox'
            aria-label={t('platforms.preload')}
            checked={newPlatformPreload}
            onchange={() => (newPlatformPreload = !newPlatformPreload)}
          />
          <span class='toggle-slider'></span>
        </label>
      </div>

      {#if formError}
        <p class='form-error'>{formError}</p>
      {/if}

      <div class='modal-actions'>
        <Button variant='secondary' size='sm' onclick={closeAddModal}>
          {t('common.cancel')}
        </Button>
        <Button
          variant='primary'
          size='sm'
          onclick={handleAddPlatform}
          disabled={isSubmitting}
        >
          {#if isSubmitting}
            <Loader size={14} class='spin' />
          {/if}
          {isSubmitting ? t('common.loading') : t('platforms.addPlatform')}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background-color: var(--bg-secondary);
    border-radius: 0.75rem;
    padding: 1.25rem;
    border: 1px solid var(--border-color);
  }

  .group-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .group-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .group-description {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .platform-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .platform-card {
    background-color: var(--bg-primary);
    border-radius: 0.5rem;
    border: 1px solid var(--border-color);
    overflow: hidden;
    transition: border-color 0.2s ease;
  }

  .platform-card:hover {
    border-color: var(--border-color-hover, var(--border-color));
  }

  .platform-card.disabled {
    opacity: 0.6;
  }

  .platform-card.expanded {
    border-color: var(--accent-color);
  }

  .platform-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    gap: 1rem;
  }

  .platform-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    flex: 1;
  }

  .order-number {
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background-color: var(--bg-tertiary);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .platform-icon {
    width: 32px;
    height: 32px;
    border-radius: 0.375rem;
    object-fit: cover;
    background-color: var(--bg-secondary);
    flex-shrink: 0;
  }

  .platform-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .platform-name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .platform-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .custom-tag {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--accent-color);
    background-color: color-mix(in srgb, var(--accent-color) 10%, transparent);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .platform-badges {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 0.25rem;
  }

  .badge-preload {
    color: var(--warning-color, #f59e0b);
    background-color: color-mix(in srgb, var(--warning-color, #f59e0b) 15%, transparent);
  }

  .badge-selection {
    color: var(--success-color, #10b981);
    background-color: color-mix(in srgb, var(--success-color, #10b981) 15%, transparent);
  }

  .platform-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .order-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .order-btn {
    width: 24px;
    height: 18px;
    border-radius: 0.25rem;
    border: 1px solid var(--border-color);
    background-color: var(--bg-primary);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .order-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--accent-color);
    background-color: var(--bg-secondary);
  }

  .order-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .expand-btn {
    width: 32px;
    height: 32px;
    border-radius: 0.375rem;
    border: none;
    background-color: transparent;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .expand-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-tertiary);
  }

  .platform-expanded {
    padding: 0.75rem 1rem 1rem;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .expanded-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.8125rem;
  }

  .expanded-label {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .expanded-value {
    color: var(--text-primary);
  }

  .expanded-value.url {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
    text-align: right;
  }

  .expanded-actions {
    margin-top: 0.5rem;
    display: flex;
    justify-content: flex-end;
  }

  .btn-danger {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: #fff;
    background-color: var(--error-color, #ef4444);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-danger:hover {
    background-color: color-mix(in srgb, var(--error-color, #ef4444) 85%, #000);
  }

  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .toggle-switch.small {
    width: 36px;
    height: 20px;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    inset: 0;
    background-color: var(--border-color);
    border-radius: 22px;
    transition: all 0.25s ease;
  }

  .toggle-slider::before {
    content: "";
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: all 0.25s ease;
  }

  .toggle-switch.small .toggle-slider::before {
    height: 14px;
    width: 14px;
  }

  .toggle-switch input:checked + .toggle-slider {
    background-color: var(--accent-color);
  }

  .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(18px);
  }

  .toggle-switch.small input:checked + .toggle-slider::before {
    transform: translateX(16px);
  }

  .toggle-switch input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-message {
    margin: 0;
    padding: 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-align: center;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 10, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 1000;
  }

  .modal {
    width: min(440px, 100%);
    background-color: var(--bg-primary);
    border-radius: 0.75rem;
    border: 1px solid var(--border-color);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: var(--shadow-lg);
  }

  .modal-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-input {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    border: 1px solid var(--border-color);
    border-radius: 0.375rem;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 20%, transparent);
  }

  .form-hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
  }

  .toggle-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background-color: var(--bg-secondary);
  }

  .toggle-text {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-error {
    margin: 0;
    color: var(--error-color);
    font-size: 0.75rem;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.625rem;
    margin-top: 0.25rem;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .platform-main {
      flex-wrap: wrap;
    }

    .platform-info {
      flex: 1 1 100%;
    }

    .platform-actions {
      width: 100%;
      justify-content: flex-end;
      padding-top: 0.5rem;
    }

    .expanded-value.url {
      max-width: 100%;
    }
  }

  /* Animation */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
