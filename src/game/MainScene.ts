import Phaser from 'phaser'
import type { SessionEndResult, SessionStartContext } from '../host/GameHost'
import type { MedalKey } from './ghosts'
import { applyLap, createProgress, rivalFor, type Progress, type Rival } from './progress'
import { DEFAULT_CAR, copyCar, createCar, stepCar, type CarParams, type CarState } from './sim/car'
import { decide, type Skill } from './sim/driver'
import { makeGhost, type Ghost } from './sim/ghost'
import { createLap, stepLap, type LapState } from './sim/lap'
import {
  createRecorder,
  encodeLap,
  finishRecording,
  poseAt,
  recordStep,
  type LapRecording,
  type Pose,
  type Recorder,
} from './sim/recording'
import { buildTrack, type Track } from './sim/track'
import { CAR_LENGTH, CAR_WIDTH, COLORS, drawTrack, makeCarTexture } from './TrackRenderer'
import { TRACK } from './track-data'
import { UI, backdrop, button, label, type Button } from './ui/widgets'

export type { SessionEndResult, SessionStartContext }

/** Fixed simulation step — 60 Hz, never driven by the frame delta. */
const STEP_MS = 1000 / 60
const STEP = STEP_MS / 1000
/** Frames of countdown before the car moves. */
const COUNTDOWN_FRAMES = 90
/** Frames of grace after resuming from pause before the sim runs again. */
const RESUME_FRAMES = 45
/** Depth reserved for HUD objects; the camera split keys off it. */
const HUD_DEPTH = 20

const MEDAL_LABEL: Record<MedalKey, string> = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD' }
const MEDAL_COLOR: Record<MedalKey, string> = { bronze: UI.bronze, silver: UI.silver, gold: UI.gold }

/**
 * Developer switches, read from localStorage so nothing in the UI exposes
 * them: `rival.dev.autodrive` = "1" lets the pursuit driver drive (for
 * lifecycle checks in headless runs); `rival.dev.export` = "1" logs each
 * valid lap's encoding to the console (to hand-record medal ghosts).
 */
function devFlag(name: string): boolean {
  try {
    return window.localStorage.getItem(`rival.dev.${name}`) === '1'
  } catch {
    return false
  }
}
const AUTODRIVE_SKILL: Skill = { look: 90, every: 4, wander: 0, wanderPeriod: 2 }

