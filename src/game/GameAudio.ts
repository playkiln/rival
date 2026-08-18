import Phaser from 'phaser'
import type { Preferences } from './settings'

/**
 * All game audio behind one object: SFX one-shots, three music loops with
 * crossfades, the best-lap sting, and the three driving loops the lap drives
 * continuously — engine by rate, tyres and gravel by gain.
 *
 * Host mute is Phaser `sound.mute` (wired in `main.ts`) and sits above
 * everything here: keep every play and fade on this Sound Manager so the
 * portal's toggle actually silences us, and so unmuting restores whatever
 * the player had chosen. No side AudioContext, per the boot contract.
 *
 * Every play guards on the audio cache, so a missing file means silence,
 * never an error.
 *
 * Categories follow the Preferences split: SFX and the driving loops are
 * gated by the sound settings; the music loops AND the sting by the music
 * settings — the sting is musical feedback, not an effect, and `lap-done`
 * covers the confirmation when music is off.
 */

export type MusicState = 'menu' | 'race' | 'result' | 'off'
type LoopKey = 'music-menu' | 'music-race' | 'music-result'

const STATE_TO_LOOP: Record<Exclude<MusicState, 'off'>, LoopKey> = {
  menu: 'music-menu',
  race: 'music-race',
  result: 'music-result',
}

const SFX_KEYS = [
  'checkpoint-up',
  'checkpoint-down',
  'countdown-tick',
  'countdown-go',
  'lap-done',
  'lap-invalid',
  'medal',
  'ui-tap',
  'ui-toggle',
  'pause-in',
  'pause-out',
] as const

export type SfxKey = (typeof SFX_KEYS)[number]

/** The looping layers under the lap. */
const DRIVE_KEYS = ['engine', 'tyres', 'offtrack'] as const
type DriveKey = (typeof DRIVE_KEYS)[number]

const MUSIC_FILES = {
  'music-menu': 'menu-loop',
  'music-race': 'race-loop',
  'music-result': 'result-loop',
  'sting-best': 'best-sting',
} as const

const CROSSFADE_MS = 300
const STING_DUCK_MS = 120
const RESULT_FADE_IN_MS = 700

/**
 * Engine pitch band. Rival's speed is constant on tarmac and drops to 55%
 * off it, so the note sagging off-track is free, honest feedback — but the
 * band is deliberately narrow: wide swings on a constant-speed car sound
 * broken.
 */
const ENGINE_RATE_MIN = 0.8
const ENGINE_RATE_MAX = 1.15
/** Relative loudness of each driving layer against the SFX volume. */
const DRIVE_GAIN: Record<DriveKey, number> = { engine: 0.5, tyres: 0.55, offtrack: 0.6 }
/** Per-second approach rate of each layer's gain toward its target (frame-rate independent). */
const DRIVE_EASE = 12
/** The whole driving bed fades in over this long from the countdown, so a session never opens with a click. */
const DRIVE_RAMP_MS = 900

export class GameAudio {
  private readonly scene: Phaser.Scene
  private prefs: Preferences
  private musicState: MusicState = 'off'
  private loops: Partial<Record<LoopKey, Phaser.Sound.WebAudioSound>> = {}
  private sting: Phaser.Sound.WebAudioSound | null = null
  private afterSting: (() => void) | null = null

  private drive: Partial<Record<DriveKey, Phaser.Sound.WebAudioSound>> = {}
  private driveTarget: Record<DriveKey, number> = { engine: 0, tyres: 0, offtrack: 0 }
  private driveLevel: Record<DriveKey, number> = { engine: 0, tyres: 0, offtrack: 0 }
  private driveOn = false
  /** 0..1 master over the driving bed: ramps up from the countdown, drops on stop. */
  private driveRamp = 0
  private hostPaused: Phaser.Sound.WebAudioSound[] = []

  constructor(scene: Phaser.Scene, prefs: Preferences) {
    this.scene = scene
    this.prefs = { ...prefs }
  }

  /** Queue every audio asset. */
  static queueAssets(load: Phaser.Loader.LoaderPlugin): void {
    for (const key of SFX_KEYS) load.audio(key, `assets/audio/sfx/${key}.wav`)
    for (const key of DRIVE_KEYS) load.audio(key, `assets/audio/sfx/${key}.wav`)
    for (const [key, file] of Object.entries(MUSIC_FILES)) {
      // Two candidate encodings per track; Phaser takes the first it can play.
      load.audio(key, [`assets/audio/music/${file}.ogg`, `assets/audio/music/${file}.m4a`])
    }
  }

  // -------------------------------------------------------------------- sfx

