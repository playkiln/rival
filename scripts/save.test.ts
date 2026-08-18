/**
 * Tests for the save document — the format Rival owns and the platform never
 * parses. Two things matter here and nothing else does:
 *
 *   1. A document written by this version reads back as the same progress.
 *   2. **No input breaks the game.** A save is the one piece of state that
 *      arrives from outside and outlives a release, so the parser is total:
 *      every malformed shape yields `null`, meaning "start fresh".
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyLap,
  createProgress,
  parseProgress,
  rivalFor,
  serialiseProgress,
  SAVE_FORMAT_VERSION,
} from '../src/game/progress'
import { MEDAL_GHOSTS } from '../src/game/ghosts'
import { decodeLap, encodeLap, type LapRecording } from '../src/game/sim/recording'

/** A real lap to save: the bronze ghost, which is a genuine recorded lap. */
const lap: LapRecording = decodeLap(MEDAL_GHOSTS.bronze.lap)

function progressWithBest(ms: number): ReturnType<typeof createProgress> {
  const p = createProgress()
  applyLap(p, ms, lap)
  return p
}

function doc(overrides: Record<string, unknown>): string {
  return JSON.stringify({ v: SAVE_FORMAT_VERSION, bestMs: null, ghost: null, medals: [], ...overrides })
}

test('a saved best round-trips', () => {
  const p = progressWithBest(26000)
  const back = parseProgress(JSON.stringify(serialiseProgress(p)))
  assert.ok(back)
  assert.equal(back.bestMs, 26000)
  assert.deepEqual(back.medals, ['bronze'])
  assert.equal(back.best?.samples.length, lap.samples.length)
})

test('a fresh player serialises to an empty document that reads back empty', () => {
  const back = parseProgress(JSON.stringify(serialiseProgress(createProgress())))
  assert.ok(back)
  assert.equal(back.bestMs, null)
  assert.equal(back.best, null)
  assert.deepEqual(back.medals, [])
})

test('the full ladder round-trips and still races your own best', () => {
  const p = progressWithBest(20000) // under gold: all three medals at once
  assert.deepEqual(p.medals, ['bronze', 'silver', 'gold'])
  const back = parseProgress(JSON.stringify(serialiseProgress(p)))
  assert.ok(back)
  const rival = rivalFor(back)
  assert.equal(rival.kind, 'best')
  assert.equal(rival.ms, 20000)
})

test('the document stays far inside the 64 KB limit', () => {
  const body = JSON.stringify(serialiseProgress(progressWithBest(26000)))
  const bytes = new TextEncoder().encode(body).length
  assert.ok(bytes < 16 * 1024, `save document is ${bytes} bytes`)
})

test('nothing malformed breaks the game — every bad shape reads as absent', () => {
  const bad = [
    '',
    'not json',
    'null',
    '[]',
    '"a string"',
    doc({ v: 2 }), // a version from a future Rival
    doc({ v: '1' }), // right number, wrong type
    doc({ bestMs: 26000, ghost: 'not a lap' }), // ghost will not decode
    doc({ bestMs: 26000, ghost: null }), // a time with no lap to race
    doc({ medals: ['bronze', 'silver', 'gold'] }), // gold beaten but no best to race
  ]
  for (const text of bad) {
    assert.equal(parseProgress(text), null, `should not have parsed: ${text.slice(0, 60)}`)
  }
})

test('an unusable best degrades to no best rather than to a corrupt save', () => {
  // A lap with no time, or a time that cannot be one, is harmless rather than
  // broken: there is nothing to race, so the ladder starts without a personal
  // best and the next valid lap sets one. Medals are still honoured.
  for (const bad of [
    doc({ bestMs: null, ghost: encodeLap(lap) }),
    doc({ bestMs: -5, ghost: encodeLap(lap), medals: ['bronze'] }),
    doc({ bestMs: 'fast', ghost: encodeLap(lap), medals: ['bronze'] }),
  ]) {
    const back = parseProgress(bad)
    assert.ok(back, bad.slice(0, 40))
    assert.equal(back.bestMs, null)
    assert.equal(back.best, null)
  }
})

test('unknown medals are dropped and the ladder keeps its order', () => {
  const back = parseProgress(doc({ medals: ['platinum', 'gold', 'bronze'], bestMs: 21000, ghost: encodeLap(lap) }))
  assert.ok(back)
  assert.deepEqual(back.medals, ['bronze', 'gold'])
})

test('extra fields are ignored rather than rejected', () => {
  const back = parseProgress(doc({ bestMs: 26000, ghost: encodeLap(lap), medals: ['bronze'], laps: 40 }))
  assert.ok(back)
  assert.equal(back.bestMs, 26000)
})
