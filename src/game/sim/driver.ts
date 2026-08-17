/**
 * A crude one-input driver for headless runs: aim at a point down the
 * centre-line, hold if it is on the hold side of the nose. Skill knobs make
 * it slower without making it look robotic — later decisions, a longer
 * look-ahead (rounds corners wide), and a lateral aim offset that wanders.
 */
import { createCar, stepCar, type CarParams, type CarState } from './car'
import { createLap, stepLap, type LapEvent } from './lap'
import { createRecorder, finishRecording, recordStep, type LapRecording } from './recording'
import { pointAt, type Track } from './track'

export type Skill = {
  /** How far down the road the driver aims, units. */
  look: number
  /** Re-decide the input only every N frames (reaction / hold quantisation). */
  every: number
  /** Amplitude of a slow lateral wander of the aim point, units. */
  wander: number
  /** Period of the wander, seconds. */
  wanderPeriod: number
}

export const STEP = 1 / 60

export function decide(car: CarState, track: Track, p: CarParams, skill: Skill, t: number): boolean {
  const target = pointAt(track, car.near.s + skill.look)
  const phase = ((t * STEP) / skill.wanderPeriod) * Math.PI * 2
  const off = Math.sin(phase) * skill.wander
  const tx = target.x - target.ty * off
  const ty = target.y + target.tx * off
  const cross = Math.cos(car.heading) * (ty - car.y) - Math.sin(car.heading) * (tx - car.x)
  return p.holdDirection === 1 ? cross > 0 : cross < 0
}

/**
 * Drive from the grid until the first valid lap completes; returns the
 * recording (frames since GO) and its length in frames, or null if it never
 * validated within the frame budget.
 */
export function driveRecordedLap(
  track: Track,
  p: CarParams,
  skill: Skill,
  maxFrames = 60 * 90,
): { lap: LapRecording; frames: number } | null {
  const car = createCar(track, p)
  const lapState = createLap(car.near.s)
  lapState.armed = true
  lapState.startFrame = 0
  const rec = createRecorder()
  let turning = false
  for (let t = 0; t < maxFrames; t++) {
    recordStep(rec, t, car.x, car.y, car.heading)
    if (t % skill.every === 0) turning = decide(car, track, p, skill, t)
    stepCar(car, p, track, turning, true, STEP)
    const events: LapEvent[] = stepLap(lapState, track, car.near.s, car.near.dist, t + 1, p.speed, STEP)
    for (const e of events) {
      if (e.type === 'lap' && e.valid) {
        return { lap: finishRecording(rec, t + 1, car.x, car.y, car.heading), frames: t + 1 }
      }
      if (e.type === 'lap' && !e.valid) return null
    }
  }
  return null
}