  playSfx(key: SfxKey, rate = 1): void {
    if (!this.soundOn()) return
    if (!this.scene.cache.audio.exists(key)) return
    this.scene.sound.play(key, { volume: this.prefs.soundVolume, rate })
  }

  // ---------------------------------------------------------- driving loops

  /**
   * Start the driving bed silent; it ramps in over the countdown. Idempotent
   * — a resume after pause calls it again and simply continues.
   */
  startDriving(): void {
    this.driveOn = true
    if (!this.soundOn()) return
    for (const key of DRIVE_KEYS) {
      if (!this.scene.cache.audio.exists(key)) continue
      let s = this.drive[key]
      if (!s) {
        s = this.scene.sound.add(key, { loop: true }) as Phaser.Sound.WebAudioSound
        this.drive[key] = s
      }
      if (s.isPaused) s.resume()
      else if (!s.isPlaying) s.play({ volume: 0 })
    }
    if (this.drive.engine) this.drive.engine.setRate(ENGINE_RATE_MIN)
  }

  /**
   * Per-frame drive of the three layers. `speedScale` is the car's surface
   * multiplier (1 on tarmac, down to 0.55 off it) — the honest speed. `slip`
   * is |velocity angle − heading| in radians. Call with the frame delta so the
   * gain easing is the same at any refresh rate.
   */
  updateDriving(speedScale: number, slip: number, offTrack: boolean, deltaMs: number): void {
    if (!this.driveOn) return
    const dt = Math.min(deltaMs, 100) / 1000
    this.driveRamp = Math.min(1, this.driveRamp + deltaMs / DRIVE_RAMP_MS)
    const rate = ENGINE_RATE_MIN + ((speedScale - 0.55) / 0.45) * (ENGINE_RATE_MAX - ENGINE_RATE_MIN)
    this.drive.engine?.setRate(Phaser.Math.Clamp(rate, ENGINE_RATE_MIN, ENGINE_RATE_MAX))
    this.driveTarget.engine = 1
    // Slip starts to sound at the same threshold the tyre marks start to show.
    this.driveTarget.tyres = offTrack ? 0 : Phaser.Math.Clamp((slip - 0.12) * 3.5, 0, 1)
    this.driveTarget.offtrack = offTrack ? 1 : 0
    const k = 1 - Math.exp(-DRIVE_EASE * dt)
    for (const key of DRIVE_KEYS) {
      this.driveLevel[key] += (this.driveTarget[key] - this.driveLevel[key]) * k
      this.applyDriveVolume(key)
    }
  }

  /** Hold the bed where it is (pause). Nothing rings on. */
  pauseDriving(): void {
    for (const s of Object.values(this.drive)) if (s?.isPlaying) s.pause()
  }

  /** The lap is over, one way or another: the bed goes, and it must not ring over the end screen. */
  stopDriving(): void {
    this.driveOn = false
    this.driveRamp = 0
    for (const key of DRIVE_KEYS) {
      this.driveLevel[key] = 0
      this.driveTarget[key] = 0
      this.drive[key]?.stop()
    }
  }

  private applyDriveVolume(key: DriveKey): void {
    const s = this.drive[key]
    if (!s) return
    s.setVolume(this.driveLevel[key] * this.driveRamp * DRIVE_GAIN[key] * this.prefs.soundVolume)
  }

  // ------------------------------------------------------------------ music

  /**
   * Switch the active loop with a crossfade; no-op if already there.
   *
   * Loops PAUSE on the way out and resume mid-phrase later — nobody should
   * hear the same opening bars every run, and RACE AGAIN must not restart the
   * race loop from bar one. Entering any state also clears a ringing sting
   * (fast replay must not stack music).
   */
  setMusicState(state: MusicState): void {
    this.cancelSting()
    if (state === this.musicState) return
    this.musicState = state

    const targetKey = state === 'off' ? null : STATE_TO_LOOP[state]

    for (const [key, sound] of Object.entries(this.loops)) {
      if (key !== targetKey && sound?.isPlaying) this.fadeOut(sound, CROSSFADE_MS)
    }
    if (targetKey && this.musicOn()) this.fadeInLoop(targetKey, CROSSFADE_MS)
  }

  /**
   * A new personal best: duck everything, fire the sting, and bring the
   * result loop back under it once it has said its piece. Two overlapping
   * pieces of music is mud; the result bed waits.
   */
  playBestSting(): void {
    this.cancelSting()
    this.musicState = 'off'
    for (const sound of Object.values(this.loops)) {
      if (sound?.isPlaying) this.fadeOut(sound, STING_DUCK_MS)
    }
    const resume = (): void => {
      if (this.musicState !== 'off') return // something else took over
      this.musicState = 'result'
      if (this.musicOn()) this.fadeInLoop('music-result', RESULT_FADE_IN_MS)
    }
    if (!this.musicOn() || !this.scene.cache.audio.exists('sting-best')) {
      resume()
      return
    }
    this.sting = this.scene.sound.add('sting-best') as Phaser.Sound.WebAudioSound
    this.afterSting = resume
    this.sting.once('complete', () => {
      this.sting?.destroy()
      this.sting = null
      const next = this.afterSting
      this.afterSting = null
      next?.()
    })
    this.sting.play({ volume: this.prefs.musicVolume })
  }

