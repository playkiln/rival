import Phaser from 'phaser'
import type { SessionEndResult, SessionStartContext } from '../host/GameHost'
import { GameAudio } from './GameAudio'
import type { MedalKey } from './ghosts'
import { MEDAL_ORDER, applyLap, createProgress, rivalFor, type Progress, type Rival } from './progress'
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
import { nextVolume, volumeLabel } from './settings'
import { buildTrack, type Track } from './sim/track'
import { CAR_LENGTH, CAR_WIDTH, COLORS, drawTrack, makeCarTexture } from './TrackRenderer'
import { TRACK } from './track-data'
import { UI, backdrop, button, label, settingRow, type Button, type SettingRow } from './ui/widgets'

export type { SessionEndResult, SessionStartContext }

/** Fixed simulation step — 60 Hz, never driven by the frame delta. */
const STEP_MS = 1000 / 60
const STEP = STEP_MS / 1000
/** Frames of countdown before the car moves. */
const COUNTDOWN_FRAMES = 90
/** Milliseconds of grace after resuming from pause before the sim runs again. Wall time, not frames — the sim is paused, so nothing else ticks. */
const RESUME_MS = 750
/** Depth reserved for HUD objects; the camera split keys off it. */
const HUD_DEPTH = 20
/** One footprint for every panel, so a single frame image can dress them all. */
const PANEL_W = 360
const PANEL_H = 340
/** The end screen's primary is inert this long after it appears, so mashing the turn key at the line cannot skip the result unseen. */
const END_GUARD_MS = 400

const MEDAL_LABEL: Record<MedalKey, string> = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD' }
const MEDAL_COLOR: Record<MedalKey, string> = { bronze: UI.bronze, silver: UI.silver, gold: UI.gold }
/** One chime, pitched up per tier. */
const MEDAL_RATE: Record<MedalKey, number> = { bronze: 1, silver: 1.19, gold: 1.5 }

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
/** Why the next session was asked for — decides whether it lands on the menu or straight on the grid. */
type Intent = 'menu' | 'race'

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
 *   session.start → main menu → countdown → racing → finish → sessionEnd
 *   → end screen → "race again" → requestNewSession → session.start → countdown
 *
 * Whether a session lands on the menu or on the grid is decided by the intent
 * left behind when it was requested, never by the host's attempt counter: the
 * player can always get back to the menu, on any attempt.
 *
 * The scene knows nothing about postMessage: it is driven through
 * beginSession / abortSession and reports through the end/replay handlers.
 * The simulation runs on a fixed 60 Hz accumulator; the ghost is played back
 * against the same frame count, so the two cannot drift.
 */
export class MainScene extends Phaser.Scene {
  private endHandler: ((result: SessionEndResult) => void) | null = null
  private replayHandler: (() => void) | null = null
  private saveHandler: ((progress: Progress) => void) | null = null
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
  private nextIntent: Intent = 'menu'
  private settingsOpen = false
  private settingsReturn: 'menu' | 'pause' = 'menu'
  private endReadyAt = 0
  private resumeGraceMs = 0
  private frame = 0
  private goFrame = 0
  private accumulator = 0
  private autodrive = false

  private pointerHeld = 0
  private keys: Phaser.Input.Keyboard.Key[] = []
  private turningNow = false

  private audio!: GameAudio
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
  private menuMedals: Phaser.GameObjects.Text[] = []
  private pausePanel!: Phaser.GameObjects.Container
  private settingsPanel!: Phaser.GameObjects.Container
  private settingsRows!: { music: SettingRow; musicVol: SettingRow; sound: SettingRow; soundVol: SettingRow }
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

  /**
   * Adopt progress restored from the save document.
   *
   * Called before the first session, so the menu already shows the right best
   * and `beginSession` picks the right rival. On a host without storage this
   * never fires and the scene keeps the blank ladder it was created with — the
   * medal ghosts make that a complete game rather than a degraded one.
   */
  setProgress(progress: Progress): void {
    this.progress = progress
    // The scene may not have run create() yet; showMenu() paints this anyway.
    if (this.menuBest) this.paintMenu()
    this.audio?.setPreferences(progress.prefs)
  }

