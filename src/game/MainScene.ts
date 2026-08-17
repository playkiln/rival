import Phaser from 'phaser'
import type { SessionEndResult, SessionStartContext } from '../host/GameHost'
import { DEFAULT_CAR, copyCar, createCar, stepCar, type CarParams, type CarState } from './sim/car'
import { createLap, stepLap, type LapState } from './sim/lap'
import { buildTrack, pointAt, type Track } from './sim/track'
import { TRACK } from './track-data'

export type { SessionEndResult, SessionStartContext }

/** Fixed simulation step — 60 Hz, never driven by the frame delta. */
const STEP_MS = 1000 / 60
const STEP = STEP_MS / 1000
/** Frames of countdown before the car moves. */
const COUNTDOWN_FRAMES = 90
/** Car sprite size in world units. */
const CAR_LENGTH = 30
const CAR_WIDTH = 16

const COLORS = {
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

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const t = total % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Stage 1: one car, one track. Hold to turn one way, release to turn the
 * other. Laps run continuously; the HUD shows the live lap and the last lap.
 * There is no ghost, no score reported, and no end screen yet — the session
 * begins on `beginSession` and only ends when the host tears it down.
 */
export class MainScene extends Phaser.Scene {
  private endHandler: ((result: SessionEndResult) => void) | null = null
  private replayHandler: (() => void) | null = null
  private sessionId: string | null = null

  private track!: Track
  private params: CarParams = { ...DEFAULT_CAR }
  private car!: CarState
  private prevCar!: CarState
  private lap!: LapState
  private frame = 0
  private accumulator = 0
  private running = false

  private pointerHeld = 0
  private keys: Phaser.Input.Keyboard.Key[] = []
  private turningNow = false

  private carSprite!: Phaser.GameObjects.Image
  private marks!: Phaser.GameObjects.Graphics
  private camTarget = { x: 0, y: 0 }

  private hudLap!: Phaser.GameObjects.Text
  private hudLast!: Phaser.GameObjects.Text
  private hudMessage!: Phaser.GameObjects.Text
  private hudHint!: Phaser.GameObjects.Text
  private hudChecks!: Phaser.GameObjects.Text
  private messageUntil = 0
  private lastLapMs: number | null = null

  constructor() {
    super({ key: 'MainScene' })
  }

  setEndHandler(handler: (result: SessionEndResult) => void): void {
    this.endHandler = handler
  }

  setReplayHandler(handler: () => void): void {
    this.replayHandler = handler
  }

  create(): void {
    this.track = buildTrack(TRACK)
    this.car = createCar(this.track, this.params)
    this.prevCar = createCar(this.track, this.params)
    this.lap = createLap(this.car.near.s)

    this.drawWorld()
    this.createCarSprite()
    this.createHud()
    this.bindInput()

    this.scale.on('resize', () => this.layout())
    this.layout()

    // Park the camera on the grid until the host starts a session.
    this.camTarget.x = this.car.x
    this.camTarget.y = this.car.y
    this.cameras.main.centerOn(this.car.x, this.car.y)
    this.renderCar(1)
    this.hudMessage.setText('Waiting for host session…')
  }

  // ---------------------------------------------------------------- session

  beginSession(ctx: SessionStartContext): void {
    this.sessionId = ctx.sessionId
    this.car = createCar(this.track, this.params)
    copyCar(this.car, this.prevCar)
    this.lap = createLap(this.car.near.s)
    this.frame = 0
    this.accumulator = 0
    this.running = true
    this.lastLapMs = null
    this.marks.clear()
    this.hudLast.setText('')
    this.hudLap.setText(formatMs(0))
    this.hudHint.setText('hold to turn left · release to turn right')
    this.showMessage('3', Infinity)
    this.cameras.main.centerOn(this.car.x, this.car.y)
    this.camTarget.x = this.car.x
    this.camTarget.y = this.car.y
    this.updateChecks()
  }

  abortSession(): void {
    this.running = false
    this.sessionId = null
    this.hudHint.setText('')
    this.showMessage('Session ended by host', Infinity)
  }

  // ------------------------------------------------------------------ world

  private drawWorld(): void {
    const t = this.track
    const b = t.bounds
    const pad = 900

    // Ground: flat colour plus a dot grid so motion reads even where no track is in view.
    const tile = this.make.graphics({ x: 0, y: 0 }, false)
    tile.fillStyle(COLORS.ground, 1)
    tile.fillRect(0, 0, 64, 64)
    tile.fillStyle(COLORS.groundDot, 1)
    tile.fillCircle(32, 32, 2.2)
    tile.generateTexture('ground', 64, 64)
    tile.destroy()
    this.add
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

    const surface = this.add.graphics().setDepth(1)
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
    this.marks = this.add.graphics().setDepth(3)

    // Edges, with red kerb ticks where the centre-line curves hard.
    const edges = this.add.graphics().setDepth(4)
    edges.lineStyle(3, COLORS.edge, 0.85)
    edges.strokePoints(toVec(t.leftEdge), true)
    edges.strokePoints(toVec(t.rightEdge), true)
    const S = t.samples
    for (let i = 0; i < S.length; i += 2) {
      const a = S[(i - 3 + S.length) % S.length]
      const c = S[(i + 3) % S.length]
      const turn = Math.abs(Math.atan2(a.tx * c.ty - a.ty * c.tx, a.tx * c.tx + a.ty * c.ty))
      if (turn > 0.09 && Math.floor(i / 2) % 2 === 0) {
        edges.lineStyle(7, COLORS.kerb, 0.9)
        edges.lineBetween(t.leftEdge[i].x, t.leftEdge[i].y, t.leftEdge[(i + 2) % S.length].x, t.leftEdge[(i + 2) % S.length].y)
        edges.lineBetween(t.rightEdge[i].x, t.rightEdge[i].y, t.rightEdge[(i + 2) % S.length].x, t.rightEdge[(i + 2) % S.length].y)
      }
    }

    // Checkpoints: faint lines across the surface. Start/finish: a chequered band.
    const marksG = this.add.graphics().setDepth(4)
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
  }

  private createCarSprite(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const L = CAR_LENGTH
    const W = CAR_WIDTH
    // Body
    g.fillStyle(0x000000, 0.35)
    g.fillRoundedRect(3, 3, L, W, 4)
    g.fillStyle(COLORS.car, 1)
    g.fillRoundedRect(1, 1, L, W, 4)
    // Nose stripe
    g.fillStyle(COLORS.carNose, 1)
    g.fillRoundedRect(L - 8, 3, 7, W - 4, 2)
    // Cockpit
    g.fillStyle(0x2a1d0c, 1)
    g.fillRoundedRect(9, 5, 9, W - 8, 2)
    g.generateTexture('car', L + 4, W + 4)
    g.destroy()
    this.carSprite = this.add.image(0, 0, 'car').setOrigin(0.55, 0.5).setDepth(6)
  }

  private createHud(): void {
    const style = { fontFamily: FONT, color: '#e8eaed' }
    this.hudLap = this.add
      .text(0, 0, formatMs(0), { ...style, fontSize: '30px' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20)
    this.hudLast = this.add
      .text(0, 0, '', { ...style, fontSize: '15px', color: '#9aa3b2' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20)
    this.hudChecks = this.add
      .text(0, 0, '', { ...style, fontSize: '15px', color: '#8fb0ff' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20)
    this.hudMessage = this.add
      .text(0, 0, '', { ...style, fontSize: '40px', align: 'center' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20)
    this.hudHint = this.add
      .text(0, 0, '', { ...style, fontSize: '14px', color: '#9aa3b2' })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(20)
  }

  private layout(): void {
    const w = this.scale.width
    const h = this.scale.height
    // Zoom so the car reads at phone size and the next corner is in view on desktop.
    const zoom = Phaser.Math.Clamp(Math.min(w, h) / 560, 0.7, 1.5)
    this.cameras.main.setZoom(zoom)
    this.hudLap.setPosition(w / 2, 14)
    this.hudLast.setPosition(w / 2, 52)
    this.hudChecks.setPosition(w / 2, 74)
    this.hudMessage.setPosition(w / 2, h * 0.3)
    this.hudHint.setPosition(w / 2, h - 14)
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    // One boolean. Pointer (touch and mouse) and keyboard both feed it.
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', () => {
      this.pointerHeld += 1
    })
    const release = (): void => {
      this.pointerHeld = Math.max(0, this.pointerHeld - 1)
    }
    this.input.on('pointerup', release)
    this.input.on('pointerupoutside', release)
    // Belt and braces: a pointer released outside the canvas, or a tab switch,
    // must never leave the car stuck turning.
    window.addEventListener('pointercancel', () => (this.pointerHeld = 0))
    window.addEventListener('blur', () => (this.pointerHeld = 0))
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pointerHeld = 0
    })

    const kb = this.input.keyboard
    if (kb) {
      const codes = Phaser.Input.Keyboard.KeyCodes
      this.keys = [codes.SPACE, codes.UP, codes.DOWN, codes.LEFT, codes.RIGHT, codes.W].map((c) =>
        kb.addKey(c, true),
      )
    }
  }

  private readTurning(): boolean {
    if (this.pointerHeld > 0) return true
    for (const k of this.keys) if (k.isDown) return true
    return false
  }

  // ------------------------------------------------------------------- loop

  update(_time: number, delta: number): void {
    if (!this.running) return

    // Clamp a long stall (tab hidden, debugger) so we do not spiral catching up.
    this.accumulator += Math.min(delta, 250)
    while (this.accumulator >= STEP_MS) {
      this.step()
      this.accumulator -= STEP_MS
    }
    const alpha = this.accumulator / STEP_MS
    this.renderCar(alpha)
    this.updateCamera(delta)
    this.updateHud()
  }

  private step(): void {
    copyCar(this.car, this.prevCar)
    this.turningNow = this.readTurning()
    const moving = this.frame >= COUNTDOWN_FRAMES
    stepCar(this.car, this.params, this.track, this.turningNow, moving, STEP)
    this.frame += 1

    if (this.frame === 30) this.showMessage('2', Infinity)
    else if (this.frame === 60) this.showMessage('1', Infinity)
    else if (this.frame === COUNTDOWN_FRAMES) this.showMessage('GO', 700)

    if (!moving) return

    // Timing: the lap clock starts at GO; the first finish crossing arms lap timing.
    if (!this.lap.armed) {
      this.lap.armed = true
      this.lap.startFrame = COUNTDOWN_FRAMES
    }
    const events = stepLap(
      this.lap,
      this.track,
      this.car.near.s,
      this.car.near.dist,
      this.frame,
      this.params.speed,
      STEP,
    )
    for (const e of events) {
      if (e.type === 'checkpoint') {
        this.updateChecks()
      } else {
        const ms = e.frames * STEP_MS
        if (e.valid) {
          this.lastLapMs = ms
          this.hudLast.setText(`last ${formatMs(ms)}`)
          this.showMessage(formatMs(ms), 1400)
        } else {
          this.showMessage('lap invalid\nmissed a checkpoint', 1600)
        }
        this.updateChecks()
      }
    }

    this.leaveMarks()
  }

  /** Tyre marks when the velocity and the nose disagree — makes slip visible. */
  private leaveMarks(): void {
    const c = this.car
    const vAng = Math.atan2(c.vy, c.vx)
    let slip = vAng - c.heading
    while (slip > Math.PI) slip -= Math.PI * 2
    while (slip < -Math.PI) slip += Math.PI * 2
    const strength = Math.abs(slip)
    if (strength < 0.12 && !c.offTrack) return
    const rx = c.x - Math.cos(c.heading) * (CAR_LENGTH * 0.4)
    const ry = c.y - Math.sin(c.heading) * (CAR_LENGTH * 0.4)
    const px = -Math.sin(c.heading) * (CAR_WIDTH * 0.42)
    const py = Math.cos(c.heading) * (CAR_WIDTH * 0.42)
    this.marks.fillStyle(COLORS.mark, c.offTrack ? 0.25 : Math.min(0.55, strength * 1.4))
    this.marks.fillCircle(rx + px, ry + py, 2.4)
    this.marks.fillCircle(rx - px, ry - py, 2.4)
  }

  private renderCar(alpha: number): void {
    const a = this.prevCar
    const b = this.car
    const x = a.x + (b.x - a.x) * alpha
    const y = a.y + (b.y - a.y) * alpha
    const heading = lerpAngle(a.heading, b.heading, alpha)
    this.carSprite.setPosition(x, y)
    this.carSprite.setRotation(heading)
    this.carSprite.setTint(b.offTrack ? 0xd9d9d9 : 0xffffff)
  }

  private updateCamera(deltaMs: number): void {
    const cam = this.cameras.main
    const c = this.car
    // Look a little way down the road, in the direction of travel.
    const speed = Math.hypot(c.vx, c.vy) || 1
    const lead = 110
    const tx = this.carSprite.x + (c.vx / speed) * lead
    const ty = this.carSprite.y + (c.vy / speed) * lead
    const k = 1 - Math.exp(-deltaMs / 180)
    this.camTarget.x += (tx - this.camTarget.x) * k
    this.camTarget.y += (ty - this.camTarget.y) * k
    cam.centerOn(this.camTarget.x, this.camTarget.y)
  }

  private updateHud(): void {
    if (this.frame >= COUNTDOWN_FRAMES) {
      this.hudLap.setText(formatMs(this.lap.frames * STEP_MS))
    }
    if (this.messageUntil !== Infinity && this.time.now > this.messageUntil && this.hudMessage.text) {
      this.hudMessage.setText('')
    }
  }

  private updateChecks(): void {
    const n = this.track.checkpointS.length
    let s = ''
    for (let i = 0; i < n; i++) s += i < this.lap.next ? '●' : '○'
    this.hudChecks.setText(s)
  }

  private showMessage(text: string, durationMs: number): void {
    this.hudMessage.setText(text)
    this.messageUntil = durationMs === Infinity ? Infinity : this.time.now + durationMs
  }
}
