/**
 * Lap recording — plain math, no engine.
 *
 * A lap is sampled at 20 Hz (every third fixed step): position and heading.
 * Playback interpolates between samples against the current run's clock, so
 * a ghost cannot desync — there is no simulation to diverge.
 *
 * Encoding: quantise (position to 1/10 unit, heading to 1/1024 turn), delta
 * against the previous sample, zigzag + varint, base64. A 25 s lap is ~500
 * samples and lands well under the 8 KB target. `encodeLap` / `decodeLap`
 * are a pure pair; the tests round-trip them.
 */

export type LapSample = {
  /** Fixed-step frames since the lap started. */
  t: number
  x: number
  y: number
  heading: number
}

export type LapRecording = {
  /** Frames between samples (3 at 60 Hz = 20 Hz). */
  step: number
  /** Total lap length in fixed-step frames. */
  frames: number
  samples: LapSample[]
}

export const SAMPLE_STEP = 3
const FORMAT_VERSION = 1
const POS_Q = 10 // tenths of a unit
const HEAD_Q = 1024 / (Math.PI * 2) // 1/1024 of a turn

// ------------------------------------------------------------------ recorder

export type Recorder = {
  samples: LapSample[]
  lastT: number
}

export function createRecorder(): Recorder {
  return { samples: [], lastT: -1 }
}

/** Call once per fixed step with frames since the lap began; samples every `step`. */
export function recordStep(rec: Recorder, t: number, x: number, y: number, heading: number): void {
  if (t % SAMPLE_STEP !== 0 || t === rec.lastT) return
  rec.samples.push({ t, x, y, heading })
  rec.lastT = t
}

/** Close the recording at the finish frame with the exact finish pose. */
export function finishRecording(rec: Recorder, frames: number, x: number, y: number, heading: number): LapRecording {
  const samples = rec.samples.filter((s) => s.t < frames)
  samples.push({ t: frames, x, y, heading })
  return { step: SAMPLE_STEP, frames, samples }
}

// ------------------------------------------------------------------- codec

function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1
}
function unzigzag(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2
}

function pushVarint(out: number[], v: number): void {
  // v is a non-negative integer.
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

function readVarint(bytes: Uint8Array, pos: { i: number }): number {
  let result = 0
  let mul = 1
  for (;;) {
    if (pos.i >= bytes.length) throw new Error('lap: truncated')
    const b = bytes[pos.i++]
    result += (b & 0x7f) * mul
    if (b < 0x80) return result
    mul *= 128
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeLap(lap: LapRecording): string {
  const out: number[] = []
  pushVarint(out, FORMAT_VERSION)
  pushVarint(out, lap.step)
  pushVarint(out, lap.frames)
  pushVarint(out, lap.samples.length)
  let px = 0
  let py = 0
  let ph = 0
  let pt = 0
  for (const s of lap.samples) {
    const qx = Math.round(s.x * POS_Q)
    const qy = Math.round(s.y * POS_Q)
    // Heading is stored unwrapped so consecutive deltas stay small across ±π.
    const qh = Math.round(s.heading * HEAD_Q)
    pushVarint(out, zigzag(s.t - pt))
    pushVarint(out, zigzag(qx - px))
    pushVarint(out, zigzag(qy - py))
    pushVarint(out, zigzag(qh - ph))
    px = qx
    py = qy
    ph = qh
    pt = s.t
  }
  return toBase64(Uint8Array.from(out))
}

/** Decode; throws on any malformed input — callers treat that as "no lap". */
export function decodeLap(text: string): LapRecording {
  const bytes = fromBase64(text)
  const pos = { i: 0 }
  const version = readVarint(bytes, pos)
  if (version !== FORMAT_VERSION) throw new Error(`lap: unknown format ${version}`)
  const step = readVarint(bytes, pos)
  const frames = readVarint(bytes, pos)
  const count = readVarint(bytes, pos)
  const samples: LapSample[] = []
  let px = 0
  let py = 0
  let ph = 0
  let pt = 0
  for (let i = 0; i < count; i++) {
    pt += unzigzag(readVarint(bytes, pos))
    px += unzigzag(readVarint(bytes, pos))
    py += unzigzag(readVarint(bytes, pos))
    ph += unzigzag(readVarint(bytes, pos))
    samples.push({ t: pt, x: px / POS_Q, y: py / POS_Q, heading: ph / HEAD_Q })
  }
  if (samples.length === 0) throw new Error('lap: empty')
  return { step, frames, samples }
}

// ---------------------------------------------------------------- playback

export type Pose = { x: number; y: number; heading: number }

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Pose at `t` frames into the lap (fractional allowed for render
 * interpolation). Clamps to the first/last sample beyond the ends.
 */
export function poseAt(lap: LapRecording, t: number, out: Pose): Pose {
  const S = lap.samples
  if (t <= S[0].t) {
    out.x = S[0].x
    out.y = S[0].y
    out.heading = S[0].heading
    return out
  }
  const last = S[S.length - 1]
  if (t >= last.t) {
    out.x = last.x
    out.y = last.y
    out.heading = last.heading
    return out
  }
  // Samples are regularly spaced except the final one; jump close, then fix up.
  let i = Math.min(S.length - 2, Math.floor(t / lap.step))
  while (i > 0 && S[i].t > t) i--
  while (i < S.length - 2 && S[i + 1].t <= t) i++
  const a = S[i]
  const b = S[i + 1]
  const u = (t - a.t) / (b.t - a.t)
  out.x = a.x + (b.x - a.x) * u
  out.y = a.y + (b.y - a.y) * u
  out.heading = lerpAngle(a.heading, b.heading, u)
  return out
}