  setSaveHandler(handler: (progress: Progress) => void): void {
    this.saveHandler = handler
  }

  private bestLabel(): string {
    return this.progress.bestMs === null ? '' : `Your best ${formatMs(this.progress.bestMs)}`
  }

  preload(): void {
    GameAudio.queueAssets(this.load)
  }

  create(): void {
    this.audio = new GameAudio(this, this.progress.prefs)
    // Every button announces its press here rather than knowing about audio.
    this.events.on('ui:tap', () => this.audio.playSfx('ui-tap'))
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
    // Captioned: uncaptioned "BRONZE 0:27.617" in bronze reads as a medal the
    // player already holds rather than the time they are chasing.
    this.hudRival.setText(`RIVAL ${this.rivalLabel()}`)
    this.hudRival.setColor(this.rival.kind === 'medal' ? MEDAL_COLOR[this.rival.medal] : UI.accent)
    this.hidePanels()
    const intent = this.nextIntent
    this.nextIntent = 'menu'
    if (intent === 'race') this.startCountdown()
    else this.showMenu()
  }

  abortSession(): void {
    // The host gave up on this session — stop quietly, without a result.
    this.state = 'idle'
    this.paused = false
    this.sessionId = null
    this.audio.stopAll()
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
    this.resumeGraceMs = 0
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
    this.audio.setMusicState('menu')
    this.paintMenu()
    this.dim.setVisible(true)
    this.menuPanel.setVisible(true)
    this.hudHint.setText('')
    this.pauseButton.container.setVisible(false)
    this.showMessage('', 0)
  }

  /** Rival, best and ladder — everything on the menu that progress can change. */
  private paintMenu(): void {
    this.menuRival.setText(this.rival ? `Rival: ${this.rivalLabel()}` : '')
    this.menuRival.setColor(this.rival?.kind === 'medal' ? MEDAL_COLOR[this.rival.medal] : UI.accent)
    this.menuBest.setText(this.bestLabel())
    MEDAL_ORDER.forEach((m, i) => {
      const earned = this.progress.medals.includes(m)
      this.menuMedals[i].setText(earned ? '●' : '○').setColor(earned ? MEDAL_COLOR[m] : UI.dim)
    })
  }

  private startCountdown(): void {
    this.hidePanels()
    this.state = 'countdown'
    this.frame = 0
    this.pointerHeld = 0
    this.hudHint.setText('hold to turn left · release to turn right')
    this.pauseButton.container.setVisible(true)
    this.showMessage('3', Infinity)
    this.audio.setMusicState('race')
    this.audio.startDriving()
    this.audio.playSfx('countdown-tick')
  }

  private finishLap(valid: boolean, lapFrames: number): void {
    if (this.state !== 'racing' || !this.sessionId) return
    this.state = 'finished'
    this.audio.stopDriving()
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
      this.audio.playSfx('lap-invalid')
      this.audio.setMusicState('result')
      this.endTitle.setText('LAP INVALID').setColor(UI.bad)
      this.endTime.setText(formatMs(ms))
      this.endDelta.setText('a checkpoint was missed — the circuit cannot be cut').setColor(UI.dim)
      this.endMedal.setText('')
      this.endNext.setText('')
    } else {
      const outcome = applyLap(this.progress, ms, recording)
      // Persist on a new best or a new medal, and on nothing else. A game that
      // writes on every retry makes a cheap capability look expensive.
      if (outcome.newBest || outcome.earned.length) this.saveHandler?.(this.progress)
      this.audio.playSfx('lap-done')
      if (outcome.newBest) this.audio.playBestSting()
      else this.audio.setMusicState('result')
      if (outcome.earned.length) {
        // The chime lands after the line sound and the sting's first beat, not on top of them.
        const top = outcome.earned[outcome.earned.length - 1]
        this.time.delayedCall(outcome.newBest ? 900 : 500, () => this.audio.playSfx('medal', MEDAL_RATE[top]))
      }
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
    this.endReadyAt = this.time.now + END_GUARD_MS
  }

