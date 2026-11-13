import type { GLOBAL_SHORTCUT_SETTINGS } from '../utils/constants'

export type ShortcutKind = typeof GLOBAL_SHORTCUT_SETTINGS[number]['kind']
export type ShortcutFailure = 'invalid' | 'duplicate' | 'unavailable' | 'failed'

export interface ShortcutStatus {
  kind: ShortcutKind
  accelerator: string
  failure: ShortcutFailure | null
}
