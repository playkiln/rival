/**
 * The car model — plain math, stepped by the Phaser scene at a fixed 60 Hz.
 *
 * One input, `turning`. Speed is constant. What is tunable is how the turn
 * arrives (steer ramp), how much the velocity lags the nose (grip), and what
 * leaving the surface costs.
 */
import { nearestOnTrack, type NearestResult, type Track } from './track'

export type CarParams = {
  /** Cruising speed, world units per second. */
  speed: number
  /** Peak yaw rate at full steer, radians per second. */
  turnRate: number
  /**
   * Time constant of the steer ramp, seconds. Steer eases toward ±1 with
   * this τ, so a full swing takes roughly 3τ.
   */
  steerTau: number
  /**
   * Time constant of velocity chasing heading, seconds. 0 is a car on rails;
   * larger values let the nose lead the velocity — visible slip, more weight.
   */
  gripTau: number
  /** Speed multiplier once fully off the surface. */
  offTrackSpeed: number
  /** How quickly the speed multiplier eases when crossing the edge, seconds. */
  offTrackTau: number
  /** Which way holding turns: +1 or -1 (screen y is down, so -1 is anticlockwise on screen). */
  holdDirection: 1 | -1
}

export const DEFAULT_CAR: CarParams = {
  speed: 240,
  turnRate: 3.1,
  steerTau: 0.08,
  gripTau: 0.11,
  offTrackSpeed: 0.55,
  offTrackTau: 0.12,
  holdDirection: -1,
}

export type CarState = {
  x: number
  y: number
  /** Nose direction, radians. */
  heading: number
  /** Velocity, world units per second. */
  vx: number
  vy: number
  /** Current steer in [-1, 1]. */
  steer: number
  /** Current speed multiplier from surface. */
  speedScale: number
  /** True when the car is beyond the surface edge. */
  offTrack: boolean
  /** Track-relative position from the last step. */
  near: NearestResult
}

export function createCar(track: Track, p: CarParams): CarState {
  const { x, y, heading } = track.start
  return {
    x,
    y,
    heading,
    vx: Math.cos(heading) * p.speed,
    vy: Math.sin(heading) * p.speed,
    steer: 0,
    speedScale: 1,
    offTrack: false,
    near: nearestOnTrack(track, x, y),
  }
}

export function copyCar(from: CarState, to: CarState): void {
  to.x = from.x
  to.y = from.y
  to.heading = from.heading
  to.vx = from.vx
  to.vy = from.vy
  to.steer = from.steer
  to.speedScale = from.speedScale
  to.offTrack = from.offTrack
  to.near = from.near
}

/** Blend factor for an exponential ease with time constant tau over dt. */
function ease(tau: number, dt: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau)
}

/**
 * Advance the car by one fixed step. `moving` false holds the car still (the
 * countdown) while still letting the steer settle.
 */
export function stepCar(
  s: CarState,
  p: CarParams,
  track: Track,
  turning: boolean,
  moving: boolean,
  dt: number,
): void {
  const target = turning ? p.holdDirection : -p.holdDirection
  s.steer += (target - s.steer) * ease(p.steerTau, dt)

  if (!moving) return

  s.heading += s.steer * p.turnRate * dt

  // Surface: full speed on the tarmac, eased down beyond the edge.
  const wantScale = s.offTrack ? p.offTrackSpeed : 1
  s.speedScale += (wantScale - s.speedScale) * ease(p.offTrackTau, dt)
  const speed = p.speed * s.speedScale

  // Velocity chases the nose; magnitude is pinned to the constant speed so
  // slip changes direction, never pace.
  const hx = Math.cos(s.heading)
  const hy = Math.sin(s.heading)
  const g = ease(p.gripTau, dt)
  let vx = s.vx + (hx * speed - s.vx) * g
  let vy = s.vy + (hy * speed - s.vy) * g
  const vl = Math.hypot(vx, vy) || 1
  vx = (vx / vl) * speed
  vy = (vy / vl) * speed
  s.vx = vx
  s.vy = vy

  s.x += vx * dt
  s.y += vy * dt

  // Soft world bounds: never teleport, just refuse to leave the map.
  const b = track.bounds
  const pad = 60
  if (s.x < b.minX - pad) s.x = b.minX - pad
  if (s.x > b.maxX + pad) s.x = b.maxX + pad
  if (s.y < b.minY - pad) s.y = b.minY - pad
  if (s.y > b.maxY + pad) s.y = b.maxY + pad

  // Local search keeps s continuous where two parts of the track run close;
  // once well off the surface, search globally so rejoining elsewhere is seen.
  let near = nearestOnTrack(track, s.x, s.y, s.near.seg)
  if (near.dist > track.halfWidth * 1.5) near = nearestOnTrack(track, s.x, s.y)
  s.near = near
  s.offTrack = near.dist > track.halfWidth
}
