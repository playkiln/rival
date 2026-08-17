/**
 * Lap tracking — plain math, driven by the Phaser scene each step.
 *
 * Checkpoints are arc-length positions along the centre-line; the finish line
 * is s = 0. A lap validates only if the car crosses each checkpoint in order,
 * within a reasonable distance of the surface, and then crosses the finish.
 * Crossing is detected on the car's track-relative position, so driving
 * across the infield cannot pass a checkpoint: it moves s in one large jump,
 * which is rejected, and it happens far from the surface, which is rejected.
 */
import { lapDelta, type Track } from './track'

export type LapEvent =
  | { type: 'checkpoint'; index: number }
  | { type: 'lap'; valid: boolean; frames: number }

export type LapState = {
  /** Index of the next checkpoint expected; === checkpoints.length means "the finish". */
  next: number
  /** Whether the current lap has already been invalidated. */
  valid: boolean
  /** Fixed-step frame index the current lap began on. */
  startFrame: number
  /** Arc-length position at the previous step. */
  prevS: number
  /** Frames elapsed so far this lap (updated per step). */
  frames: number
  /** The first crossing of the finish starts timing; before it we are on the grid. */
  armed: boolean
}

export function createLap(startS: number): LapState {
  return { next: 0, valid: true, startFrame: 0, prevS: startS, frames: 0, armed: false }
}

/** Largest believable advance in one step; anything bigger is a cut, not a crossing. */
function maxStepAdvance(track: Track, speed: number, dt: number): number {
  return Math.max(speed * dt * 4, track.halfWidth)
}

export function stepLap(
  lap: LapState,
  track: Track,
  s: number,
  distFromCentre: number,
  frame: number,
  speed: number,
  dt: number,
): LapEvent[] {
  const events: LapEvent[] = []
  const advance = lapDelta(track, lap.prevS, s)
  const plausible =
    Math.abs(advance) <= maxStepAdvance(track, speed, dt) &&
    distFromCentre <= track.halfWidth * 2.5

  const crossed = (mark: number): boolean => {
    if (!plausible || advance <= 0) return false
    // Did the forward interval [prevS, s] contain `mark`?
    const toMark = lapDelta(track, lap.prevS, mark)
    return toMark > 0 && toMark <= advance
  }

  const cps = track.checkpointS
  if (lap.next < cps.length && crossed(cps[lap.next])) {
    events.push({ type: 'checkpoint', index: lap.next })
    lap.next += 1
  } else if (crossed(0)) {
    if (lap.armed) {
      const valid = lap.valid && lap.next === cps.length
      events.push({ type: 'lap', valid, frames: frame - lap.startFrame })
    }
    lap.armed = true
    lap.startFrame = frame
    lap.next = 0
    lap.valid = true
  } else if (advance > 0 && plausible) {
    // Passing a later checkpoint before the expected one means a section was
    // skipped: mark the lap invalid rather than silently waiting forever.
    for (let i = lap.next + 1; i < cps.length; i++) {
      if (crossed(cps[i])) lap.valid = false
    }
  }

  lap.prevS = s
  lap.frames = lap.armed ? frame - lap.startFrame : 0
  return events
}