  /** Ask for the next session. Fire-and-forget: the host answers with a fresh session.start, which lands where `intent` says. */
  private requestReplay(intent: Intent): void {
    this.nextIntent = intent
    this.replayHandler?.()
  }

  /** The end screen's RACE AGAIN, behind the short guard against a mashed finish. */
  private raceAgain(): void {
    if (this.state !== 'finished' || !this.endPanel.visible) return
    if (this.time.now < this.endReadyAt) return
    this.requestReplay('race')
  }

  // ------------------------------------------------------------------ pause

  private pauseRun(): void {
    if (this.paused || (this.state !== 'racing' && this.state !== 'countdown')) return
    this.paused = true
    this.pointerHeld = 0
    this.audio.pauseDriving()
    this.audio.playSfx('pause-in')
    this.audio.setMusicState('menu')
    this.dim.setVisible(true)
    this.pausePanel.setVisible(true)
    this.pauseButton.container.setVisible(false)
  }

  private resumeRun(): void {
    if (!this.paused) return
    this.settingsOpen = false
    this.settingsPanel.setVisible(false)
    this.paused = false
    this.pointerHeld = 0
    this.resumeGraceMs = RESUME_MS
    this.accumulator = 0
    this.audio.playSfx('pause-out')
    this.audio.setMusicState('race')
    this.audio.startDriving()
    this.dim.setVisible(false)
    this.pausePanel.setVisible(false)
    this.pauseButton.container.setVisible(true)
  }

  /**
   * From pause: end this session honestly as a quit, then ask for a fresh one
   * — straight back onto the grid (RESTART) or to the menu (MAIN MENU).
   */
  private quitRun(intent: Intent): void {
    if (!this.paused || !this.sessionId) return
    const result: SessionEndResult = {
      sessionId: this.sessionId,
      outcome: 'quit',
      durationMs: Date.now() - this.sessionStartedAt,
    }
    this.sessionId = null
    this.state = 'finished'
    this.paused = false
    this.audio.stopDriving()
    this.hidePanels()
    this.endHandler?.(result)
    this.requestReplay(intent)
  }

  // --------------------------------------------------------------- settings

  private openSettings(from: 'menu' | 'pause'): void {
    this.settingsOpen = true
    this.settingsReturn = from
    this.paintSettings()
    this.menuPanel.setVisible(false)
    this.pausePanel.setVisible(false)
    this.settingsPanel.setVisible(true)
  }

  private closeSettings(): void {
    if (!this.settingsOpen) return
    this.settingsOpen = false
    this.settingsPanel.setVisible(false)
    if (this.settingsReturn === 'pause' && this.paused) this.pausePanel.setVisible(true)
    else if (this.state === 'menu') this.menuPanel.setVisible(true)
  }

  private paintSettings(): void {
    const p = this.progress.prefs
    this.settingsRows.music.setValue(p.musicEnabled ? 'ON' : 'OFF')
    this.settingsRows.musicVol.setValue(volumeLabel(p.musicVolume))
    this.settingsRows.sound.setValue(p.soundEnabled ? 'ON' : 'OFF')
    this.settingsRows.soundVol.setValue(volumeLabel(p.soundVolume))
  }

