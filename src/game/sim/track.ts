/**
 * Track geometry — plain math the Phaser scene draws and simulates against.
 *
 * A track is a closed centre-line (Catmull-Rom through authored control
 * points) plus a width. Everything else — the drivable surface, the visual,
 * the checkpoints, "how far round am I" — is derived from that one structure.
 *
 * Units are world units; the car is ~30 long, the track ~110 wide.
 */

export type Vec = { x: number; y: number }

export type TrackDef = {
  /** Closed Catmull-Rom control polygon, in driving order. Index 0 is the start line. */
  controls: Vec[]
  /** Full surface width. */
  width: number
  /** Number of checkpoints spread evenly along the lap (excluding the finish line). */
  checkpoints: number
  /** Samples per control segment when flattening the spline. */
  resolution?: number
}

export type TrackSample = Vec & {
  /** Arc-length from the start line. */
  s: number
  /** Unit tangent. */
  tx: number
  ty: number
}

export type Track = {
  def: TrackDef
  halfWidth: number
  /** Dense closed polyline; sample[i] → sample[i+1] wraps at the end. */
  samples: TrackSample[]
  length: number
  /** Arc-length positions of the ordered checkpoints (finish is implicit at s = 0). */
  checkpointS: number[]
  /** Left/right edge polylines (same indexing as samples). */
  leftEdge: Vec[]
  rightEdge: Vec[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  start: { x: number; y: number; heading: number }
}

export type NearestResult = {
  /** Distance from the centre-line. */
  dist: number
  /** Arc-length position along the lap, in [0, length). */
  s: number
  seg: number
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

export function buildTrack(def: TrackDef): Track {
  const c = def.controls
  const n = c.length
  const res = def.resolution ?? 24
  const pts: Vec[] = []
  for (let i = 0; i < n; i++) {
    const p0 = c[(i - 1 + n) % n]
    const p1 = c[i]
    const p2 = c[(i + 1) % n]
    const p3 = c[(i + 2) % n]
    for (let k = 0; k < res; k++) {
      const t = k / res
      pts.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      })
    }
  }

  const samples: TrackSample[] = []
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    samples.push({ x: a.x, y: a.y, s, tx: dx / len, ty: dy / len })
    s += len
  }
  const length = s

  const halfWidth = def.width / 2
  const leftEdge: Vec[] = []
  const rightEdge: Vec[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < samples.length; i++) {
    // Average the tangent with the previous segment so edges do not kink.
    const prev = samples[(i - 1 + samples.length) % samples.length]
    const cur = samples[i]
    let nx = -(prev.ty + cur.ty)
    let ny = prev.tx + cur.tx
    const nl = Math.hypot(nx, ny) || 1
    nx /= nl
    ny /= nl
    const l = { x: cur.x + nx * halfWidth, y: cur.y + ny * halfWidth }
    const r = { x: cur.x - nx * halfWidth, y: cur.y - ny * halfWidth }
    leftEdge.push(l)
    rightEdge.push(r)
    for (const p of [l, r]) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }

  const checkpointS: number[] = []
  for (let i = 1; i <= def.checkpoints; i++) {
    checkpointS.push((length * i) / (def.checkpoints + 1))
  }

  const s0 = samples[0]
  return {
    def,
    halfWidth,
    samples,
    length,
    checkpointS,
    leftEdge,
    rightEdge,
    bounds: { minX, minY, maxX, maxY },
    start: { x: s0.x, y: s0.y, heading: Math.atan2(s0.ty, s0.tx) },
  }
}

/** The centre-line point and tangent at arc-length s. */
export function pointAt(track: Track, s: number): TrackSample {
  const S = track.samples
  const L = track.length
  s = ((s % L) + L) % L
  let lo = 0
  let hi = S.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (S[mid].s <= s) lo = mid
    else hi = mid - 1
  }
  const a = S[lo]
  const d = s - a.s
  return { x: a.x + a.tx * d, y: a.y + a.ty * d, s, tx: a.tx, ty: a.ty }
}

/**
 * Nearest point on the centre-line. Brute force over segments — a few hundred
 * samples once per step is nothing. `hint` narrows the search to a window
 * around a previous segment so the result stays continuous where two parts of
 * the track run close together.
 */
export function nearestOnTrack(track: Track, x: number, y: number, hint?: number): NearestResult {
  const S = track.samples
  const N = S.length
  let best: NearestResult = { dist: Infinity, s: 0, seg: 0 }
  const window = hint === undefined ? N : 40
  for (let k = 0; k < window; k++) {
    const i = hint === undefined ? k : (hint - 20 + k + N) % N
    const a = S[i]
    const b = S[(i + 1) % N]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const segLen2 = abx * abx + aby * aby || 1
    let t = ((x - a.x) * abx + (y - a.y) * aby) / segLen2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = a.x + abx * t
    const py = a.y + aby * t
    const d = Math.hypot(x - px, y - py)
    if (d < best.dist) {
      let sPos = a.s + Math.sqrt(segLen2) * t
      if (sPos >= track.length) sPos -= track.length
      best = { dist: d, s: sPos, seg: i }
    }
  }
  return best
}

/** Signed forward distance from s0 to s1 along the lap, in (-length/2, length/2]. */
export function lapDelta(track: Track, s0: number, s1: number): number {
  let d = s1 - s0
  const L = track.length
  if (d > L / 2) d -= L
  if (d < -L / 2) d += L
  return d
}
