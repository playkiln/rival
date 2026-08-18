/**
 * The medal ladder and the player's best — one plain object, kept in the
 * shape a future save document can serialise whole (DESIGN.md §13). Until
 * saves exist it lives for the visit.
 */
import { MEDAL_GHOSTS, type MedalKey } from './ghosts'
import { decodeLap, encodeLap, type LapRecording } from './sim/recording'

export const MEDAL_ORDER: MedalKey[] = ['bronze', 'silver', 'gold']

export type Progress = {
  bestMs: number | null
  best: LapRecording | null
  medals: MedalKey[]
}

export type Rival =
  | { kind: 'medal'; medal: MedalKey; ms: number; lap: LapRecording }
  | { kind: 'best'; ms: number; lap: LapRecording }

export function createProgress(): Progress {
  return { bestMs: null, best: null, medals: [] }
}

const decoded: Partial<Record<MedalKey, LapRecording>> = {}
function medalLap(key: MedalKey): LapRecording {
  return (decoded[key] ??= decodeLap(MEDAL_GHOSTS[key].lap))
}

/** Which ghost the next lap races: the next unbeaten medal, or your own best once gold is beaten. */
export function rivalFor(p: Progress): Rival {
  for (const key of MEDAL_ORDER) {
    if (!p.medals.includes(key)) return { kind: 'medal', medal: key, ms: MEDAL_GHOSTS[key].ms, lap: medalLap(key) }
  }
  // Gold beaten: race yourself. bestMs/best are set the moment gold is earned.
  return { kind: 'best', ms: p.bestMs as number, lap: p.best as LapRecording }
}

export type LapOutcome = {
  newBest: boolean
  /** Medals earned on this lap, in order. */
  earned: MedalKey[]
}

/** Record a valid lap; returns what changed so the end screen can say it. */
export function applyLap(p: Progress, ms: number, lap: LapRecording): LapOutcome {
  const earned: MedalKey[] = []
  for (const key of MEDAL_ORDER) {
    if (!p.medals.includes(key) && ms < MEDAL_GHOSTS[key].ms) {
      p.medals.push(key)
      earned.push(key)
    }
  }
  const newBest = p.bestMs === null || ms < p.bestMs
  if (newBest) {
    p.bestMs = ms
    p.best = lap
  }
  return { newBest, earned }
}

/** Rival's own save-document format version. This is not the protocol version. */
export const SAVE_FORMAT_VERSION = 1

export type SaveDocument = {
  v: typeof SAVE_FORMAT_VERSION
  bestMs: number | null
  ghost: string | null
  medals: MedalKey[]
}

/** The save document, as one JSON object for the single opaque storage slot. */
export function serialiseProgress(p: Progress): SaveDocument {
  return { v: SAVE_FORMAT_VERSION, bestMs: p.bestMs, ghost: p.best ? encodeLap(p.best) : null, medals: [...p.medals] }
}

/**
 * Parse a save document. Anything that is not a well-formed v1 document —
 * bad JSON, unknown version, a ghost that will not decode, an inconsistent
 * medal/best pair — yields `null`, and the caller treats the save as absent.
 * A corrupt save must never break the game; the next personal best overwrites it.
 */
export function parseProgress(text: string): Progress | null {
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null) return null
    const doc = raw as Record<string, unknown>
    if (doc.v !== SAVE_FORMAT_VERSION) return null
    const listed = Array.isArray(doc.medals) ? (doc.medals as unknown[]) : []
    const medals = MEDAL_ORDER.filter((m) => listed.includes(m))
    const bestMs =
      typeof doc.bestMs === 'number' && Number.isFinite(doc.bestMs) && doc.bestMs > 0 ? Math.round(doc.bestMs) : null
    const best = typeof doc.ghost === 'string' && bestMs !== null ? decodeLap(doc.ghost) : null
    // A time without its lap cannot be raced; a lap without a time means nothing.
    if ((bestMs === null) !== (best === null)) return null
    // Once gold is beaten the player races their own best, so it must exist.
    if (medals.length === MEDAL_ORDER.length && best === null) return null
    return { bestMs, best, medals }
  } catch {
    return null
  }
}