type State = 'idle' | 'menu' | 'countdown' | 'racing' | 'finished'

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const t = total % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`
}

function formatDelta(ms: number): string {
  const sign = ms < 0 ? '−' : '+'
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Rival — one lap per session, raced against a ghost.
 *
 *   session.start → (attempt 1: start screen) → countdown → racing → finish
 *   → sessionEnd → end screen → "race again" → requestNewSession → session.start
 *
 * The scene knows nothing about postMessage: it is driven through
 * beginSession / abortSession and reports through the end/replay handlers.
 * The simulation runs on a fixed 60 Hz accumulator; the ghost is played back
 * against the same frame count, so the two cannot drift.
 */
export class MainScene extends Phaser.Scene {
  private endHandler: ((result: SessionEndResult) => void) | null = null
  private replayHandler: (() => void) | null = null
  private sessionId: string | null = null
  private sessionStartedAt = 0

  private track!: Track
  private params: CarParams = { ...DEFAULT_CAR }
  private car!: CarState
  private prevCar!: CarState
  private lap!: LapState
  private recorder: Recorder = createRecorder()
  private progress: Progress = createProgress()
  private rival: Rival | null = null
  private ghost: Ghost | null = null
  private ghostPose: Pose = { x: 0, y: 0, heading: 0 }

  private state: State = 'idle'
  private paused = false
  private resumeGrace = 0
  private frame = 0
  private goFrame = 0
  private accumulator = 0
  private autodrive = false

  private pointerHeld = 0
  private keys: Phaser.Input.Keyboard.Key[] = []
  private turningNow = false

  private carSprite!: Phaser.GameObjects.Image
  private ghostSprite!: Phaser.GameObjects.Image
  private marks!: Phaser.GameObjects.Graphics
  private camTarget = { x: 0, y: 0 }
  private hudCam!: Phaser.Cameras.Scene2D.Camera

  // HUD
  private hudLap!: Phaser.GameObjects.Text
  private hudRival!: Phaser.GameObjects.Text
  private hudSplit!: Phaser.GameObjects.Text
  private hudChecks!: Phaser.GameObjects.Text
  private hudMessage!: Phaser.GameObjects.Text
  private hudHint!: Phaser.GameObjects.Text
  private pauseButton!: Button
  private messageUntil = 0
  private splitUntil = 0

  // Panels
  private dim!: Phaser.GameObjects.Rectangle
  private menuPanel!: Phaser.GameObjects.Container
  private menuRival!: Phaser.GameObjects.Text
  private menuBest!: Phaser.GameObjects.Text
  private pausePanel!: Phaser.GameObjects.Container
  private endPanel!: Phaser.GameObjects.Container
  private endTitle!: Phaser.GameObjects.Text
  private endTime!: Phaser.GameObjects.Text
  private endDelta!: Phaser.GameObjects.Text
  private endMedal!: Phaser.GameObjects.Text
  private endNext!: Phaser.GameObjects.Text
  private endButton!: Button

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
    this.autodrive = devFlag('autodrive')

    this.marks = drawTrack(this, this.track).marks
    makeCarTexture(this)
    this.ghostSprite = this.add.image(0, 0, 'car').setOrigin(0.55, 0.5).setDepth(5).setAlpha(0.42).setVisible(false)
    this.carSprite = this.add.image(0, 0, 'car').setOrigin(0.55, 0.5).setDepth(6)
    this.createHud()
    this.createPanels()
    this.bindInput()
    this.splitCameras()

    this.scale.on('resize', () => this.layout())
    this.layout()

    this.camTarget.x = this.car.x
    this.camTarget.y = this.car.y
    this.cameras.main.centerOn(this.car.x, this.car.y)
    this.renderCars(1)
    this.showMessage('Waiting for host session…', Infinity, 20)
  }

  // ---------------------------------------------------------------- session

  beginSession(ctx: SessionStartContext): void {
    this.sessionId = ctx.sessionId
    this.sessionStartedAt = Date.now()
    this.resetRun()
    this.rival = rivalFor(this.progress)
    this.ghost = makeGhost(this.track, this.rival.lap)
    this.hudRival.setText(this.rivalLabel())
    this.hudRival.setColor(this.rival.kind === 'medal' ? MEDAL_COLOR[this.rival.medal] : UI.accent)
    this.hidePanels()
    if (ctx.attempt === 1) this.showMenu()
    else this.startCountdown()
  }

  abortSession(): void {
    // The host gave up on this session — stop quietly, without a result.
    this.state = 'idle'
    this.paused = false
    this.sessionId = null
    this.hidePanels()
    this.hudHint.setText('')
    this.pauseButton.container.setVisible(false)
    this.showMessage('Session ended by host', Infinity, 20)
  }

  private resetRun(): void {
    this.car = createCar(this.track, this.params)
    copyCar(this.car, this.prevCar)
    this.lap = createLap(this.car.near.s)
    this.recorder = createRecorder()
    this.frame = 0
    this.goFrame = 0
    this.accumulator = 0
    this.paused = false
    this.resumeGrace = 0
    this.marks.clear()
    this.hudLap.setText(formatMs(0))
    this.hudSplit.setText('')
    this.updateChecks()
    this.ghostSprite.setVisible(false).setAlpha(0.42)
    this.camTarget.x = this.car.x
    this.camTarget.y = this.car.y
    this.cameras.main.centerOn(this.car.x, this.car.y)
    this.renderCars(1)
  }

  private rivalLabel(): string {
    const r = this.rival
    if (!r) return ''
    return r.kind === 'medal' ? `${MEDAL_LABEL[r.medal]} ${formatMs(r.ms)}` : `YOUR BEST ${formatMs(r.ms)}`
  }

  private showMenu(): void {
    this.state = 'menu'
    this.menuRival.setText(`Rival: ${this.rivalLabel()}`)
    this.menuRival.setColor(this.rival?.kind === 'medal' ? MEDAL_COLOR[this.rival.medal] : UI.accent)
    this.menuBest.setText(this.progress.bestMs === null ? '' : `Your best ${formatMs(this.progress.bestMs)}`)
    this.dim.setVisible(true)
    this.menuPanel.setVisible(true)
    this.hudHint.setText('')
    this.pauseButton.container.setVisible(false)
    this.showMessage('', 0)
  }

  private startCountdown(): void {
    this.hidePanels()
    this.state = 'countdown'
    this.frame = 0
    this.pointerHeld = 0
    this.hudHint.setText('hold to turn left · release to turn right')
    this.pauseButton.container.setVisible(true)
    this.showMessage('3', Infinity)
  }

  private finishLap(valid: boolean, lapFrames: number): void {
    if (this.state !== 'racing' || !this.sessionId) return
    this.state = 'finished'
    const ms = Math.round(lapFrames * STEP_MS)
    const rival = this.rival

    let recording: LapRecording | null = null
    if (valid) {
      recording = finishRecording(this.recorder, lapFrames, this.car.x, this.car.y, this.car.heading)
      if (devFlag('export')) console.log(`[rival] lap ${ms}ms\n${encodeLap(recording)}`)
    }

    // Report first, then paint the game-owned end screen.
    const result: SessionEndResult = {
      sessionId: this.sessionId,
      outcome: valid ? 'completed' : 'failed',
      durationMs: Date.now() - this.sessionStartedAt,
    }
    if (valid) result.score = ms
    this.sessionId = null
    this.endHandler?.(result)
    this.hudLap.setText(formatMs(ms))

    this.hudHint.setText('')
    this.pauseButton.container.setVisible(false)
    this.showMessage('', 0)

    if (!valid || !recording) {
      this.endTitle.setText('LAP INVALID').setColor(UI.bad)
      this.endTime.setText(formatMs(ms))
      this.endDelta.setText('a checkpoint was missed — the circuit cannot be cut').setColor(UI.dim)
      this.endMedal.setText('')
      this.endNext.setText('')
    } else {
      const outcome = applyLap(this.progress, ms, recording)
      this.endTitle.setText(outcome.newBest ? 'NEW BEST' : 'LAP COMPLETE').setColor(outcome.newBest ? UI.accent : UI.text)
      this.endTime.setText(formatMs(ms))
      if (rival) {
        const delta = ms - rival.ms
        const who = rival.kind === 'medal' ? `${MEDAL_LABEL[rival.medal]} ghost` : 'your best'
        this.endDelta.setText(`${formatDelta(delta)} vs ${who}`).setColor(delta < 0 ? UI.good : UI.bad)
      } else {
        this.endDelta.setText('')
      }
      if (outcome.earned.length) {
        const top = outcome.earned[outcome.earned.length - 1]
        this.endMedal.setText(`${MEDAL_LABEL[top]} MEDAL`).setColor(MEDAL_COLOR[top])
      } else if (this.progress.medals.length === 3) {
        this.endMedal.setText('ALL MEDALS').setColor(UI.gold)
      } else {
        this.endMedal.setText('')
      }
      const next = rivalFor(this.progress)
      const nextLabel =
        next.kind === 'medal' ? `${MEDAL_LABEL[next.medal]} ${formatMs(next.ms)}` : `your best ${formatMs(next.ms)}`
      const justSwitched = outcome.earned.includes('gold')
      this.endNext.setText(
        justSwitched ? `gold beaten — from now on you race yourself\n${nextLabel}` : `next rival: ${nextLabel}`,
      )
    }
    this.dim.setVisible(true)
    this.endPanel.setVisible(true)
  }

  private requestReplay(): void {
    // Fire-and-forget: the host answers with a fresh session.start.
    this.replayHandler?.()
  }

  // ------------------------------------------------------------------ pause

  private pauseRun(): void {
    if (this.paused || (this.state !== 'racing' && this.state !== 'countdown')) return
    this.paused = true
    this.pointerHeld = 0
    this.dim.setVisible(true)
    this.pausePanel.setVisible(true)
    this.pauseButton.container.setVisible(false)
  }

  private resumeRun(): void {
    if (!this.paused) return
    this.paused = false
    this.pointerHeld = 0
    this.resumeGrace = RESUME_FRAMES
    this.accumulator = 0
    this.dim.setVisible(false)
    this.pausePanel.setVisible(false)
    this.pauseButton.container.setVisible(true)
  }

  /** From pause: end this session honestly as a quit, then ask for a fresh one. */
  private restartRun(): void {
    if (!this.paused || !this.sessionId) return
    const result: SessionEndResult = {
      sessionId: this.sessionId,
      outcome: 'quit',
      durationMs: Date.now() - this.sessionStartedAt,
    }
    this.sessionId = null
    this.state = 'finished'
    this.paused = false
    this.hidePanels()
    this.endHandler?.(result)
    this.requestReplay()
  }

  // -------------------------------------------------------------------- HUD

  private createHud(): void {
    const hud = (t: Phaser.GameObjects.Text): Phaser.GameObjects.Text => t.setScrollFactor(0).setDepth(HUD_DEPTH)
    this.hudLap = hud(label(this, formatMs(0), 30)).setOrigin(0.5, 0)
    this.hudRival = hud(label(this, '', 14, UI.dim, 'left')).setOrigin(0, 0)
    this.hudSplit = hud(label(this, '', 22)).setOrigin(0.5, 0)
    this.hudChecks = hud(label(this, '', 15, '#8fb0ff')).setOrigin(0.5, 0)
    this.hudMessage = hud(label(this, '', 40))
    this.hudHint = hud(label(this, '', 14, UI.dim)).setOrigin(0.5, 1)
    this.pauseButton = button(this, 'II', 44, 32, () => this.pauseRun())
    this.pauseButton.container.setDepth(HUD_DEPTH).setVisible(false)
  }

  private createPanels(): void {
    this.dim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(0).setDepth(HUD_DEPTH).setVisible(false)

    // Start screen (first attempt only).
    {
      const title = label(this, 'RIVAL', 44, UI.accent)
      title.setY(-96)
      const sub = label(this, 'one lap · one input', 15, UI.dim)
      sub.setY(-58)
      const how = label(this, 'hold to turn left\nrelease to turn right', 16)
      how.setY(-14)
      this.menuRival = label(this, '', 16)
      this.menuRival.setY(34)
      this.menuBest = label(this, '', 14, UI.dim)
      this.menuBest.setY(58)
      const go = button(this, 'START', 200, 46, () => this.startCountdown(), true)
      go.container.setY(104)
      const key = label(this, 'or press space', 12, UI.dim)
      key.setY(140)
      this.menuPanel = this.add
        .container(0, 0, [backdrop(this, 340, 320), title, sub, how, this.menuRival, this.menuBest, go.container, key])
        .setDepth(HUD_DEPTH)
        .setVisible(false)
    }

    // Pause.
    {
      const title = label(this, 'PAUSED', 26)
      title.setY(-64)
      const resume = button(this, 'RESUME', 200, 44, () => this.resumeRun(), true)
      resume.container.setY(-6)
      const restart = button(this, 'RESTART', 200, 40, () => this.restartRun())
      restart.container.setY(50)
      this.pausePanel = this.add
        .container(0, 0, [backdrop(this, 300, 200), title, resume.container, restart.container])
        .setDepth(HUD_DEPTH)
        .setVisible(false)
    }

    // End screen: lap time, delta to the ghost, medal, retry.
    {
      this.endTitle = label(this, '', 24)
      this.endTitle.setY(-108)
      this.endTime = label(this, '', 40)
      this.endTime.setY(-62)
      this.endDelta = label(this, '', 17)
      this.endDelta.setY(-20)
      this.endMedal = label(this, '', 20)
      this.endMedal.setY(14)
      this.endNext = label(this, '', 13, UI.dim)
      this.endNext.setY(46)
      this.endButton = button(this, 'RACE AGAIN', 220, 46, () => this.requestReplay(), true)
      this.endButton.container.setY(100)
      const key = label(this, 'or press space', 12, UI.dim)
      key.setY(136)
      this.endPanel = this.add
        .container(0, 0, [
          backdrop(this, 360, 316),
          this.endTitle,
          this.endTime,
          this.endDelta,
          this.endMedal,
          this.endNext,
          this.endButton.container,
          key,
        ])
        .setDepth(HUD_DEPTH)
        .setVisible(false)
    }
  }

  private hidePanels(): void {
    this.dim.setVisible(false)
    this.menuPanel.setVisible(false)
    this.pausePanel.setVisible(false)
    this.endPanel.setVisible(false)
  }

  /**
   * Camera zoom scales scrollFactor-0 objects too, so the HUD gets its own
   * camera at zoom 1. Everything at HUD_DEPTH is HUD; the rest is world.
   */
  private splitCameras(): void {
    this.hudCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    const hud = this.children.list.filter((o) => (o as unknown as { depth: number }).depth === HUD_DEPTH)
    const world = this.children.list.filter((o) => (o as unknown as { depth: number }).depth !== HUD_DEPTH)
    this.cameras.main.ignore(hud)
    this.hudCam.ignore(world)
  }

  private layout(): void {
    const w = this.scale.width
    const h = this.scale.height
    this.hudCam.setSize(w, h)
    // Zoom so the car reads at phone size and the next corner is in view on desktop.
    const zoom = Phaser.Math.Clamp(Math.min(w, h) / 560, 0.7, 1.5)
    this.cameras.main.setZoom(zoom)

    this.hudLap.setPosition(w / 2, 12)
    this.hudSplit.setPosition(w / 2, 50)
    this.hudChecks.setPosition(w / 2, 82)
    this.hudRival.setPosition(14, 12)
    this.hudMessage.setPosition(w / 2, h * 0.3)
    this.hudHint.setPosition(w / 2, h - 14)
    this.pauseButton.container.setPosition(w - 36, 28)
    this.dim.setSize(w, h)
    const cy = h / 2
    this.menuPanel.setPosition(w / 2, cy)
    this.pausePanel.setPosition(w / 2, cy)
    this.endPanel.setPosition(w / 2, cy)
    // Small screens: scale panels down rather than clip.
    const ps = Phaser.Math.Clamp(Math.min(w / 380, h / 360), 0.6, 1)
    this.menuPanel.setScale(ps)
    this.pausePanel.setScale(ps)
    this.endPanel.setScale(ps)
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    // One boolean. Pointer (touch and mouse) and keyboard both feed it.
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', () => {
      if (this.state === 'menu') {
        this.startCountdown()
        return
      }
      this.pointerHeld += 1
    })
    const release = (): void => {
      this.pointerHeld = Math.max(0, this.pointerHeld - 1)
    }
    this.input.on('pointerup', release)
    this.input.on('pointerupoutside', release)
    // Belt and braces: a pointer released outside the canvas, or a tab switch,
    // must never leave the car stuck turning. A hidden tab also pauses.
    window.addEventListener('pointercancel', () => (this.pointerHeld = 0))
    window.addEventListener('blur', () => (this.pointerHeld = 0))
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pointerHeld = 0
        this.pauseRun()
      }
    })

    const kb = this.input.keyboard
    if (kb) {
      const codes = Phaser.Input.Keyboard.KeyCodes
      this.keys = [codes.SPACE, codes.UP, codes.DOWN, codes.LEFT, codes.RIGHT, codes.W].map((c) => kb.addKey(c, true))
      // The primary key doubles as "go" on the panels.
      kb.on('keydown-SPACE', () => this.primaryAction())
      kb.on('keydown-ENTER', () => this.primaryAction())
      kb.on('keydown-ESC', () => this.togglePause())
      kb.on('keydown-P', () => this.togglePause())
    }
  }

  private primaryAction(): void {
    if (this.paused) this.resumeRun()
    else if (this.state === 'menu') this.startCountdown()
    else if (this.state === 'finished' && this.endPanel.visible) this.requestReplay()
  }

  private togglePause(): void {
    if (this.paused) this.resumeRun()
    else this.pauseRun()
  }

  private readTurning(): boolean {
    if (this.autodrive && this.state === 'racing') {
      return decide(this.car, this.track, this.params, AUTODRIVE_SKILL, this.frame)
    }
    if (this.pointerHeld > 0) return true
    for (const k of this.keys) if (k.isDown) return true
    return false
  }

  // ------------------------------------------------------------------- loop

  update(_time: number, delta: number): void {
    const live = this.state === 'countdown' || this.state === 'racing'
    if (!live || this.paused) {
      this.updateHud()
      return
    }
    if (this.resumeGrace > 0) {
      // Hold the world still for a beat after resume so the player can re-read it.
      this.resumeGrace -= 1
      this.showMessage(this.resumeGrace > 0 ? 'ready' : 'GO', this.resumeGrace > 0 ? Infinity : 500)
      this.updateHud()
      return
    }

    // Clamp a long stall (tab hidden, debugger) so we do not spiral catching up.
    this.accumulator += Math.min(delta, 250)
    while (this.accumulator >= STEP_MS && (this.state === 'countdown' || this.state === 'racing')) {
      this.step()
      this.accumulator -= STEP_MS
    }
    const alpha = this.accumulator / STEP_MS
    this.renderCars(alpha)
    this.updateCamera(delta)
    this.updateHud()
  }

  private step(): void {
    copyCar(this.car, this.prevCar)
    this.turningNow = this.readTurning()
    const moving = this.state === 'racing'
    stepCar(this.car, this.params, this.track, this.turningNow, moving, STEP)
    this.frame += 1

    if (this.state === 'countdown') {
      if (this.frame === 30) this.showMessage('2', Infinity)
      else if (this.frame === 60) this.showMessage('1', Infinity)
      else if (this.frame >= COUNTDOWN_FRAMES) {
        this.state = 'racing'
        this.goFrame = this.frame
        this.lap.armed = true
        this.lap.startFrame = this.frame
        this.showMessage('GO', 700)
        this.ghostSprite.setVisible(this.ghost !== null)
      }
      return
    }

    const t = this.frame - this.goFrame
    recordStep(this.recorder, t, this.car.x, this.car.y, this.car.heading)

    const events = stepLap(this.lap, this.track, this.car.near.s, this.car.near.dist, this.frame, this.params.speed, STEP)
    for (const e of events) {
      if (e.type === 'checkpoint') {
        this.updateChecks()
        this.showSplit(e.index, t)
      } else {
        this.finishLap(e.valid, e.frames)
        return
      }
    }
    this.leaveMarks()
  }

  private showSplit(index: number, t: number): void {
    const g = this.ghost
    if (!g) return
    const delta = (t - g.checkpointFrames[index]) * STEP_MS
    this.hudSplit.setText(formatDelta(delta)).setColor(delta <= 0 ? UI.good : UI.bad)
    this.splitUntil = this.time.now + 1500
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

  private renderCars(alpha: number): void {
    const a = this.prevCar
    const b = this.car
    const x = a.x + (b.x - a.x) * alpha
    const y = a.y + (b.y - a.y) * alpha
    const heading = lerpAngle(a.heading, b.heading, alpha)
    this.carSprite.setPosition(x, y)
    this.carSprite.setRotation(heading)
    this.carSprite.setTint(b.offTrack ? 0xd9d9d9 : 0xffffff)

    // Ghost: same clock as the car — frames since GO, plus render alpha.
    const g = this.ghost
    if (g && this.ghostSprite.visible && this.state === 'racing') {
      const t = this.frame - this.goFrame + alpha
      poseAt(g.lap, t, this.ghostPose)
      this.ghostSprite.setPosition(this.ghostPose.x, this.ghostPose.y).setRotation(this.ghostPose.heading)
      // Once it has finished, fade it out of the way of the line.
      if (t > g.frames) this.ghostSprite.setAlpha(Math.max(0, 0.42 - (t - g.frames) * 0.01))
    }
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
    if (this.state === 'racing') this.hudLap.setText(formatMs((this.frame - this.goFrame) * STEP_MS))
    const now = this.time.now
    if (this.messageUntil !== Infinity && now > this.messageUntil && this.hudMessage.text) this.hudMessage.setText('')
    if (now > this.splitUntil && this.hudSplit.text) this.hudSplit.setText('')
  }

  private updateChecks(): void {
    const n = this.track.checkpointS.length
    let s = ''
    for (let i = 0; i < n; i++) s += i < this.lap.next ? '●' : '○'
    this.hudChecks.setText(s)
  }

  private showMessage(text: string, durationMs: number, size = 40): void {
    this.hudMessage.setText(text).setFontSize(size)
    this.messageUntil = durationMs === Infinity ? Infinity : this.time.now + durationMs
  }
}
