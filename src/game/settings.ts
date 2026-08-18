/**
 * Player preferences — the things that never touch what a lap time means.
 *
 * Music and sound each have an on/off and a volume, because "on but quiet" is
 * a real request and "off" is a different one. Volumes step in fifths so one
 * cycling button covers them on touch without any drag handling.
 *
 * Preferences ride inside the save document (progress.ts) rather than in
 * localStorage: the platform gives Rival exactly one document, and a
 * signed-in player expects their settings to follow their best lap.
 */

export interface Preferences {
  musicEnabled: boolean
  /** 0..1 in steps of 0.2. */
  musicVolume: number
  soundEnabled: boolean
  soundVolume: number
}

export const DEFAULT_PREFERENCES: Preferences = {
  musicEnabled: true,
  musicVolume: 0.6,
  soundEnabled: true,
  soundVolume: 0.8,
}

/** Cycle a volume through 20 → 40 → … → 100 → 20 (%). Zero is what "off" is for. */
export function nextVolume(volume: number): number {
  const step = Math.round(volume * 5) // 0..5
  return (step >= 5 ? 1 : step + 1) / 5
}

export function volumeLabel(volume: number): string {
  return `${Math.round(volume * 100)}%`
}

/** Coerce an untrusted stored value to valid preferences. Absent ⇒ defaults. */
export function sanitizePreferences(raw: unknown): Preferences {
  const out: Preferences = { ...DEFAULT_PREFERENCES }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.musicEnabled === 'boolean') out.musicEnabled = r.musicEnabled
    if (typeof r.soundEnabled === 'boolean') out.soundEnabled = r.soundEnabled
    if (typeof r.musicVolume === 'number' && Number.isFinite(r.musicVolume)) {
      out.musicVolume = clampVolume(r.musicVolume)
    }
    if (typeof r.soundVolume === 'number' && Number.isFinite(r.soundVolume)) {
      out.soundVolume = clampVolume(r.soundVolume)
    }
  }
  return out
}

function clampVolume(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 5) / 5
}
