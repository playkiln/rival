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

/** The save-document shape, for when storage lands. Not written anywhere yet. */
export function serialiseProgress(p: Progress): { v: 1; bestMs: number | null; ghost: string | null; medals: MedalKey[] } {
  return { v: 1, bestMs: p.bestMs, ghost: p.best ? encodeLap(p.best) : null, medals: [...p.medals] }
}
