<script lang='ts'>
  import type { DesktopNoteTodo, DesktopNoteTodoPreferences } from '$lib/utils/desktop-note-todo'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import {
    DEFAULT_DESKTOP_NOTE_TODO_PREFERENCES,
    DESKTOP_NOTE_TODO_PRIORITIES,
    DESKTOP_NOTE_TODO_SORT_MODES,
  } from '$lib/utils/constants'
  import {
    canInsertDesktopNoteSubtask,
    getDesktopNoteTodoParentIndex,
    getDesktopNoteTodoSiblingIndex,
    getVisibleDesktopNoteTodos,
    insertDesktopNoteSubtask,
    moveDesktopNoteTodo,
    parseDesktopNoteTodos,
    removeDesktopNoteTodo,
    serializeDesktopNoteTodos,
  } from '$lib/utils/desktop-note-todo'
  import { CalendarDays, Check, Flag, GripVertical, ListPlus, X } from '@lucide/svelte'
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
  let childDraft = $state('')
  let editing = $state(false)
  let addChildTo = $state<number | null>(null)
  let viewEditButton = $state<HTMLButtonElement>()
  let newItemInput = $state<HTMLInputElement>()
  let childInput = $state<HTMLInputElement>()
  let listElement = $state<HTMLUListElement>()
  let dateInput = $state<HTMLInputElement>()
  let expanded = $state<{ index: number, field: MetadataField } | null>(null)
  let dragged = $state<{ index: number, content: string, hideCompleted: boolean } | null>(null)
  let dropTarget = $state<{ index: number, placement: Placement } | null>(null)
  const items = $derived(parseDesktopNoteTodos(content).map((item, id) => ({ ...item, id })))
  const visibleItems = $derived(getVisibleDesktopNoteTodos(items, preferences))
  const visibleIndices = $derived(new Set(visibleItems.map(({ index }) => index)))
  const canReorder = $derived(editing && preferences.sort === 'manual' && visibleItems.length > 1)
  const priorityChoices = [undefined, ...DESKTOP_NOTE_TODO_PRIORITIES] as const
  const activeDrag = $derived(
    canReorder && dragged?.content === content && dragged.hideCompleted === preferences.hideCompleted
      ? dragged
      : null,
  )
  const dateFormatter = $derived(new Intl.DateTimeFormat(configStore.config.locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }))

  async function toggleEditing() {
    editing = !editing
    expanded = null
    addChildTo = null
    childDraft = ''
    endDrag()
    await tick()
    if (editing) {
      newItemInput?.focus()
    }
    else {
      viewEditButton?.focus()
    }
  }

  function enterEditOnDoubleClick(event: MouseEvent) {
    if (!editing && event.target instanceof Element
      && !event.target.closest('input, label, button, a, select, textarea, [contenteditable]')) {
      void toggleEditing()
    }
  }

  function handleViewShortcut(event: KeyboardEvent) {
    if (event.key === 'F2') {
      event.preventDefault()
      void toggleEditing()
    }
  }

  function addItem(event: KeyboardEvent, parentIndex?: number) {
    if (event.key !== 'Enter' || event.isComposing) {
      return
    }
    event.preventDefault()
    const text = (parentIndex === undefined ? draft : childDraft).trim()
    if (!text) {
      return
    }
    const item = { text, completed: false, id: items.length }
    if (parentIndex === undefined) {
      onChange(serializeDesktopNoteTodos([...items, item]))
      draft = ''
    }
    else {
      const nextItems = insertDesktopNoteSubtask(items, parentIndex, item)
      if (nextItems !== items) {
        onChange(serializeDesktopNoteTodos(nextItems))
        childDraft = ''
      }
    }
  }

  async function openChildInput(index: number) {
    const wasOpen = addChildTo === index
    expanded = null
    addChildTo = wasOpen ? null : index
    childDraft = ''
    if (!wasOpen) {
      await tick()
      childInput?.focus()
    }
  }

  function handleChildInputKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'Escape') {
      addChildTo = null
      childDraft = ''
      listElement?.querySelector<HTMLButtonElement>(`[data-add-child="${index}"]`)?.focus()
      return
    }
    addItem(event, index)
  }

  function updateItem(index: number, updates: Partial<DesktopNoteTodo>) {
    onChange(serializeDesktopNoteTodos(items.map((item, position) =>
      position === index ? { ...item, ...updates } : item,
    )))
  }

  function removeItem(index: number) {
    expanded = null
    addChildTo = null
    onChange(serializeDesktopNoteTodos(removeDesktopNoteTodo(items, index)))
  }

  function changePreferences(updates: Partial<DesktopNoteTodoPreferences>) {
    expanded = null
    addChildTo = null
    endDrag()
    onPreferencesChange?.({ ...preferences, ...updates })
  }

  async function toggleMetadata(index: number, field: MetadataField, event?: MouseEvent) {
    if (expanded?.index === index && expanded.field === field) {
      expanded = null
      return
    }
    expanded = { index, field }
    await tick()
    if (field === 'deadline') {
      dateInput?.focus()
      if (event?.isTrusted && event.detail > 0) {
        showDatePicker()
      }
    }
    else {
      listElement?.querySelector<HTMLButtonElement>('.priority-options button[aria-pressed="true"]')?.focus()
    }
  }

  function showDatePicker() {
    dateInput?.focus()
    try {
      dateInput?.showPicker()
    }
    catch {
      // The focused date field remains usable when the system picker is unavailable.
    }
  }

  function closeMetadata(event: KeyboardEvent, index: number, field: MetadataField) {
    if (event.key === 'Escape') {
      expanded = null
      focusMetadata(index, field)
    }
  }

  function closeMetadataOnBlur(event: FocusEvent) {
    const nextFocus = event.relatedTarget
    if (!(nextFocus instanceof HTMLElement)
      || !(event.currentTarget instanceof HTMLElement)
      || event.currentTarget.contains(nextFocus)) {
      return
    }
    const sameTrigger = nextFocus.dataset.metadata === expanded?.field
      && nextFocus.dataset.index === String(expanded?.index)
    if (!sameTrigger) {
      expanded = null
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
    addChildTo = null
    onChange(serializeDesktopNoteTodos(reordered))
    if (restoreFocus) {
      const index = reordered.findIndex(item => item.id === from)
      await tick()
      listElement?.querySelector<HTMLButtonElement>(`[data-reorder-index="${index}"]`)?.focus()
    }
  }

  function reorderByKeyboard(event: KeyboardEvent, index: number) {
    const direction = event.key === 'ArrowUp' ? 'previous' : event.key === 'ArrowDown' ? 'next' : null
    if (!direction) {
      return
    }
    event.preventDefault()
    let target = getDesktopNoteTodoSiblingIndex(items, index, direction)
    while (target !== null && !visibleIndices.has(target)) {
      target = getDesktopNoteTodoSiblingIndex(items, target, direction)
    }
    if (target !== null) {
      void reorder(index, target, direction === 'previous' ? 'before' : 'after', true)
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
    if (!activeDrag || activeDrag.index === index
      || getDesktopNoteTodoParentIndex(items, activeDrag.index) !== getDesktopNoteTodoParentIndex(items, index)) {
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

<div class='todo-editor' role='group' aria-label={t('desktopNotes.todo.label')} data-editing={editing} ondblclick={enterEditOnDoubleClick}>
  {#if editing}
    <div class='todo-controls'>
      <div class='display-options'>
        {#if items.length}
          <label class='sort-control'>
            <span>{t('desktopNotes.todo.sort')}</span>
            <select
              value={preferences.sort}
              onchange={event => changePreferences({
                sort: DESKTOP_NOTE_TODO_SORT_MODES.find(mode => mode === event.currentTarget.value) ?? preferences.sort,
              })}
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
        {/if}
      </div>
      <button
        class='icon-button edit-toggle'
        type='button'
        aria-label={t('desktopNotes.todo.finishEditing')}
        title={t('desktopNotes.todo.finishEditing')}
        onclick={toggleEditing}
      ><Check aria-hidden='true' /></button>
    </div>
  {:else}
    <button
      class='view-edit-shortcut'
      type='button'
      aria-keyshortcuts='Enter F2'
      bind:this={viewEditButton}
      onclick={toggleEditing}
      onkeydown={handleViewShortcut}
    >{t('desktopNotes.todo.editList')}</button>
  {/if}

  {#if visibleItems.length}
    <ul class='todo-items' class:editing bind:this={listElement}>
      {#each visibleItems as { item, index, depth } (index)}
        {@const canAddChild = editing && canInsertDesktopNoteSubtask(items, index)}
        <li
          class:completed={item.completed}
          class:dragged={activeDrag?.index === index}
          class:drop-before={activeDrag && dropTarget?.index === index && dropTarget.placement === 'before'}
          class:drop-after={activeDrag && dropTarget?.index === index && dropTarget.placement === 'after'}
          style:--task-depth={depth}
          data-task-depth={depth}
          ondragover={event => dragOver(event, index)}
          ondrop={event => dropItem(event, index)}
        >
          <div class='todo-row'>
            {#if editing && preferences.sort === 'manual'}
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
                onkeydown={event => reorderByKeyboard(event, index)}
              ><GripVertical aria-hidden='true' /></button>
            {/if}
            <input
              type='checkbox'
              aria-label={t('desktopNotes.todo.toggle')}
              title={item.text}
              checked={item.completed}
              onchange={event => updateItem(index, { completed: event.currentTarget.checked })}
            />
            {#if editing}
              <input
                class='todo-text'
                aria-label={t('desktopNotes.todo.edit')}
                title={item.text}
                value={item.text}
                oninput={event => updateItem(index, { text: event.currentTarget.value })}
              />
              {#if canAddChild}
                <button
                  class='icon-button'
                  type='button'
                  aria-label={t('desktopNotes.todo.addChild')}
                  title={t('desktopNotes.todo.addChild')}
                  aria-expanded={addChildTo === index}
                  data-add-child={index}
                  onclick={() => openChildInput(index)}
                ><ListPlus aria-hidden='true' /></button>
              {/if}
              <button
                class='icon-button remove'
                type='button'
                aria-label={t('desktopNotes.todo.remove')}
                title={t('desktopNotes.todo.remove')}
                onclick={() => removeItem(index)}
              ><X aria-hidden='true' /></button>
            {:else}
              <span class='todo-text' title={item.text}>{item.text}</span>
            {/if}
          </div>
          {#if editing || item.priority || item.deadline}
            <div class='todo-metadata'>
              {#if editing}
                <button
                  class='metadata-toggle priority'
                  type='button'
                  aria-label={t('desktopNotes.todo.priority')}
                  title={t('desktopNotes.todo.priority')}
                  data-priority={item.priority}
                  data-metadata='priority'
                  data-index={index}
                  aria-expanded={expanded?.index === index && expanded.field === 'priority'}
                  aria-controls={`${editorId}-details-${index}`}
                  onclick={() => toggleMetadata(index, 'priority')}
                >
                  <Flag aria-hidden='true' />
                  {#if item.priority}
                    {t(`desktopNotes.todo.priorities.${item.priority}`)}
                  {/if}
                </button>
                <button
                  class='metadata-toggle'
                  type='button'
                  aria-label={t('desktopNotes.todo.deadline')}
                  title={t('desktopNotes.todo.deadline')}
                  data-metadata='deadline'
                  data-index={index}
                  aria-expanded={expanded?.index === index && expanded.field === 'deadline'}
                  aria-controls={`${editorId}-details-${index}`}
                  onclick={event => toggleMetadata(index, 'deadline', event)}
                >
                  <CalendarDays aria-hidden='true' />
                  {#if item.deadline}
                    <time datetime={item.deadline}>{dateFormatter.format(new Date(item.deadline))}</time>
                  {/if}
                </button>
              {:else}
                {#if item.priority}
                  <span class='metadata-toggle priority' data-priority={item.priority} title={t('desktopNotes.todo.priority')}>
                    <Flag aria-hidden='true' />
                    {t(`desktopNotes.todo.priorities.${item.priority}`)}
                  </span>
                {/if}
                {#if item.deadline}
                  <span class='metadata-toggle' title={t('desktopNotes.todo.deadline')}>
                    <CalendarDays aria-hidden='true' />
                    <time datetime={item.deadline}>{dateFormatter.format(new Date(item.deadline))}</time>
                  </span>
                {/if}
              {/if}
            </div>
          {/if}
          {#if editing}
            <div
              id={`${editorId}-details-${index}`}
              hidden={expanded?.index !== index}
              onfocusout={closeMetadataOnBlur}
            >
              {#if expanded?.index === index}
                {#if expanded.field === 'priority'}
                  <div class='todo-details priority-options' role='group' aria-label={t('desktopNotes.todo.priority')}>
                    {#each priorityChoices as priority (priority)}
                      <button
                        type='button'
                        data-priority={priority}
                        aria-pressed={item.priority === priority}
                        onkeydown={event => closeMetadata(event, index, 'priority')}
                        onclick={() => updateMetadata(index, 'priority', priority ?? '')}
                      >{t(`desktopNotes.todo.priorities.${priority ?? 'none'}`)}</button>
                    {/each}
                  </div>
                {:else}
                  <div class='todo-details'>
                    <input
                      type='date'
                      aria-label={t('desktopNotes.todo.deadline')}
                      bind:this={dateInput}
                      value={item.deadline ?? ''}
                      onkeydown={event => closeMetadata(event, index, 'deadline')}
                      onchange={event => updateMetadata(index, 'deadline', event.currentTarget.value)}
                    />
                    <button
                      class='icon-button'
                      type='button'
                      aria-label={t('desktopNotes.todo.openCalendar')}
                      title={t('desktopNotes.todo.openCalendar')}
                      onclick={showDatePicker}
                    ><CalendarDays aria-hidden='true' /></button>
                    {#if item.deadline}
                      <button
                        class='icon-button'
                        type='button'
                        aria-label={t('desktopNotes.todo.clearDeadline')}
                        title={t('desktopNotes.todo.clearDeadline')}
                        onclick={() => updateMetadata(index, 'deadline', '')}
                      ><X aria-hidden='true' /></button>
                    {/if}
                  </div>
                {/if}
              {/if}
            </div>
            {#if addChildTo === index}
              <input
                class='todo-text todo-add child-add'
                aria-label={t('desktopNotes.todo.childPlaceholder')}
                placeholder={t('desktopNotes.todo.childPlaceholder')}
                bind:this={childInput}
                bind:value={childDraft}
                onkeydown={event => handleChildInputKeydown(event, index)}
              />
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {:else if !editing}
    <p class='empty-tasks'>{t('desktopNotes.todo.viewEmpty')}</p>
  {/if}
  {#if editing}
    <input
      class='todo-text todo-add'
      aria-label={t('desktopNotes.todo.placeholder')}
      placeholder={t('desktopNotes.todo.placeholder')}
      bind:this={newItemInput}
      bind:value={draft}
      onkeydown={addItem}
    />
  {/if}
</div>

<style>
  .todo-editor {
    position: relative;
    flex: 1;
    padding: 0.5rem;
    overflow: auto;
    min-height: 0;
    color: var(--note-text);
  }

  .view-edit-shortcut {
    position: absolute;
    width: 1px;
    height: 1px;
    min-height: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .todo-editor:has(.view-edit-shortcut:focus-visible) {
    outline: 2px solid var(--note-accent);
    outline-offset: -2px;
  }

  .todo-items {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
  }

  .todo-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .todo-items li + li {
    margin-top: 0.25rem;
  }

  .todo-items li {
    position: relative;
    margin-inline-start: calc(var(--task-depth) * 0.45rem);
    border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 22%, transparent);
  }

  .todo-items li:not([data-task-depth='0']) {
    padding-inline-start: 0.25rem;
    border-inline-start: 1px solid color-mix(in srgb, var(--note-accent) 48%, transparent);
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
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.35rem;
    font-size: 0.75rem;
  }

  .display-options {
    display: flex;
    flex-wrap: wrap;
    flex: 1;
    align-items: center;
    gap: 0.25rem 0.5rem;
    min-width: 0;
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

  span.todo-text {
    min-height: auto;
    overflow-wrap: anywhere;
  }

  .todo-add {
    width: 100%;
    border-color: color-mix(in srgb, var(--note-accent) 45%, transparent);
  }

  .child-add {
    width: calc(100% - 1.35rem);
    margin: 0 0 0.35rem 1.35rem;
  }

  .empty-tasks {
    color: color-mix(in srgb, var(--note-text) 70%, transparent);
    font-size: 0.875rem;
    text-align: center;
    margin: 1.35rem 0;
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

  .icon-button :global(svg),
  .metadata-toggle :global(svg) {
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
    gap: 0.15rem 0.25rem;
    margin: 0 0 0.25rem 1.35rem;
    font-size: 0.75rem;
  }

  .editing .todo-metadata {
    margin-inline-start: 1.55rem;
  }

  .metadata-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
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

  .todo-details input {
    flex: 1;
    min-width: 0;
  }

  .priority-options {
    align-items: center;
    gap: 0.2rem;
    font-size: 0.75rem;
  }

  .priority-options button {
    min-height: 1.5rem;
  }

  .priority-options button[aria-pressed='true'] {
    background: color-mix(in srgb, var(--note-accent) 24%, transparent);
  }

  .todo-controls select,
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

  .todo-details input::-webkit-calendar-picker-indicator {
    display: none;
  }

  .todo-controls select {
    width: auto;
    min-height: 1.45rem;
    max-width: 100%;
  }
</style>
