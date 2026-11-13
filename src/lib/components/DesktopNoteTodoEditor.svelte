<script lang='ts'>
  import type { DesktopNoteTodo } from '$lib/utils/desktop-note-todo'
  import { i18n } from '$lib/i18n'
  import { configStore } from '$lib/stores/config.svelte'
  import { DESKTOP_NOTE_TODO_PRIORITIES } from '$lib/utils/constants'
  import { parseDesktopNoteTodos, serializeDesktopNoteTodos } from '$lib/utils/desktop-note-todo'
  import { CalendarDays, ChevronDown, Flag, X } from '@lucide/svelte'

  type Props = {
    content: string
    onChange: (content: string) => void
  }

  const { content, onChange }: Props = $props()
  const t = i18n.t
  const editorId = $props.id()

  let draft = $state('')
  let newItemInput: HTMLInputElement
  let expandedIndex = $state<number | null>(null)
  const items = $derived(parseDesktopNoteTodos(content))
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
    if (expandedIndex === index) {
      expandedIndex = null
    }
    else if (expandedIndex !== null && expandedIndex > index) {
      expandedIndex -= 1
    }
    onChange(serializeDesktopNoteTodos(items.filter((_item, position) => position !== index)))
  }
</script>

<div class='todo-editor'>
  {#if items.length}
    <ul class='todo-items'>
      {#each items as item, index (index)}
        <li class:completed={item.completed}>
          <div class='todo-row'>
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
              class='icon-button details-toggle'
              type='button'
              aria-label={t('desktopNotes.todo.details')}
              title={t('desktopNotes.todo.details')}
              aria-expanded={expandedIndex === index}
              aria-controls={`${editorId}-details-${index}`}
              onclick={() => { expandedIndex = expandedIndex === index ? null : index }}
            ><ChevronDown aria-hidden='true' /></button>
            <button
              class='icon-button remove'
              type='button'
              aria-label={t('desktopNotes.todo.remove')}
              title={t('desktopNotes.todo.remove')}
              onclick={() => removeItem(index)}
            ><X aria-hidden='true' /></button>
          </div>
          {#if expandedIndex !== index && (item.priority || item.deadline)}
            <div class='todo-metadata'>
              {#if item.priority}
                <span class='priority' data-priority={item.priority}>
                  <Flag aria-hidden='true' />
                  {t(`desktopNotes.todo.priorities.${item.priority}`)}
                </span>
              {/if}
              {#if item.deadline}
                <span class='deadline' title={t('desktopNotes.todo.deadline')}>
                  <CalendarDays aria-hidden='true' />
                  <time datetime={item.deadline}>{dateFormatter.format(new Date(item.deadline))}</time>
                </span>
              {/if}
            </div>
          {/if}
          <div id={`${editorId}-details-${index}`} hidden={expandedIndex !== index}>
            {#if expandedIndex === index}
              <div class='todo-details'>
                <label>
                  <span>{t('desktopNotes.todo.priority')}</span>
                  <select
                    value={item.priority ?? ''}
                    onchange={event => updateItem(index, {
                      priority: DESKTOP_NOTE_TODO_PRIORITIES.find(priority => priority === event.currentTarget.value),
                    })}
                  >
                    <option value=''>{t('desktopNotes.todo.priorities.none')}</option>
                    {#each DESKTOP_NOTE_TODO_PRIORITIES as priority (priority)}
                      <option value={priority}>{t(`desktopNotes.todo.priorities.${priority}`)}</option>
                    {/each}
                  </select>
                </label>
                <div class='deadline-field'>
                  <label>
                    <span>{t('desktopNotes.todo.deadline')}</span>
                    <input
                      type='date'
                      value={item.deadline ?? ''}
                      onchange={event => updateItem(index, { deadline: event.currentTarget.value || undefined })}
                    />
                  </label>
                  {#if item.deadline}
                    <button
                      class='icon-button'
                      type='button'
                      aria-label={t('desktopNotes.todo.clearDeadline')}
                      title={t('desktopNotes.todo.clearDeadline')}
                      onclick={() => updateItem(index, { deadline: undefined })}
                    ><X aria-hidden='true' /></button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
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
    border-bottom: 1px solid color-mix(in srgb, var(--note-accent) 22%, transparent);
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
  .todo-details select:focus-visible,
  .todo-details input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--note-accent);
    outline-offset: -1px;
  }

  .icon-button {
    display: grid;
    flex: 0 0 1.65rem;
    place-items: center;
    padding: 0;
  }

  .icon-button :global(svg),
  .todo-metadata :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }

  .details-toggle[aria-expanded='true'] :global(svg) {
    transform: rotate(180deg);
  }

  .todo-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.6rem;
    margin: 0 0 0.35rem 1.35rem;
    font-size: 0.75rem;
  }

  .todo-metadata span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
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

  .deadline-field {
    display: flex;
    flex: 2;
    align-items: end;
    min-width: 8.25rem;
  }
</style>
