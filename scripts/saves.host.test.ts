/**
 * SaveStore and GameHost against a fake host bus.
 *
 * These cover the obligations that only show up at the seam with the platform,
 * where the game's own tests cannot reach: a host with no storage, a document
 * that will not parse, a write that fails, a document over the limit, and the
 * ordering rule that the save is read before the first session is playable.
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GameHost, type GameSceneBinding, type SessionEndResult, type SessionStartContext } from '../src/host/GameHost'
import { SaveStore } from '../src/host/SaveStore'
import { MEDAL_GHOSTS } from '../src/game/ghosts'
import { applyLap, createProgress, serialiseProgress, type Progress } from '../src/game/progress'
import { decodeLap } from '../src/game/sim/recording'

const lap = decodeLap(MEDAL_GHOSTS.bronze.lap)

function progressWithBest(ms: number): Progress {
  const p = createProgress()
  applyLap(p, ms, lap)
  return p
}

type FakeHost = ReturnType<typeof fakeHost>

function fakeHost(options: { doc?: string | null; failGet?: boolean; failSet?: boolean } = {}) {
  const errors: { message: string; fatal?: boolean }[] = []
  const writes: string[] = []
  let doc = options.doc ?? null
  return {
    errors,
    writes,
    current: () => doc,
    storage: {
      async get(): Promise<string | null> {
        if (options.failGet) throw new Error('storage_failed')
        return doc
      },
      async set(value: string): Promise<void> {
        if (options.failSet) throw new Error('storage_failed')
        writes.push(value)
        doc = value
      },
    },
    reportError(error: { message: string; fatal?: boolean }): void {
      errors.push(error)
    },
  }
}

const LIMIT = { maxBytes: 65536 }

test('a host with no storage yields no save, no write and no error', async () => {
  const host = fakeHost({ doc: JSON.stringify(serialiseProgress(progressWithBest(26000))) })
  const store = new SaveStore(host, undefined)
  assert.equal(store.enabled, false)
  assert.equal(await store.load(), null)
  store.save(progressWithBest(25000))
  await store.flush()
  assert.deepEqual(host.writes, [])
  assert.deepEqual(host.errors, [])
})

test('a saved document comes back as progress', async () => {
  const host = fakeHost({ doc: JSON.stringify(serialiseProgress(progressWithBest(26000))) })
  const restored = await new SaveStore(host, LIMIT).load()
  assert.equal(restored?.bestMs, 26000)
  assert.deepEqual(restored?.medals, ['bronze'])
})

test('a first-time player reads null without an error', async () => {
  const host = fakeHost({ doc: null })
  assert.equal(await new SaveStore(host, LIMIT).load(), null)
  assert.deepEqual(host.errors, [])
})

test('a corrupt document reads as absent and is overwritten by the next best', async () => {
  const host = fakeHost({ doc: '{ this is not json' })
  const store = new SaveStore(host, LIMIT)
  assert.equal(await store.load(), null)
  store.save(progressWithBest(26000))
  await store.flush()
  assert.equal(host.writes.length, 1)
  assert.equal(JSON.parse(host.writes[0]).bestMs, 26000)
})

test('a read failure is non-fatal and still lets the game start', async () => {
  const host = fakeHost({ failGet: true })
  assert.equal(await new SaveStore(host, LIMIT).load(), null)
  assert.equal(host.errors.length, 1)
  assert.equal(host.errors[0].fatal, false)
})

test('a write failure is reported non-fatally, once, and never throws', async () => {
  const host = fakeHost({ failSet: true })
  const store = new SaveStore(host, LIMIT)
  store.save(progressWithBest(26000))
  store.save(progressWithBest(25000))
  await store.flush()
  assert.equal(host.errors.length, 1, 'a broken save must not spam the host')
  assert.equal(host.errors[0].fatal, false)
})

test('a document over the limit is refused here rather than at the host', async () => {
  const host = fakeHost()
  const store = new SaveStore(host, { maxBytes: 128 })
  store.save(progressWithBest(26000))
  await store.flush()
  assert.deepEqual(host.writes, [])
  assert.equal(host.errors.length, 1)
  assert.match(host.errors[0].message, /too large/)
})

test('writes land in order, so the last personal best is the one stored', async () => {
  const host = fakeHost()
  const store = new SaveStore(host, LIMIT)
  store.save(progressWithBest(26000))
  store.save(progressWithBest(24000))
  await store.flush()
  assert.equal(host.writes.length, 2)
  assert.equal(JSON.parse(host.current() as string).bestMs, 24000)
})

// ------------------------------------------------------------------ GameHost

function fakeScene() {
  const scene = {
    progress: null as Progress | null,
    sessions: [] as SessionStartContext[],
    save: null as ((p: Progress) => void) | null,
    setEndHandler(_: (r: SessionEndResult) => void) {},
    setReplayHandler(_: () => void) {},
    setProgress(p: Progress) {
      scene.progress = p
    },
    setSaveHandler(handler: (p: Progress) => void) {
      scene.save = handler
    },
    beginSession(ctx: SessionStartContext) {
      scene.sessions.push(ctx)
    },
    abortSession() {},
  }
  return scene satisfies GameSceneBinding & Record<string, unknown>
}

function fakeBus(host: FakeHost) {
  const bus = {
    started: [] as SessionStartContext[],
    fire: null as ((ctx: SessionStartContext) => void) | null,
    loading(_?: number) {},
    ready() {},
    sessionEnd(_: SessionEndResult) {},
    requestNewSession() {},
    onSessionStart(handler: (ctx: SessionStartContext) => void) {
      bus.fire = handler
      return () => {}
    },
    onTerminate(_: () => void) {
      return () => {}
    },
    getAudio() {
      return { muted: false }
    },
    onAudioChange(_: (a: { muted: boolean }) => void) {
      return () => {}
    },
    reportError: host.reportError,
  }
  return bus
}

test('the restored ladder reaches the scene before its first session', async () => {
  const host = fakeHost({ doc: JSON.stringify(serialiseProgress(progressWithBest(26000))) })
  const game = new GameHost(fakeBus(host))
  game.useSaves(new SaveStore(host, LIMIT))
  game.attachHostHandlers()
  await game.restoreProgress()

  const scene = fakeScene()
  game.bindScene(scene)
  assert.equal(scene.progress?.bestMs, 26000)
})

test('a session that arrives during boot is played, with the save already applied', async () => {
  const host = fakeHost({ doc: JSON.stringify(serialiseProgress(progressWithBest(26000))) })
  const bus = fakeBus(host)
  const game = new GameHost(bus)
  game.useSaves(new SaveStore(host, LIMIT))
  game.attachHostHandlers()
  await game.restoreProgress()

  // The host jumps the gun: session.start before the scene exists.
  bus.fire?.({ sessionId: 's1', attempt: 1 })

  const scene = fakeScene()
  game.bindScene(scene)
  assert.equal(scene.progress?.bestMs, 26000, 'progress must be set before the queued session runs')
  assert.deepEqual(
    scene.sessions.map((s) => s.sessionId),
    ['s1'],
  )
})

test('the scene save handler writes through to the host', async () => {
  const host = fakeHost()
  const game = new GameHost(fakeBus(host))
  const store = new SaveStore(host, LIMIT)
  game.useSaves(store)
  game.attachHostHandlers()
  await game.restoreProgress()

  const scene = fakeScene()
  game.bindScene(scene)
  scene.save?.(progressWithBest(25000))
  await store.flush()
  assert.equal(JSON.parse(host.writes[0]).bestMs, 25000)
})

test('a host that never gets a store runs medals-only without error', async () => {
  const host = fakeHost()
  const game = new GameHost(fakeBus(host))
  game.attachHostHandlers()
  await game.restoreProgress()

  const scene = fakeScene()
  game.bindScene(scene)
  assert.equal(scene.progress, null)
  scene.save?.(progressWithBest(25000))
  assert.deepEqual(host.writes, [])
  assert.deepEqual(host.errors, [])
})
