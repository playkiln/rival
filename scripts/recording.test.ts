/**
 * Round-trip tests for the lap codec — the one part of Rival worth unit
 * tests. A silently lossy encoder makes a ghost drift through walls and look
 * like a physics bug.
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CAR, createCar, stepCar } from '../src/game/sim/car'
import {
  createRecorder,
  decodeLap,
  encodeLap,
  finishRecording,
  poseAt,
  recordStep,
  SAMPLE_STEP,
  type LapRecording,
} from '../src/game/sim/recording'
import { buildTrack, pointAt } from '../src/game/sim/track'
import { TRACK } from '../src/game/track-data'

const track = buildTrack(TRACK)
const STEP = 1 / 60

/** Drive a lap with the pursuit driver and record it. */
function driveLap(look = 90): LapRecording {
  const car = createCar(track, DEFAULT_CAR)
  const rec = createRecorder()
  let t = 0
  let prevS = 0
  for (; t < 60 * 60; t++) {
    recordStep(rec, t, car.x, car.y, car.heading)
    const target = pointAt(track, car.near.s + look)
    const cross = Math.cos(car.heading) * (target.y - car.y) - Math.sin(car.heading) * (target.x - car.x)
    stepCar(car, DEFAULT_CAR, track, cross < 0, true, STEP)
    // Finish: s wraps from near the end back to near zero.
    if (t > 60 && prevS > track.length * 0.9 && car.near.s < track.length * 0.1) {
      t++
      break
    }
    prevS = car.near.s
  }
  return finishRecording(rec, t, car.x, car.y, car.heading)
}

test('encode/decode round-trips within quantisation tolerance', () => {
  const lap = driveLap()
  assert.ok(lap.samples.length > 100, 'lap has samples')
  const text = encodeLap(lap)
  const back = decodeLap(text)
  assert.equal(back.step, lap.step)
  assert.equal(back.frames, lap.frames)
  assert.equal(back.samples.length, lap.samples.length)
  for (let i = 0; i < lap.samples.length; i++) {
    const a = lap.samples[i]
    const b = back.samples[i]
    assert.equal(b.t, a.t)
    assert.ok(Math.abs(a.x - b.x) <= 0.051, `x[${i}] off by ${a.x - b.x}`)
    assert.ok(Math.abs(a.y - b.y) <= 0.051, `y[${i}] off by ${a.y - b.y}`)
    // 1/1024 turn ≈ 0.0061 rad; allow half a step of rounding.
    let dh = a.heading - b.heading
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    assert.ok(Math.abs(dh) <= 0.0031, `heading[${i}] off by ${dh}`)
  }
})

test('a full lap encodes under 8 KB', () => {
  const lap = driveLap()
  const text = encodeLap(lap)
  assert.ok(lap.frames / 60 > 15, `lap should be a real lap, got ${lap.frames / 60}s`)
  assert.ok(text.length < 8 * 1024, `encoded ${text.length} bytes`)
})

test('samples are every third frame plus the exact finish', () => {
  const lap = driveLap()
  for (let i = 0; i < lap.samples.length - 1; i++) {
    assert.equal(lap.samples[i].t, i * SAMPLE_STEP)
  }
  assert.equal(lap.samples[lap.samples.length - 1].t, lap.frames)
})

test('poseAt interpolates between samples and clamps at the ends', () => {
  const lap = driveLap()
  const out = { x: 0, y: 0, heading: 0 }
  const a = lap.samples[10]
  const b = lap.samples[11]
  poseAt(lap, a.t + (b.t - a.t) / 2, out)
  assert.ok(Math.abs(out.x - (a.x + b.x) / 2) < 1e-9)
  assert.ok(Math.abs(out.y - (a.y + b.y) / 2) < 1e-9)
  poseAt(lap, -50, out)
  assert.equal(out.x, lap.samples[0].x)
  poseAt(lap, lap.frames + 500, out)
  assert.equal(out.x, lap.samples[lap.samples.length - 1].x)
})

test('heading survives the ±π wrap without a spin', () => {
  const lap: LapRecording = {
    step: 3,
    frames: 9,
    samples: [
      { t: 0, x: 0, y: 0, heading: 3.1 },
      { t: 3, x: 1, y: 0, heading: -3.1 }, // crossed π going anticlockwise... on screen
      { t: 6, x: 2, y: 0, heading: -3.0 },
      { t: 9, x: 3, y: 0, heading: -2.9 },
    ],
  }
  const back = decodeLap(encodeLap(lap))
  const out = { x: 0, y: 0, heading: 0 }
  poseAt(back, 1.5, out)
  // Halfway between 3.1 and -3.1 the short way is ±π, not 0.
  assert.ok(Math.abs(Math.abs(out.heading) - Math.PI) < 0.02, `got ${out.heading}`)
})

test('garbage does not decode', () => {
  assert.throws(() => decodeLap('not base64!!'))
  assert.throws(() => decodeLap(''))
  assert.throws(() => decodeLap(btoa('')))
})
