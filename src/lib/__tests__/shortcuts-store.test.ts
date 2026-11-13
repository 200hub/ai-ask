import { DEFAULT_CONFIG } from '$lib/types/config'
import { GLOBAL_SHORTCUT_COMMANDS } from '$lib/utils/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

let configStore: (typeof import('$lib/stores/config.svelte'))['configStore']

beforeEach(async () => {
  vi.resetModules()
  invoke.mockReset()
  configStore = (await import('$lib/stores/config.svelte')).configStore
  configStore.config = { ...DEFAULT_CONFIG }
})

describe('global shortcut settings', () => {
  it('reports conflicts detected during startup', async () => {
    const conflict = {
      kind: 'globalHotkey',
      accelerator: DEFAULT_CONFIG.globalHotkey,
      failure: 'unavailable',
    }
    invoke.mockResolvedValue([conflict, {
      kind: 'translationHotkey',
      accelerator: DEFAULT_CONFIG.translationHotkey,
      failure: null,
    }])

    expect(await configStore.refreshShortcuts()).toEqual([conflict])
    expect(invoke).toHaveBeenCalledWith(GLOBAL_SHORTCUT_COMMANDS.GET_STATUSES)
    expect(configStore.shortcutStatuses.globalHotkey).toEqual(conflict)
  })

  it('keeps the previous shortcut if the new combination is occupied', async () => {
    const accelerator = 'CommandOrControl+Shift+Q'
    invoke.mockRejectedValue('unavailable')

    await expect(configStore.setShortcut('globalHotkey', accelerator)).rejects.toBe('unavailable')
    expect(invoke).toHaveBeenCalledWith(GLOBAL_SHORTCUT_COMMANDS.SET, { kind: 'globalHotkey', accelerator })
    expect(configStore.config.globalHotkey).toBe(DEFAULT_CONFIG.globalHotkey)
    expect(configStore.shortcutStatuses.globalHotkey).toBeUndefined()
  })

  it('reflects a newly registered combination in configuration and status', async () => {
    const status = {
      kind: 'globalHotkey',
      accelerator: 'CommandOrControl+Shift+Q',
      failure: null,
    }
    invoke.mockResolvedValue(status)

    await configStore.setShortcut('globalHotkey', status.accelerator)
    expect(configStore.config.globalHotkey).toBe(status.accelerator)
    expect(configStore.shortcutStatuses.globalHotkey).toEqual(status)
  })
})
