<script lang='ts'>
  import type { DesktopNoteTodo, DesktopNoteTodoPreferences, DesktopNoteTodoSort } from '$lib/utils/desktop-note-todo'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import {
    DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
    DESKTOP_NOTE_TODO_PRIORITIES,
    DESKTOP_NOTE_TODO_SORT_MODES,
  } from '$lib/utils/constants'
  import {
    getVisibleDesktopNoteTodos,
    moveDesktopNoteTodo,
    parseDesktopNoteTodos,
    serializeDesktopNoteTodos,
  } from '$lib/utils/desktop-note-todo'
  import { CalendarDays, Flag, GripVertical, X } from '@lucide/svelte'
  import { tick } from 'svelte'

  type Props = {
    content: string
    onChange: (content: string) => void
    preferences?: DesktopNoteTodoPreferences
    onPreferencesChange?: (preferences: DesktopNoteTodoPreferences) => void
  }

  type MetadataField = 'priority' | 'deadline'
  type Placement = 'before' | 'after'

  const {
    content,
    onChange,
    preferences = DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
    onPreferencesChange,
  }: Props = $props()
  const t = i18n.t
  const editorId = $props.id()

  let draft = $state('')
  let newItemInput: HTMLInputElement
  let listElement = $state<HTMLUListElement>()
  let metadataInput = $state<HTMLInputElement | HTMLSelectElement>()
  let expanded = $state<{ index: number, field: MetadataField } | null>(null)
  let dragged = $state<{ index: number, content: string, hideCompleted: boolean } | null>(null)
  let dropTarget = $state<{ index: number, placement: Placement } | null>(null)
  const items = $derived(parseDesktopNoteTodos(content).map((item, id) => ({ ...item, id })))
  const visibleItems = $derived(getVisibleDesktopNoteTodos(items, preferences))
  const canReorder = $derived(preferences.sort === 'manual' && visibleItems.length > 1)
  const activeDrag = $derived(
    canReorder && dragged?.content === content && dragged.hideCompleted === preferences.hideCompleted
      ? dragged
      : null,
  )
  const dateFormatter = $derived(new Intl.DateTimeFormat(configStore.config.locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }))

  function addItem(event: SubmitEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) {
      return
    }
    onChange(serializeDesktopNoteTodos([...items, { text, completed: false }]))
    draft = ''
    newItemInput.focus()
  }

  function updateItem(index: number, updates: Partial<DesktopNoteTodo>) {
    onChange(serializeDesktopNoteTodos(items.map((item, position) =>
      position === index ? { ...item, ...updates } : item,
    )))
  }

  function removeItem(index: number) {
    if (expanded?.index === index) {
      expanded = null
    }
    else if (expanded && expanded.index > index) {
      expanded = { ...expanded, index: expanded.index - 1 }
    }
    onChange(serializeDesktopNoteTodos(items.filter((_item, position) => position !== index)))
  }

  function changePreferences(updates: Partial<DesktopNoteTodoPreferences>) {
    expanded = null
    endDrag()
    onPreferencesChange?.({ ...preferences, ...updates })
  }

  async function toggleMetadata(index: number, field: MetadataField, event: MouseEvent) {
    if (expanded?.index === index && expanded.field === field) {
      expanded = null
      return
    }
    expanded = { index, field }
    await tick()
    metadataInput?.focus()
    if (event.isTrusted && event.detail > 0) {
      try {
        metadataInput?.showPicker()
      }
      catch {
        // The focused native field remains usable if Windows WebView blocks a programmatic picker.
      }
    }
  }

  function closeMetadata(event: KeyboardEvent, index: number, field: MetadataField) {
    if (event.key === 'Escape') {
      expanded = null
      focusMetadata(index, field)
    }
  }

  function focusMetadata(index: number, field: MetadataField) {
    listElement?.querySelector<HTMLButtonElement>(`[data-metadata="${field}"][data-index="${index}"]`)?.focus()
  }

  async function updateMetadata(index: number, field: MetadataField, value: string) {
    updateItem(index, field === 'priority'
      ? { priority: DESKTOP_NOTE_TODO_PRIORITIES.find(priority => priority === value) }
      : { deadline: value || undefined })
    expanded = null
    await tick()
    focusMetadata(index, field)
  }

  async function reorder(from: number, to: number, placement: Placement, restoreFocus = false) {
    const reordered = moveDesktopNoteTodo(items, from, to, placement)
    if (reordered === items) {
      return
    }
    expanded = null
    onChange(serializeDesktopNoteTodos(reordered))
    if (restoreFocus) {
      const index = reordered.findIndex(item => item.id === from)
      await tick()
      listElement?.querySelector<HTMLButtonElement>(`[data-reorder-index="${index}"]`)?.focus()
    }
  }

  function reorderByKeyboard(event: KeyboardEvent, index: number, visibleIndex: number) {
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!direction) {
      return
    }
    event.preventDefault()
    const target = visibleItems[visibleIndex + direction]
    if (target) {
      void reorder(index, target.index, direction < 0 ? 'before' : 'after', true)
    }
  }

  function startDrag(event: DragEvent, index: number) {
    if (!canReorder || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    dragged = { index, content, hideCompleted: preferences.hideCompleted }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  function endDrag() {
    dragged = null
    dropTarget = null
  }

  function dragOver(event: DragEvent, index: number) {
    if (!activeDrag || activeDrag.index === index) {
      dropTarget = null
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const row = (event.currentTarget as HTMLLIElement).getBoundingClientRect()
    dropTarget = { index, placement: event.clientY < row.top + row.height / 2 ? 'before' : 'after' }
  }

  function dropItem(event: DragEvent, index: number) {
    if (!activeDrag || dropTarget?.index !== index) {
      endDrag()
      return
    }
    event.preventDefault()
    void reorder(activeDrag.index, index, dropTarget.placement)
    endDrag()
  }
</script>

<div class='todo-editor'>
  {#if items.length}
    <div class='todo-controls'>
      <label class='sort-control'>
        <span>{t('desktopNotes.todo.sort')}</span>
        <select
          value={preferences.sort}
          onchange={event => changePreferences({ sort: event.currentTarget.value as DesktopNoteTodoSort })}
        >
          {#each DESKTOP_NOTE_TODO_SORT_MODES as sort (sort)}
            <option value={sort}>{t(`desktopNotes.todo.sortModes.${sort}`)}</option>
          {/each}
        </select>
      </label>
      <label class='filter-control'>
        <input
          type='checkbox'
          checked={preferences.hideCompleted}
          onchange={event => changePreferences({ hideCompleted: event.currentTarget.checked })}
        />
        <span>{t('desktopNotes.todo.hideCompleted')}</span>
      </label>
    </div>

    {#if visibleItems.length}
      <ul class='todo-items' bind:this={listElement}>
        {#each visibleItems as { item, index }, visibleIndex (index)}
          <li
            class:completed={item.completed}
            class:dragged={activeDrag?.index === index}
            class:drop-before={activeDrag && dropTarget?.index === index && dropTarget.placement === 'before'}
            class:drop-after={activeDrag && dropTarget?.index === index && dropTarget.placement === 'after'}
            ondragover={event => dragOver(event, index)}
            ondrop={event => dropItem(event, index)}
          >
            <div class='todo-row'>
              {#if preferences.sort === 'manual'}
                <button
                  class='icon-button reorder'
                  type='button'
                  aria-label={t('desktopNotes.todo.reorder')}
                  aria-keyshortcuts='ArrowUp ArrowDown'
                  title={t('desktopNotes.todo.reorder')}
                  data-reorder-index={index}
                  draggable={canReorder}
                  disabled={!canReorder}
                  ondragstart={event => startDrag(event, index)}
                  ondragend={endDrag}
                  onkeydown={event => reorderByKeyboard(event, index, visibleIndex)}
                ><GripVertical aria-hidden='true' /></button>
              {/if}
              <input
                type='checkbox'
                aria-label={t('desktopNotes.todo.toggle')}
                checked={item.completed}
                onchange={event => updateItem(index, { completed: event.currentTarget.checked })}
              />
              <input
                class='todo-text'
                aria-label={t('desktopNotes.todo.edit')}
                title={item.text}
                value={item.text}
                oninput={event => updateItem(index, { text: event.currentTarget.value })}
              />
              <button
                class='icon-button metadata-toggle priority'
                type='button'
                aria-label={t('desktopNotes.todo.priority')}
                title={item.priority ? t(`desktopNotes.todo.priorities.${item.priority}`) : t('desktopNotes.todo.priority')}
                data-priority={item.priority}
                data-metadata='priority'
                data-index={index}
                aria-expanded={expanded?.index === index && expanded.field === 'priority'}
                aria-controls={`${editorId}-details-${index}`}
                onclick={event => toggleMetadata(index, 'priority', event)}
              ><Flag aria-hidden='true' /></button>
              <button
                class='icon-button metadata-toggle deadline'
                type='button'
                aria-label={t('desktopNotes.todo.deadline')}
                title={item.deadline ? dateFormatter.format(new Date(item.deadline)) : t('desktopNotes.todo.deadline')}
                data-metadata='deadline'
                data-index={index}
                aria-expanded={expanded?.index === index && expanded.field === 'deadline'}
                aria-controls={`${editorId}-details-${index}`}
                onclick={event => toggleMetadata(index, 'deadline', event)}
              ><CalendarDays aria-hidden='true' /></button>
              <button
                class='icon-button remove'
                type='button'
                aria-label={t('desktopNotes.todo.remove')}
                title={t('desktopNotes.todo.remove')}
                onclick={() => removeItem(index)}
              ><X aria-hidden='true' /></button>
            </div>
            {#if expanded?.index !== index && (item.priority || item.deadline)}
              <div class='todo-metadata'>
                {#if item.priority}
                  <button class='metadata-summary priority' type='button' data-priority={item.priority} onclick={event => toggleMetadata(index, 'priority', event)}>
                    {t(`desktopNotes.todo.priorities.${item.priority}`)}
                  </button>
                {/if}
                {#if item.deadline}
                  <button class='metadata-summary' type='button' onclick={event => toggleMetadata(index, 'deadline', event)}>
                    <time datetime={item.deadline}>{dateFormatter.format(new Date(item.deadline))}</time>
                  </button>
                {/if}
              </div>
            {/if}
            <div id={`${editorId}-details-${index}`} hidden={expanded?.index !== index}>
              {#if expanded?.index === index}
                <div class='todo-details'>
                  {#if expanded.field === 'priority'}
                    <label>
                      <span>{t('desktopNotes.todo.priority')}</span>
                      <select
                        bind:this={metadataInput}
                        value={item.priority ?? ''}
                        onkeydown={event => closeMetadata(event, index, 'priority')}
                        onchange={event => updateMetadata(index, 'priority', event.currentTarget.value)}
                      >
                        <option value=''>{t('desktopNotes.todo.priorities.none')}</option>
                        {#each DESKTOP_NOTE_TODO_PRIORITIES as priority (priority)}
                          <option value={priority}>{t(`desktopNotes.todo.priorities.${priority}`)}</option>
                        {/each}
                      </select>
                    </label>
                  {:else}
                    <label>
                      <span>{t('desktopNotes.todo.deadline')}</span>
                      <input
                        type='date'
                        bind:this={metadataInput}
                        value={item.deadline ?? ''}
                        onkeydown={event => closeMetadata(event, index, 'deadline')}
                        onchange={event => updateMetadata(index, 'deadline', event.currentTarget.value)}
                      />
                    </label>
                    {#if item.deadline}
                      <button
                        class='icon-button'
                        type='button'
                        aria-label={t('desktopNotes.todo.clearDeadline')}
                        title={t('desktopNotes.todo.clearDeadline')}
                        onclick={() => updateMetadata(index, 'deadline', '')}
                      ><X aria-hidden='true' /></button>
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <form class='todo-add' onsubmit={addItem}>
    <input
      class='todo-text'
      aria-label={t('desktopNotes.todo.placeholder')}
      placeholder={t('desktopNotes.todo.placeholder')}
      bind:this={newItemInput}
      bind:value={draft}
    />
    <button type='submit' disabled={!draft.trim()}>{t('desktopNotes.todo.add')}</button>
  </form>
</div>

<style>
  .todo-editor {
    padding: 0.5rem;
    overflow: auto;
    min-height: 0;
    color: var(--note-text);
  }

  .todo-items {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
  }

  .todo-row,
  .todo-add {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .todo-items li + li {
    margin-top: 0.25rem;
  }

  .todo-items li {
    position: relative;
    border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 22%, transparent);
  }

  .todo-items li.dragged {
    opacity: 0.55;
  }

  .todo-items li.drop-before::before,
  .todo-items li.drop-after::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    height: 0.13rem;
    background: var(--note-accent);
  }

  .todo-items li.drop-before::before {
    top: 0;
  }

  .todo-items li.drop-after::after {
    bottom: 0;
  }

  .todo-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.35rem;
    font-size: 0.75rem;
  }

  .todo-controls label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .sort-control {
    min-width: 0;
  }

  .filter-control {
    white-space: nowrap;
  }

  .filter-control input {
    margin: 0;
  }

  .todo-row {
    gap: 0.2rem;
  }

  .todo-row input[type='checkbox'] {
    margin-inline: 0.1rem;
  }

  .todo-text {
    flex: 1;
    min-width: 0;
    min-height: 1.8rem;
    box-sizing: border-box;
    padding: 0.25rem;
    color: inherit;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    font: inherit;
  }

  .todo-add .todo-text,
  .todo-add button {
    border-color: color-mix(in srgb, var(--note-accent) 45%, transparent);
  }

  .todo-text::placeholder {
    color: color-mix(in srgb, var(--note-text) 65%, transparent);
  }

  .completed .todo-text {
    color: color-mix(in srgb, var(--note-text) 72%, transparent);
    text-decoration: line-through;
  }

  input[type='checkbox'] {
    accent-color: var(--note-accent);
  }

  button {
    min-height: 1.8rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    color: inherit;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  button:enabled:hover {
    background: color-mix(in srgb, var(--note-accent) 14%, transparent);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .todo-text:focus-visible,
  .todo-controls select:focus-visible,
  .todo-details select:focus-visible,
  .todo-details input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--note-accent);
    outline-offset: -1px;
  }

  .icon-button {
    display: grid;
    flex: 0 0 1.45rem;
    place-items: center;
    padding: 0;
  }

  .icon-button :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }

  .reorder:enabled {
    cursor: grab;
  }

  .dragged .reorder {
    cursor: grabbing;
  }

  .metadata-toggle[aria-expanded='true'] {
    background: color-mix(in srgb, var(--note-accent) 24%, transparent);
  }

  .todo-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.6rem;
    margin: 0 0 0.25rem 1.35rem;
    font-size: 0.75rem;
  }

  .metadata-summary {
    min-height: 1.25rem;
    padding: 0.05rem 0.25rem;
  }

  .priority[data-priority='high'] {
    color: color-mix(in srgb, var(--error-color) 55%, var(--note-text));
    font-weight: 600;
  }

  .todo-details {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.35rem;
    margin: 0 0 0.4rem 1.35rem;
    padding: 0.35rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--note-accent) 10%, transparent);
  }

  .todo-details label {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    font-size: 0.75rem;
  }

  .todo-controls select,
  .todo-details select,
  .todo-details input {
    box-sizing: border-box;
    width: 100%;
    min-height: 1.8rem;
    padding: 0.15rem;
    border: 1px solid color-mix(in srgb, var(--note-accent) 50%, transparent);
    border-radius: 0.25rem;
    background: var(--note-bg);
    color: inherit;
    color-scheme: light;
    font: inherit;
  }

  .todo-controls select {
    width: auto;
    min-height: 1.45rem;
    max-width: 100%;
  }
</style>
