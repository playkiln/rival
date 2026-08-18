/**
 * GameHost — the bridge between the Playkiln host bus and the game engine.
 *
 * These two run on different clocks:
 *
 *   Playkiln host bus  ⊥  Phaser scene graph
 *        (sync, early)      (async, later)
 *
 * The host can send `session.start` the instant the game reports `ready`, but a
 * Phaser scene is not usable until the engine has booted and run `create()`.
 * Anything that assumes those line up drops sessions or throws on a null scene.
 *
 * So this controller owns exactly one job: accept host events immediately, and
 * hold them until a scene exists to receive them. Nothing here knows about
 * gameplay, and the scene knows nothing about postMessage.
 *
 * The session lifecycle is game-owned end to end: the host starts a session,
 * the scene plays it, reports its result through `sessionEnd`, and paints its
 * own game-over screen. "Play again" is `requestNewSession()` — a fire-and-
 * forget request the host answers with a fresh `session.start`.
 *
 * Deliberately free of Phaser imports — it binds to any object implementing
 * `GameSceneBinding`, which keeps it unit-testable without an engine.
 */

import type { Progress } from '../game/progress'
import type { SaveStore } from './SaveStore'

export type SessionEndResult = {
  sessionId: string
  outcome: 'completed' | 'failed' | 'quit'
  score?: number
  durationMs?: number
}

export type SessionStartContext = {
  sessionId: string
  attempt: number
}

/** The subset of the Playkiln SDK this controller uses. */
export type PlaykilnHost = {
  loading(progress?: number): void
  ready(): void
  sessionEnd(result: SessionEndResult): void
  requestNewSession(): void
  onSessionStart(handler: (ctx: SessionStartContext) => void): () => void
  onTerminate(handler: () => void): () => void
  getAudio(): { muted: boolean }
  onAudioChange(handler: (audio: { muted: boolean }) => void): () => void
  reportError?(error: {
    message: string
    fatal?: boolean
    details?: string
  }): void
}

/** What the controller needs from a playable scene. */
export type GameSceneBinding = {
  setEndHandler(handler: (result: SessionEndResult) => void): void
  setReplayHandler(handler: () => void): void
  /** Progress recovered from the save document. Called before the first session. */
  setProgress(progress: Progress): void
  /** Called when progress changed in a way worth persisting — best or medal. */
  setSaveHandler(handler: (progress: Progress) => void): void
  beginSession(ctx: SessionStartContext): void
  abortSession(): void
}

export class GameHost {
  private readonly host: PlaykilnHost
  private saves: SaveStore | null = null
  private restored: Progress | null = null
  private scene: GameSceneBinding | null = null
  private pendingSession: SessionStartContext | null = null
  private terminated = false

  constructor(host: PlaykilnHost) {
    this.host = host
  }

  /**
   * Hand the controller its save store, once `init()` has said whether this
   * host has storage at all. Never called ⇒ the game runs medals-only, which
   * is a complete game and not an error state.
   */
  useSaves(saves: SaveStore): void {
    this.saves = saves
  }

  /**
   * Read the save document, before `ready()`.
   *
   * Reading after `ready()` would let the host start session one while the
   * scene still holds a blank ladder — the player's first lap of the visit
   * would race the bronze ghost and their own best would appear only on the
   * second. Never resolves to a rejection: no saves, a first-time player and an
   * unreadable document are all just "start fresh".
   */
  async restoreProgress(): Promise<void> {
    this.restored = (await this.saves?.load()) ?? null
  }

  /**
   * Subscribe to the host bus.
   *
   * Call this before creating the engine. Handlers registered after `ready()`
   * race against the host's first `session.start`; handlers registered after a
   * throwing engine bind never exist at all.
   */
  attachHostHandlers(): void {
    this.host.onSessionStart((ctx) => {
      // Queue unconditionally. The scene may not exist yet, and a session that
      // arrives during boot must still be played, not dropped.
      this.pendingSession = ctx
      this.flushPendingSession()
    })

    this.host.onTerminate(() => {
      // A session queued but never started is simply cancelled — starting it
      // after the host gave up would resurrect a dead session. After terminate
      // the game goes quiet: no results, no replay requests.
      this.terminated = true
      this.pendingSession = null
      this.scene?.abortSession()
    })
  }

  /** Wire the scene and start any session the host sent while booting. */
  bindScene(scene: GameSceneBinding): void {
    this.scene = scene

    // Before any handler that can start a run: the first session must already
    // see the restored ladder.
    if (this.restored) scene.setProgress(this.restored)

    scene.setSaveHandler((progress) => {
      if (this.terminated) return
      this.saves?.save(progress)
    })

    scene.setEndHandler((result) => {
      if (this.terminated) return
      this.host.sessionEnd(result)
    })

    // The game-over screen's "Play again" — the host answers with a new
    // session.start, which lands back in onSessionStart above.
    scene.setReplayHandler(() => {
      if (this.terminated) return
      this.host.requestNewSession()
    })

    this.flushPendingSession()
  }

  /** Start a queued session, if there is one and a scene to run it. */
  flushPendingSession(): void {
    const scene = this.scene
    const ctx = this.pendingSession
    if (!scene || !ctx) return

    this.pendingSession = null
    scene.beginSession(ctx)
  }

  hasScene(): boolean {
    return this.scene !== null
  }

  hasPendingSession(): boolean {
    return this.pendingSession !== null
  }

  /**
   * Report a boot failure to the host.
   *
   * Note what this does *not* do: call `ready()`. `ready` means "I can accept
   * sessions", and a game whose engine failed to bind cannot. Reporting the
   * error tells the host immediately and truthfully; claiming readiness would
   * trade a clear failure for a session that mysteriously never starts.
   */
  reportFatal(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof Error ? error.stack : undefined
    this.host.reportError?.({ message, fatal: true, details })
  }
}
