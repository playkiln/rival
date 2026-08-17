/**
 * Track geometry — plain math the Phaser scene draws and simulates against.
 *
 * A track is a closed polygon of corners, each rounded with a circular arc of
 * its own radius, joined by straights — the way a circuit is actually laid
 * out — plus one constant width. Everything else (the surface, the border,
 * the kerbs, the checkpoints, "how far round am I") is derived from that.
 *
 * Units are world units; the car is ~30 long, the track ~120 wide.
 */

export type Vec = { x: number; y: number }

export type Corner = Vec & {
  /** Radius of the arc that rounds this corner, on the centre-line. */
  r: number
}

export type TrackDef = {
  /** Corners in driving order. Straights run between consecutive arcs. */
  corners: Corner[]
  /** Full surface width, constant. */
  width: number
  /** Number of checkpoints spread evenly along the lap (excluding the finish line). */
  checkpoints: number
  /**
   * Where s = 0 (the start/finish line) sits: this far along the straight
   * that leaves the last corner and runs to the first.
   */
  startOffset: number
  /** Approximate spacing between samples along the centre-line. */
  spacing?: number
}

export type TrackSample = Vec & {
  /** Arc-length from the start line. */
  s: number
  /** Unit tangent. */
  tx: number
  ty: number
  /** True on a corner arc, false on a straight — the kerbs key off this. */
  arc: boolean
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

type Fillet = {
  /** Where the incoming straight ends and the arc begins. */
  in: Vec
  /** Where the arc ends and the outgoing straight begins. */
  out: Vec
  centre: Vec
  r: number
  /** Signed sweep of the arc, radians (+ is clockwise on screen, y down). */
  sweep: number
  /** Distance from the corner vertex to each tangent point. */
  tangent: number
}

function fillet(prev: Vec, v: Corner, next: Vec): Fillet {
  let d1x = v.x - prev.x
  let d1y = v.y - prev.y
  let l1 = Math.hypot(d1x, d1y)
  d1x /= l1
  d1y /= l1
  let d2x = next.x - v.x
  let d2y = next.y - v.y
  let l2 = Math.hypot(d2x, d2y)
  d2x /= l2
  d2y /= l2
  const cross = d1x * d2y - d1y * d2x
  const dot = d1x * d2x + d1y * d2y
  const turn = Math.atan2(cross, dot) // signed turn angle
  const tangent = v.r * Math.tan(Math.abs(turn) / 2)
  const inPt = { x: v.x - d1x * tangent, y: v.y - d1y * tangent }
  const outPt = { x: v.x + d2x * tangent, y: v.y + d2y * tangent }
  // Centre is perpendicular to the incoming direction, on the turn side.
  const side = Math.sign(turn) || 1
  const nx = -d1y * side
  const ny = d1x * side
  const centre = { x: inPt.x + nx * v.r, y: inPt.y + ny * v.r }
  return { in: inPt, out: outPt, centre, r: v.r, sweep: turn, tangent }
}

export function buildTrack(def: TrackDef): Track {
  const C = def.corners
  const n = C.length
  const spacing = def.spacing ?? 10
  const fillets = C.map((v, i) => fillet(C[(i - 1 + n) % n], v, C[(i + 1) % n]))

  // Fail loudly on unbuildable data: two arcs eating the same straight.
  for (let i = 0; i < n; i++) {
    const a = fillets[i]
    const b = fillets[(i + 1) % n]
    const edge = Math.hypot(C[(i + 1) % n].x - C[i].x, C[(i + 1) % n].y - C[i].y)
    if (a.tangent + b.tangent > edge + 1e-6) {
      throw new Error(
        `track: corners ${i} and ${(i + 1) % n} overlap — edge ${edge.toFixed(0)}, ` +
          `tangents ${a.tangent.toFixed(0)} + ${b.tangent.toFixed(0)}`,
      )
    }
  }

  // Walk the loop starting on the straight out of the last corner: straight
  // (last → first), arc(first), straight, arc, … The start line is startOffset
  // along that first straight, so rotate afterwards.
  const raw: Omit<TrackSample, 's'>[] = []
  const pushStraight = (a: Vec, b: Vec): void => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    const tx = dx / len
    const ty = dy / len
    const steps = Math.max(1, Math.round(len / spacing))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      raw.push({ x: a.x + dx * t, y: a.y + dy * t, tx, ty, arc: false })
    }
  }
  const pushArc = (f: Fillet): void => {
    const arcLen = Math.abs(f.sweep) * f.r
    if (arcLen < 1e-6) return
    const steps = Math.max(2, Math.round(arcLen / spacing))
    const a0 = Math.atan2(f.in.y - f.centre.y, f.in.x - f.centre.x)
    for (let k = 0; k < steps; k++) {
      const ang = a0 + f.sweep * (k / steps)
      const x = f.centre.x + Math.cos(ang) * f.r
      const y = f.centre.y + Math.sin(ang) * f.r
      // Tangent is the radius rotated by the sweep direction.
      const s = Math.sign(f.sweep)
      raw.push({ x, y, tx: -Math.sin(ang) * s, ty: Math.cos(ang) * s, arc: true })
    }
  }
  for (let i = 0; i < n; i++) {
    const prevF = fillets[(i - 1 + n) % n]
    const f = fillets[i]
    pushStraight(prevF.out, f.in)
    pushArc(f)
  }

  // Rotate so index 0 is startOffset along the first straight.
  let startIdx = 0
  {
    const first = fillets[n - 1].out
    let best = Infinity
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i]
      if (p.arc) continue
      const d = Math.abs(Math.hypot(p.x - first.x, p.y - first.y) - def.startOffset)
      if (d < best) {
        best = d
        startIdx = i
      }
    }
  }
  const rotated = raw.slice(startIdx).concat(raw.slice(0, startIdx))

  const samples: TrackSample[] = []
  let s = 0
  for (let i = 0; i < rotated.length; i++) {
    const a = rotated[i]
    const b = rotated[(i + 1) % rotated.length]
    samples.push({ ...a, s })
    s += Math.hypot(b.x - a.x, b.y - a.y)
  }
  const length = s

  const halfWidth = def.width / 2
  const leftEdge: Vec[] = []
  const rightEdge: Vec[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const cur of samples) {
    const l = { x: cur.x - cur.ty * halfWidth, y: cur.y + cur.tx * halfWidth }
    const r = { x: cur.x + cur.ty * halfWidth, y: cur.y - cur.tx * halfWidth }
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
  return { x: a.x + a.tx * d, y: a.y + a.ty * d, s, tx: a.tx, ty: a.ty, arc: a.arc }
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