  // ------------------------------------------------------------------ state

  setPreferences(prefs: Preferences): void {
    // COPY, never alias: the scene mutates its preferences object in place
    // and passes the same reference in. Sharing it would make every "was it
    // on before?" comparison see only the mutated present.
    const musicWasOn = this.musicOn()
    const soundWasOn = this.soundOn()
    this.prefs = { ...prefs }
    const musicOn = this.musicOn()
    const soundOn = this.soundOn()

    for (const sound of Object.values(this.loops)) {
      if (sound?.isPlaying) sound.setVolume(prefs.musicVolume)
    }
    if (this.sting?.isPlaying) this.sting.setVolume(prefs.musicVolume)
    for (const key of DRIVE_KEYS) this.applyDriveVolume(key)

    if (musicWasOn && !musicOn) {
      this.cancelSting()
      for (const sound of Object.values(this.loops)) sound?.stop()
    } else if (!musicWasOn && musicOn && this.musicState !== 'off') {
      this.fadeInLoop(STATE_TO_LOOP[this.musicState], CROSSFADE_MS)
    }

    if (soundWasOn && !soundOn) {
      for (const s of Object.values(this.drive)) s?.stop()
    } else if (!soundWasOn && soundOn && this.driveOn) {
      this.startDriving()
    }
  }

  /**
   * Tab hidden / host pause: everything stops mid-note and resumes in place.
   * Only what was actually playing comes back — `resumeAll` would also wake
   * the loops parked by a crossfade and the driving bed parked under the
   * pause panel.
   */
  setHostPaused(paused: boolean): void {
    if (paused) {
      this.hostPaused = []
      for (const s of this.allSounds()) {
        if (s.isPlaying) {
          s.pause()
          this.hostPaused.push(s)
        }
      }
    } else {
      for (const s of this.hostPaused) if (s.isPaused) s.resume()
      this.hostPaused = []
    }
  }

  /** Terminate or abort: the game goes quiet, audio included. */
  stopAll(): void {
    this.musicState = 'off'
    this.afterSting = null
    this.sting?.destroy()
    this.sting = null
    this.stopDriving()
    this.scene.sound.stopAll()
  }

  // ---------------------------------------------------------------- helpers

  private allSounds(): Phaser.Sound.WebAudioSound[] {
    const out: Phaser.Sound.WebAudioSound[] = []
    for (const s of Object.values(this.loops)) if (s) out.push(s)
    for (const s of Object.values(this.drive)) if (s) out.push(s)
    if (this.sting) out.push(this.sting)
    return out
  }

  private musicOn(): boolean {
    return this.prefs.musicEnabled && this.prefs.musicVolume > 0
  }

  private soundOn(): boolean {
    return this.prefs.soundEnabled && this.prefs.soundVolume > 0
  }

  private fadeInLoop(key: LoopKey, ms: number): void {
    if (!this.scene.cache.audio.exists(key)) return
    let sound = this.loops[key]
    if (!sound) {
      sound = this.scene.sound.add(key, { loop: true }) as Phaser.Sound.WebAudioSound
      this.loops[key] = sound
    }
    this.scene.tweens.killTweensOf(sound)
    if (sound.isPaused) {
      sound.resume() // pick up mid-phrase, not from bar one
    } else if (!sound.isPlaying) {
      sound.play({ volume: 0 })
    }
    this.scene.tweens.add({ targets: sound, volume: this.prefs.musicVolume, duration: ms })
  }

  /** Fade to silence, then pause — position kept for the resume. */
  private fadeOut(sound: Phaser.Sound.WebAudioSound, ms: number): void {
    this.scene.tweens.killTweensOf(sound)
    this.scene.tweens.add({
      targets: sound,
      volume: 0,
      duration: ms,
      onComplete: () => sound.pause(),
    })
  }

  /** Kill a ringing sting and anything queued behind it. */
  private cancelSting(): void {
    this.afterSting = null
    if (!this.sting) return
    const sting = this.sting
    this.sting = null
    if (sting.isPlaying) {
      this.scene.tweens.add({
        targets: sting,
        volume: 0,
        duration: STING_DUCK_MS,
        onComplete: () => sting.destroy(),
      })
    } else {
      sting.destroy()
    }
  }
}
