/**
 * Headless smoke test for the simulation: builds the track, reports its
 * geometry, and drives a lap with a crude pure-pursuit bang-bang driver so
 * checkpoint and lap detection are exercised without a browser.
 *
 *   npx esbuild scripts/simcheck.ts --bundle --platform=node --outfile=scratch/simcheck.cjs && node scratch/simcheck.cjs
 */
import { DEFAULT_CAR, createCar, stepCar } from '../src/game/sim/car'
import { createLap, stepLap } from '../src/game/sim/lap'
import { buildTrack, pointAt } from '../src/game/sim/track'
import { TRACK } from '../src/game/track-data'

const track = buildTrack(TRACK)
const p = DEFAULT_CAR
const STEP = 1 / 60

console.log(`length ${track.length.toFixed(0)}  ideal lap at centre ${(track.length / p.speed).toFixed(1)}s`)
console.log(`bounds ${JSON.stringify(track.bounds)}`)
console.log(`car turn radius ${(p.speed / p.turnRate).toFixed(0)}  half width ${track.halfWidth}`)

// Minimum centre-line radius.
let minR = Infinity
let minRs = 0
const S = track.samples
for (let i = 0; i < S.length; i++) {
  const a = S[(i - 2 + S.length) % S.length]
  const c = S[(i + 2) % S.length]
  const ang = Math.abs(Math.atan2(a.tx * c.ty - a.ty * c.tx, a.tx * c.tx + a.ty * c.ty))
  const ds = ((c.s - a.s + track.length) % track.length) || 1
  const r = ang > 1e-6 ? ds / ang : Infinity
  if (r < minR) {
    minR = r
    minRs = S[i].s
  }
}
console.log(`min centre-line radius ${minR.toFixed(0)} at s=${minRs.toFixed(0)}`)

// Auto-driver: aim at a point `look` ahead on the centre-line, hold if it is
// on the hold side of the nose.
const car = createCar(track, p)
const lap = createLap(car.near.s)
let frame = 0
let laps = 0
let offFrames = 0
const look = 90
const maxFrames = 60 * 120
while (frame < maxFrames && laps < 2) {
  const target = pointAt(track, car.near.s + look)
  const dx = target.x - car.x
  const dy = target.y - car.y
  const cross = Math.cos(car.heading) * dy - Math.sin(car.heading) * dx
  // Positive cross means the target is to the +y side (clockwise on screen).
  const turning = p.holdDirection === 1 ? cross > 0 : cross < 0
  stepCar(car, p, track, turning, true, STEP)
  frame += 1
  if (car.offTrack) offFrames += 1
  const events = stepLap(lap, track, car.near.s, car.near.dist, frame, p.speed, STEP)
  for (const e of events) {
    if (e.type === 'lap') {
      laps += 1
      console.log(`lap ${laps}: ${(e.frames / 60).toFixed(2)}s valid=${e.valid}`)
    }
  }
}
console.log(`frames ${frame}, off-track frames ${offFrames}, checkpoints hit this lap ${lap.next}/${track.checkpointS.length}`)

// Cut test: teleport across the infield and confirm the lap invalidates.
const car2 = createCar(track, p)
const lap2 = createLap(car2.near.s)
lap2.armed = true
let f2 = 0
for (; f2 < 60; f2++) {
  stepCar(car2, p, track, false, true, STEP)
  stepLap(lap2, track, car2.near.s, car2.near.dist, f2, p.speed, STEP)
}
// Jump to just before the finish line, on the tarmac.
const nearFinish = pointAt(track, track.length - 30)
car2.x = nearFinish.x
car2.y = nearFinish.y
car2.heading = Math.atan2(nearFinish.ty, nearFinish.tx)
car2.vx = Math.cos(car2.heading) * p.speed
car2.vy = Math.sin(car2.heading) * p.speed
let cutValid: boolean | null = null
for (let k = 0; k < 120 && cutValid === null; k++) {
  stepCar(car2, p, track, false, true, STEP)
  f2++
  for (const e of stepLap(lap2, track, car2.near.s, car2.near.dist, f2, p.speed, STEP)) {
    if (e.type === 'lap') cutValid = e.valid
  }
}
console.log(`cut lap validated? ${cutValid} (expect false)`)
