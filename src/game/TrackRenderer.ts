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
  edge: 0xe6e8ee,
  kerb: 0xd8483f,
  checkpoint: 0x8fb0ff,
  mark: 0x1c1e24,
} as const

/** Texture keys the scene preloads for the world; see `queueWorldAssets`. */
const TEX = { infield: 'infield', tarmac: 'tarmac', car: 'car' } as const

/** Queue the world's images: two seamless surface tiles and the car. */
export function queueWorldAssets(load: Phaser.Loader.LoaderPlugin): void {
  load.image(TEX.infield, 'assets/art/infield.jpg')
  load.image(TEX.tarmac, 'assets/art/tarmac.jpg')
  load.image(TEX.car, 'assets/art/car.png')
}

/**
 * Draw the static world — ground, surface, border, kerbs, checkpoint lines,
 * start chequer — and return the skid-mark layer the scene draws into.
 *
 * The two surfaces are image tiles laid UNDER geometry that stays
 * procedural: the road polygon is a mask over a tarmac tile, so the width,
 * the borders, the kerbs and the chequer are still exact to the simulation.
 * Everything is derived from the track geometry; nothing here is hand-placed.
 */
export function drawTrack(scene: Phaser.Scene, t: Track): { marks: Phaser.GameObjects.Graphics } {
  const b = t.bounds
  const pad = 900
  const self = scene

  // Ground: the infield tile everywhere, so motion reads even where no track is in view.
  const groundW = b.maxX - b.minX + pad * 2
  const groundH = b.maxY - b.minY + pad * 2
  self.add.tileSprite(b.minX - pad, b.minY - pad, groundW, groundH, TEX.infield).setOrigin(0).setDepth(0)
  // Surface: tarmac inside the outer edge, infield again inside the inner edge.
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

  // The road is baked once: the tarmac tile over the track's bounds, with
  // everything outside the outer edge and inside the inner edge erased. The
  // polygons are what keep the road exact to the simulation; the bake is
  // only because a texture cannot be poured into a Graphics fill directly.
  {
    const M = 40
    const bx = b.minX - M
    const by = b.minY - M
    const bw = Math.ceil(b.maxX - b.minX + M * 2)
    const bh = Math.ceil(b.maxY - b.minY + M * 2)
    const dt = self.textures.addDynamicTexture('surface', bw, bh)
    if (dt) {
      const local = (pts: { x: number; y: number }[]) => pts.map((p) => new Phaser.Math.Vector2(p.x - bx, p.y - by))
      const tarmac = self.make.tileSprite({ x: 0, y: 0, width: bw, height: bh, key: TEX.tarmac, add: false }).setOrigin(0)
      dt.draw(tarmac, 0, 0)
      const cut = self.make.graphics({ x: 0, y: 0 }, false)
      cut.fillStyle(0xffffff, 1)
      cut.fillPoints(outsideOf(local(outer), bw, bh), true)
      cut.fillPoints(local(inner), true)
      dt.erase(cut, 0, 0)
      // Phaser 4 buffers draw commands; nothing lands until this.
      dt.render()
      tarmac.destroy()
      cut.destroy()
      self.add.image(bx, by, 'surface').setOrigin(0).setDepth(1)
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

/**
 * The complement of a polygon within a w×h box, as one polygon: the box's
 * outline, a zero-width slit in to the polygon, the polygon traced in the
 * opposite winding, and the slit back out. Earcut triangulates this
 * directly, so a Graphics fill can carve "everything but the road".
 */
function outsideOf(poly: Phaser.Math.Vector2[], w: number, h: number): Phaser.Math.Vector2[] {
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    area += p.x * q.y - q.x * p.y
  }
  // The box below is wound with positive signed area; the hole must run the other way.
  const hole = area > 0 ? [...poly].reverse() : [...poly]
  // Bridge from the box corner to the hole's nearest vertex.
  let k = 0
  let best = Infinity
  for (let i = 0; i < hole.length; i++) {
    const d = hole[i].x * hole[i].x + hole[i].y * hole[i].y
    if (d < best) {
      best = d
      k = i
    }
  }
  const box = [
    new Phaser.Math.Vector2(0, 0),
    new Phaser.Math.Vector2(w, 0),
    new Phaser.Math.Vector2(w, h),
    new Phaser.Math.Vector2(0, h),
    new Phaser.Math.Vector2(0, 0),
  ]
  const ring: Phaser.Math.Vector2[] = []
  for (let i = 0; i <= hole.length; i++) ring.push(hole[(k + i) % hole.length])
  return [...box, ...ring]
}

/**
 * A car sprite from the loaded image, scaled uniformly so it is CAR_LENGTH
 * long — the simulation's size, which the tyre-mark offsets share. The
 * player and the ghost both use this; the ghost sets its own alpha.
 */
export function makeCarSprite(scene: Phaser.Scene): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, TEX.car)
  img.setScale(CAR_LENGTH / img.width)
  // The pivot sits a touch ahead of centre so the nose leads the turn.
  img.setOrigin(0.54, 0.5)
  return img
}
