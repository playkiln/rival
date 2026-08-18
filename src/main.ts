import Phaser from 'phaser'
import { MainScene } from './game/MainScene'
import { GameHost, type PlaykilnHost } from './host/GameHost'
import { SaveStore } from './host/SaveStore'

/**
 * Rival — Playkiln Phaser starter
 *
 * BOOT ORDER — the one thing not to rearrange:
 *
 *   1. init()                    handshake with the host
 *   2. attachHostHandlers()      subscribe BEFORE any engine work that can throw
 *   3. restoreProgress()         read the save — must precede ready(), see below
 *   4. new Phaser.Game(...)      the engine boots asynchronously
 *   5. await game ready + scene  never touch getScene() on the next line
 *   6. bindScene()               wire the scene, flush any queued session
 *   7. ready()                   only now may the host start sessions
 *
 * Step 3 is before `ready()` on purpose: `ready` licenses the host to start
 * session one immediately, and a session that starts before the save is read
 * races the wrong ghost. It never rejects — no storage, no save, and a corrupt
 * save all resolve to "start fresh".
 *
 * Steps 2 and 7 bracket everything fallible. A crash between them leaves the
 * bus alive, so the failure gets reported instead of hanging the host forever.
 *
 * `playkiln preview` prints this sequence in its protocol log. If you do not
 * see `ready` there, boot threw — read the log, not the canvas.
 */

type PlaykilnInit = {
  /** `storage` absent in the HostInfo means this host has no saves at all. */
  init(): Promise<{ audio?: { muted: boolean }; storage?: { maxBytes: number } }>
  getAudio(): { muted: boolean }
  onAudioChange(handler: (audio: { muted: boolean }) => void): () => void
  storage: {
    get(): Promise<string | null>
    set(value: string): Promise<void>
  }
}

const globalSdk = (window as { Playkiln?: PlaykilnHost & PlaykilnInit }).Playkiln
if (!globalSdk) {
  throw new Error(
    'Playkiln SDK missing. Ensure public/playkiln-sdk.js is loaded before the game module.',
  )
}
// Narrowed for the rest of the module after the guard above.
const playkiln = globalSdk

/** How long to wait for Phaser to produce a running scene before giving up. */
const SCENE_TIMEOUT_MS = 10_000

// Built before boot() so the module-level failure path below always has a live
// bus to report through, even if init() itself throws.
const host = new GameHost(playkiln)
let runningGame: Phaser.Game | null = null

function createGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0b0d12',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    input: {
      keyboard: true,
      mouse: true,
      touch: true,
    },
    scene: [MainScene],
  })
}

/** Resolve once the engine has finished booting. */
function waitForGameReady(game: Phaser.Game): Promise<void> {
  if (game.isBooted) return Promise.resolve()
  return new Promise((resolve) => {
    game.events.once('ready', () => resolve())
  })
}

/**
 * Resolve once a scene exists *and* has run `create()`.
 *
 * Both halves matter. `getScene` can hand back an instance whose `create()` has
 * not run yet and whose display objects are still undefined — calling into that
 * is the same crash as calling into null, just one step later.
 */
function waitForScene<T extends Phaser.Scene>(
  game: Phaser.Game,
  key: string,
  timeoutMs = SCENE_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const poll = (): void => {
      const scene = game.scene.getScene(key) as T | null
      if (scene && scene.scene.isActive()) {
        resolve(scene)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(
          new Error(
            `Playkiln boot: scene "${key}" was not running within ${timeoutMs}ms`,
          ),
        )
        return
      }
      requestAnimationFrame(poll)
    }
    poll()
  })
}

/** Last-resort visible failure, for when there is no scene to draw into. */
function showFatalOverlay(message: string): void {
  const el = document.createElement('div')
  el.setAttribute('role', 'alert')
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:#0b0d12',
    'color:#ff8fa0',
    'font:15px/1.5 system-ui, sans-serif',
    'text-align:center',
    'z-index:9999',
  ].join(';')
  el.textContent = `Game failed to start — ${message}`
  document.body.appendChild(el)
}

async function boot(): Promise<void> {
  const info = await playkiln.init()
  let muted = info.audio?.muted === true
  playkiln.onAudioChange((audio) => {
    muted = audio.muted
    if (runningGame) runningGame.sound.mute = muted
  })
  playkiln.loading(0.1)

  // Subscribe first: from here on, a session that arrives is queued, not lost.
  host.attachHostHandlers()
  playkiln.loading(0.3)

  // `info.storage` absent ⇒ this host has no saves. The store handles that
  // itself, so there is no branch here and no medals-only special case.
  host.useSaves(new SaveStore(playkiln, info.storage))
  const restore = host.restoreProgress()

  const game = createGame()
  runningGame = game
  await waitForGameReady(game)
  game.sound.mute = muted
  playkiln.loading(0.7)

  const scene = await waitForScene<MainScene>(game, 'MainScene')
  // Engine boot and the save read overlap; both must be done before bindScene,
  // which is what hands the restored ladder to the scene.
  await restore
  host.bindScene(scene)
  playkiln.loading(1)

  // Only now can this game honor a session.
  playkiln.ready()

  // A host that starts a session the instant it sees `ready` is already covered
  // by the queue; flushing here costs nothing and documents the intent.
  host.flushPendingSession()
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[Playkiln boot]', err)
  // The bus is up (handlers attached before the engine), so the host hears
  // about this immediately rather than waiting on a `ready` that never comes.
  host.reportFatal(err)
  showFatalOverlay(message)
})