  /**
   * A preference changed. Persisted at once — it is a rare, deliberate act,
   * not a per-lap write — and it travels in the same document as the best lap.
   */
  private changePrefs(mutate: (p: Progress['prefs']) => void): void {
    mutate(this.progress.prefs)
    this.paintSettings()
    this.audio.setPreferences(this.progress.prefs)
    this.audio.playSfx('ui-toggle')
    this.saveHandler?.(this.progress)
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
    const panel = (items: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.Container =>
      this.add
        .container(0, 0, [backdrop(this, PANEL_W, PANEL_H), ...items])
        .setDepth(HUD_DEPTH)
        .setVisible(false)

    // Main menu: who you race, what you hold, and the way in.
    {
      const title = label(this, 'RIVAL', 44, UI.accent)
      title.setY(-128)
      const sub = label(this, 'one lap · one input', 15, UI.dim)
      sub.setY(-92)
      const how = label(this, 'hold to turn left · release to turn right', 13, UI.dim)
      how.setY(-66)
      this.menuRival = label(this, '', 16)
      this.menuRival.setY(-30)
      this.menuBest = label(this, '', 14, UI.dim)
      this.menuBest.setY(-6)
      // The ladder: three pips, lit as they are earned. Legible after gold too.
      this.menuMedals = MEDAL_ORDER.map((_, i) => {
        const pip = label(this, '○', 18, UI.dim)
        pip.setPosition((i - 1) * 28, 22)
        return pip
      })
      const go = button(this, 'RACE', 220, 46, () => this.startCountdown(), true)
      go.container.setY(66)
      const settings = button(this, 'SETTINGS', 220, 38, () => this.openSettings('menu'))
      settings.container.setY(116)
      const key = label(this, 'or press space', 12, UI.dim)
      key.setY(150)
      this.menuPanel = panel([title, sub, how, this.menuRival, this.menuBest, ...this.menuMedals, go.container, settings.container, key])
    }

    // Pause.
    {
      const title = label(this, 'PAUSED', 26)
      title.setY(-118)
      const resume = button(this, 'RESUME', 220, 46, () => this.resumeRun(), true)
      resume.container.setY(-52)
      const restart = button(this, 'RESTART', 220, 38, () => this.quitRun('race'))
      restart.container.setY(2)
      const settings = button(this, 'SETTINGS', 220, 38, () => this.openSettings('pause'))
      settings.container.setY(50)
      const menu = button(this, 'MAIN MENU', 220, 38, () => this.quitRun('menu'))
      menu.container.setY(98)
      this.pausePanel = panel([title, resume.container, restart.container, settings.container, menu.container])
    }

    // Settings: audio only. Nothing here may change what a lap time means.
    {
      const title = label(this, 'SETTINGS', 26)
      title.setY(-118)
      const rowW = 280
      const music = settingRow(this, 'MUSIC', rowW, () => this.changePrefs((p) => (p.musicEnabled = !p.musicEnabled)))
      music.container.setY(-58)
      const musicVol = settingRow(this, 'MUSIC VOLUME', rowW, () =>
        this.changePrefs((p) => (p.musicVolume = nextVolume(p.musicVolume))),
      )
      musicVol.container.setY(-16)
      const sound = settingRow(this, 'SOUND', rowW, () => this.changePrefs((p) => (p.soundEnabled = !p.soundEnabled)))
      sound.container.setY(26)
      const soundVol = settingRow(this, 'SOUND VOLUME', rowW, () =>
        this.changePrefs((p) => (p.soundVolume = nextVolume(p.soundVolume))),
      )
      soundVol.container.setY(68)
      this.settingsRows = { music, musicVol, sound, soundVol }
      const back = button(this, 'BACK', 220, 40, () => this.closeSettings(), true)
      back.container.setY(124)
      this.settingsPanel = panel([
        title,
        music.container,
        musicVol.container,
        sound.container,
        soundVol.container,
        back.container,
      ])
    }

    // End screen: lap time, delta to the ghost, medal, retry — and the way back.
    {
      this.endTitle = label(this, '', 24)
      this.endTitle.setY(-122)
      this.endTime = label(this, '', 40)
      this.endTime.setY(-76)
      this.endDelta = label(this, '', 17)
      this.endDelta.setY(-34)
      this.endMedal = label(this, '', 20)
      this.endMedal.setY(0)
      this.endNext = label(this, '', 13, UI.dim)
      this.endNext.setY(32)
      this.endButton = button(this, 'RACE AGAIN', 220, 46, () => this.raceAgain(), true)
      this.endButton.container.setY(84)
      const menu = button(this, 'MENU', 220, 34, () => this.requestReplay('menu'))
      menu.container.setY(128)
      const key = label(this, 'or press space', 12, UI.dim)
      key.setY(158)
      this.endPanel = panel([
        this.endTitle,
        this.endTime,
        this.endDelta,
        this.endMedal,
        this.endNext,
        this.endButton.container,
        menu.container,
        key,
      ])
    }
  }

  private hidePanels(): void {
    this.settingsOpen = false
    this.dim.setVisible(false)
    this.menuPanel.setVisible(false)
    this.pausePanel.setVisible(false)
    this.settingsPanel.setVisible(false)
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
    // Small screens: scale panels down rather than clip.
    const ps = Phaser.Math.Clamp(Math.min(w / (PANEL_W + 20), h / (PANEL_H + 20)), 0.6, 1)
    for (const panel of [this.menuPanel, this.pausePanel, this.settingsPanel, this.endPanel]) {
      panel.setPosition(w / 2, h / 2).setScale(ps)
    }
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    // One boolean. Pointer (touch and mouse) and keyboard both feed it.
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', () => {
      if (this.state === 'menu') {
        // Tap anywhere to race — but not through the settings panel.
        if (!this.settingsOpen) this.startCountdown()
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
        this.audio.setHostPaused(true)
      } else {
        this.audio.setHostPaused(false)
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
    if (this.settingsOpen) return
    if (this.paused) this.resumeRun()
    else if (this.state === 'menu') this.startCountdown()
    else if (this.state === 'finished') this.raceAgain()
  }

  /** Esc / P: back out of settings, otherwise pause or resume. */
  private togglePause(): void {
    if (this.settingsOpen) this.closeSettings()
    else if (this.paused) this.resumeRun()
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
    if (this.resumeGraceMs > 0) {
      // Hold the world still for a beat after resume so the player can re-read it.
      // Counted in wall time so the beat is the same length at any refresh rate.
      this.resumeGraceMs -= Math.min(delta, 250)
      const waiting = this.resumeGraceMs > 0
      this.showMessage(waiting ? 'ready' : 'GO', waiting ? Infinity : 500)
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
    // The countdown car sits still, so the note idles at the bottom of its band and ramps in.
    const c = this.car
    this.audio.updateDriving(this.state === 'racing' ? c.speedScale : 0.55, this.slipAngle(), c.offTrack, delta)
  }

  private step(): void {
    copyCar(this.car, this.prevCar)
    this.turningNow = this.readTurning()
    const moving = this.state === 'racing'
    stepCar(this.car, this.params, this.track, this.turningNow, moving, STEP)
    this.frame += 1

    if (this.state === 'countdown') {
      if (this.frame === 30 || this.frame === 60) {
        this.showMessage(this.frame === 30 ? '2' : '1', Infinity)
        this.audio.playSfx('countdown-tick')
      } else if (this.frame >= COUNTDOWN_FRAMES) {
        this.state = 'racing'
        this.goFrame = this.frame
        this.lap.armed = true
        this.lap.startFrame = this.frame
        this.showMessage('GO', 700)
        this.audio.playSfx('countdown-go')
        this.ghostSprite.setVisible(this.ghost !== null)
        // The lap's t = 0 sample is the grid pose, exactly as the medal ghosts have it.
        recordStep(this.recorder, 0, this.car.x, this.car.y, this.car.heading)
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
    this.audio.playSfx(delta <= 0 ? 'checkpoint-up' : 'checkpoint-down')
  }

  /** How far the velocity and the nose disagree, radians — what both the marks and the tyre sound follow. */
  private slipAngle(): number {
    const c = this.car
    let slip = Math.atan2(c.vy, c.vx) - c.heading
    while (slip > Math.PI) slip -= Math.PI * 2
    while (slip < -Math.PI) slip += Math.PI * 2
    return Math.abs(slip)
  }

  /** Tyre marks when the velocity and the nose disagree — makes slip visible. */
  private leaveMarks(): void {
    const c = this.car
    const strength = this.slipAngle()
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
