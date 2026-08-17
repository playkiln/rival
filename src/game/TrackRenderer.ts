import Phaser from 'phaser'
import { pointAt, type Track } from './sim/track'

/** World-unit sizes shared by the renderer and the scene. */
export const CAR_LENGTH = 30
export const CAR_WIDTH = 16
/** Border and kerb bands sit flush against the surface edge and extend outward. */
const BORDER_W = 6
const KERB_W = 14
const KERB_STRIPE = 28

export const COLORS = {
  ground: 0x18231b,
  groundDot: 0x27362b,
  tarmac: 0x3b3f48,
  edge: 0xe6e8ee,
  kerb: 0xd8483f,
  checkpoint: 0x8fb0ff,
  car: 0xffb347,
  carNose: 0xfff1d6,
  mark: 0x1c1e24,
} as const

/**
 * Draw the static world — ground, surface, border, kerbs, checkpoint lines,
 * start chequer — and return the skid-mark layer the scene draws into.
 * Everything is derived from the track geometry; nothing here is hand-placed.
 */
export function drawTrack(scene: Phaser.Scene, t: Track): { marks: Phaser.GameObjects.Graphics } {
  const b = t.bounds
  const pad = 900
  const self = scene

  // Ground: flat colour plus a dot grid so motion reads even where no track is in view.
  const tile = self.make.graphics({ x: 0, y: 0 }, false)
  tile.fillStyle(COLORS.ground, 1)
  tile.fillRect(0, 0, 64, 64)
  tile.fillStyle(COLORS.groundDot, 1)
  tile.fillCircle(32, 32, 2.2)
  tile.generateTexture('ground', 64, 64)
  tile.destroy()
  self.add
    .tileSprite(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2, 'ground')
    .setOrigin(0)
    .setDepth(0)
  // Surface: fill the outer edge, cut the inner edge back to ground.
  const area = (pts: { x: number; y: number }[]): number => {
    let a = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      a += p.x * q.y - q.x * p.y
    }
    return Math.abs(a / 2)
  }
  const outer = area(t.leftEdge) >= area(t.rightEdge) ? t.leftEdge : t.rightEdge
  const inner = outer === t.leftEdge ? t.rightEdge : t.leftEdge
  const toVec = (pts: { x: number; y: number }[]) => pts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

  const surface = self.add.graphics().setDepth(1)
  surface.fillStyle(COLORS.tarmac, 1)
  surface.fillPoints(toVec(outer), true)
  surface.fillStyle(COLORS.ground, 1)
  surface.fillPoints(toVec(inner), true)
  // Re-lay the dot grid over the infield so it matches the outside.
  const inside = (x: number, y: number): boolean => {
    let hit = false
    for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
      const a = inner[i]
      const c = inner[j]
      if (a.y > y !== c.y > y && x < ((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  surface.fillStyle(COLORS.groundDot, 1)
  for (let x = Math.floor(b.minX / 64) * 64 + 32; x < b.maxX; x += 64) {
    for (let y = Math.floor(b.minY / 64) * 64 + 32; y < b.maxY; y += 64) {
      if (inside(x, y)) surface.fillCircle(x, y, 2.2)
    }
  }

  // Skid marks live under the edges but over the tarmac.
  const marks = self.add.graphics().setDepth(3)

  // Border: a solid white band on both edges. Kerbs: on the corner arcs the
  // band widens into red/white stripes of a fixed length, measured along
  // the edge itself so inner and outer kerbs stripe at the same pitch.
  const edges = self.add.graphics().setDepth(4)
  const S = t.samples
  const N = S.length
  const hw = t.halfWidth
  // A quad between two centre-line stations at two lateral offsets.
  const quad = (
    a: { x: number; y: number; tx: number; ty: number },
    b: { x: number; y: number; tx: number; ty: number },
    side: 1 | -1,
    o0: number,
    o1: number,
    color: number,
  ): void => {
    edges.fillStyle(color, 1)
    edges.fillPoints(
      [
        new Phaser.Math.Vector2(a.x - a.ty * side * o0, a.y + a.tx * side * o0),
        new Phaser.Math.Vector2(a.x - a.ty * side * o1, a.y + a.tx * side * o1),
        new Phaser.Math.Vector2(b.x - b.ty * side * o1, b.y + b.tx * side * o1),
        new Phaser.Math.Vector2(b.x - b.ty * side * o0, b.y + b.tx * side * o0),
      ],
      true,
    )
  }
  const station = (
    a: (typeof S)[number],
    b: (typeof S)[number],
    u: number,
  ): { x: number; y: number; tx: number; ty: number } => {
    const tx = a.tx + (b.tx - a.tx) * u
    const ty = a.ty + (b.ty - a.ty) * u
    const l = Math.hypot(tx, ty) || 1
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, tx: tx / l, ty: ty / l }
  }
  for (const side of [1, -1] as const) {
    // Border along the whole lap.
    for (let i = 0; i < N; i++) {
      quad(S[i], S[(i + 1) % N], side, hw, hw + BORDER_W, COLORS.edge)
    }
    // Kerbs on each maximal kerbed run (arcs, and short straights between them). Start each run on a red stripe.
    let i = 0
    // Begin at a non-arc sample so a run never wraps around index 0 unnoticed.
    while (i < N && S[i].kerb) i++
    const first = i
    let visited = 0
    while (visited < N) {
      const cur = S[(first + visited) % N]
      if (!cur.kerb) {
        visited++
        continue
      }
      // Collect the run.
      let run = 0
      while (visited + run < N && S[(first + visited + run) % N].kerb) run++
      let along = 0
      for (let k = 0; k < run; k++) {
        const a = S[(first + visited + k) % N]
        const b = S[(first + visited + k + 1) % N]
        // Edge-length of this segment at the kerb's radius.
        const ax = a.x - a.ty * side * hw
        const ay = a.y + a.tx * side * hw
        const bx = b.x - b.ty * side * hw
        const by = b.y + b.tx * side * hw
        const segLen = Math.hypot(bx - ax, by - ay)
        // Split at stripe boundaries.
        let u0 = 0
        while (u0 < 1) {
          const stripeEnd = (Math.floor(along / KERB_STRIPE) + 1) * KERB_STRIPE
          const u1 = Math.min(1, u0 + (stripeEnd - along) / segLen)
          const color = Math.floor(along / KERB_STRIPE) % 2 === 0 ? COLORS.kerb : COLORS.edge
          quad(station(a, b, u0), station(a, b, u1), side, hw, hw + KERB_W, color)
          along += (u1 - u0) * segLen
          u0 = u1
        }
      }
      visited += run
    }
  }

  // Checkpoints: faint lines across the surface. Start/finish: a chequered band.
  const marksG = self.add.graphics().setDepth(4)
  for (const s of t.checkpointS) {
    const p = pointAt(t, s)
    marksG.lineStyle(2, COLORS.checkpoint, 0.35)
    marksG.lineBetween(
      p.x - p.ty * t.halfWidth,
      p.y + p.tx * t.halfWidth,
      p.x + p.ty * t.halfWidth,
      p.y - p.tx * t.halfWidth,
    )
  }
  const st = pointAt(t, 0)
  const cell = t.halfWidth / 6
  for (let i = -6; i < 6; i++) {
    for (let j = 0; j < 2; j++) {
      marksG.fillStyle((i + j) % 2 === 0 ? 0xf2f2f2 : 0x14161b, 1)
      const cx = st.x - st.ty * (i + 0.5) * cell + st.tx * (j - 1) * cell
      const cy = st.y + st.tx * (i + 0.5) * cell + st.ty * (j - 1) * cell
      marksG.fillRect(cx - cell / 2, cy - cell / 2, cell, cell)
    }
  }
  return { marks }
}

/** Generate the car texture once; the player and the ghost share it. */
export function makeCarTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('car')) return
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  const L = CAR_LENGTH
  const W = CAR_WIDTH
  g.fillStyle(0x000000, 0.35)
  g.fillRoundedRect(3, 3, L, W, 4)
  g.fillStyle(COLORS.car, 1)
  g.fillRoundedRect(1, 1, L, W, 4)
  g.fillStyle(COLORS.carNose, 1)
  g.fillRoundedRect(L - 8, 3, 7, W - 4, 2)
  g.fillStyle(0x2a1d0c, 1)
  g.fillRoundedRect(9, 5, 9, W - 8, 2)
  g.generateTexture('car', L + 4, W + 4)
  g.destroy()
}
