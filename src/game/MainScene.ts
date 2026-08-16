import Phaser from 'phaser'
import type {
  SessionEndResult,
  SessionStartContext,
} from '../host/GameHost'

export type { SessionEndResult, SessionStartContext }

/**
 * Small complete loop: tap / click / space to score, survive until the timer
 * ends. Demonstrates pointer, touch, and keyboard for desktop + mobile targets.
 *
 * The game owns its whole run, including the ending: when time runs out it
 * reports the result through the end handler and paints its own game-over
 * screen. "Play again" fires the replay handler — the host answers with a new
 * session, which arrives through `beginSession` and resets everything.
 */
export class MainScene extends Phaser.Scene {
  private sessionId: string | null = null
  private score = 0
  private startedAt = 0
  private playing = false
  private timeLeft = 20
  private scoreText!: Phaser.GameObjects.Text
  private statusText!: Phaser.GameObjects.Text
  private timerText!: Phaser.GameObjects.Text
  private orb!: Phaser.GameObjects.Arc
  private gameOver!: Phaser.GameObjects.Container
  private gameOverScore!: Phaser.GameObjects.Text
  private endHandler: ((result: SessionEndResult) => void) | null = null
  private replayHandler: (() => void) | null = null
  private tick?: Phaser.Time.TimerEvent

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
    const { width, height } = this.scale

    this.add
      .rectangle(0, 0, width * 2, height * 2, 0x0b0d12)
      .setOrigin(0)

    this.scoreText = this.add
      .text(16, 16, 'Score 0', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#e8eaed',
      })
      .setScrollFactor(0)

    this.timerText = this.add
      .text(16, 48, 'Time —', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#9aa3b2',
      })
      .setScrollFactor(0)

    this.statusText = this.add
      .text(width / 2, height / 2, 'Waiting for host session…', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#6c8cff',
        align: 'center',
      })
      .setOrigin(0.5)

    this.orb = this.add.circle(width / 2, height * 0.62, 42, 0x6c8cff)
    this.orb.setStrokeStyle(3, 0xffffff, 0.35)
    this.orb.setInteractive({ useHandCursor: true })
    this.orb.setVisible(false)

    this.createGameOverScreen()

    this.orb.on('pointerdown', () => this.registerHit())
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.gameOver.visible) this.requestReplay()
      else this.registerHit()
    })
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.gameOver.visible) this.requestReplay()
      else this.finish('completed')
    })

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.statusText.setPosition(gameSize.width / 2, gameSize.height / 2)
      this.gameOver.setPosition(gameSize.width / 2, gameSize.height / 2)
      if (!this.playing) {
        this.orb.setPosition(gameSize.width / 2, gameSize.height * 0.62)
      }
    })
  }

  beginSession(ctx: SessionStartContext): void {
    this.sessionId = ctx.sessionId
    this.score = 0
    this.timeLeft = 20
    this.startedAt = Date.now()
    this.playing = true
    this.gameOver.setVisible(false)
    this.scoreText.setText('Score 0')
    this.timerText.setText('Time 20s')
    this.statusText.setText(
      ctx.attempt > 1
        ? `Run ${ctx.attempt} — beat your last score`
        : 'Tap the orb · Space works too · Enter to finish early',
    )
    this.orb.setVisible(true)
    this.placeOrb()

    this.tick?.remove(false)
    this.tick = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.playing) return
        this.timeLeft -= 1
        this.timerText.setText(`Time ${this.timeLeft}s`)
        if (this.timeLeft <= 0) {
          this.finish('completed')
        }
      },
    })
  }

  abortSession(): void {
    // The host gave up on this session — stop quietly, without a result.
    this.playing = false
    this.sessionId = null
    this.tick?.remove(false)
    this.orb.setVisible(false)
    this.gameOver.setVisible(false)
    this.statusText.setText('Session ended by host')
  }

  private createGameOverScreen(): void {
    const { width, height } = this.scale

    const panel = this.add.rectangle(0, 0, 320, 190, 0x161a24, 0.96)
    panel.setStrokeStyle(2, 0x6c8cff, 0.6)

    const title = this.add
      .text(0, -60, 'Run complete', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        color: '#e8eaed',
      })
      .setOrigin(0.5)

    this.gameOverScore = this.add
      .text(0, -18, 'Score 0', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#9aa3b2',
      })
      .setOrigin(0.5)

    const replay = this.add
      .text(0, 44, 'Play again', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#0b0d12',
        backgroundColor: '#6c8cff',
        padding: { x: 22, y: 10 },
      })
      .setOrigin(0.5)
    replay.setInteractive({ useHandCursor: true })
    replay.on('pointerdown', () => this.requestReplay())

    this.gameOver = this.add.container(width / 2, height / 2, [
      panel,
      title,
      this.gameOverScore,
      replay,
    ])
    this.gameOver.setDepth(10)
    this.gameOver.setVisible(false)
  }

  private requestReplay(): void {
    // Fire-and-forget: the host answers with a fresh session.start, which
    // lands in beginSession and resets the run.
    this.replayHandler?.()
  }

  private registerHit(): void {
    if (!this.playing) return
    this.score += 1
    this.scoreText.setText(`Score ${this.score}`)
    this.placeOrb()
    this.tweens.add({
      targets: this.orb,
      scale: { from: 1.15, to: 1 },
      duration: 120,
    })
  }

  private placeOrb(): void {
    const pad = 56
    const w = this.scale.width
    const h = this.scale.height
    const x = Phaser.Math.Between(pad, Math.max(pad + 1, Math.floor(w - pad)))
    const y = Phaser.Math.Between(
      Math.floor(h * 0.35),
      Math.max(Math.floor(h * 0.35) + 1, Math.floor(h - pad)),
    )
    this.orb.setPosition(x, y)
  }

  private finish(outcome: SessionEndResult['outcome']): void {
    if (!this.playing || !this.sessionId) return
    this.playing = false
    this.tick?.remove(false)
    this.orb.setVisible(false)
    this.statusText.setText('')

    const result: SessionEndResult = {
      sessionId: this.sessionId,
      outcome,
      score: this.score,
      durationMs: Date.now() - this.startedAt,
    }
    this.sessionId = null

    // Report the result first, then show the game-owned game-over screen.
    this.endHandler?.(result)
    this.gameOverScore.setText(`Score ${this.score}`)
    this.gameOver.setPosition(this.scale.width / 2, this.scale.height / 2)
    this.gameOver.setVisible(true)
  }
}
