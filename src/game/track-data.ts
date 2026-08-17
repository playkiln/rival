import type { TrackDef } from './sim/track'

/**
 * The one track. Authored on a ~1600 × 900 grid, y down, then scaled. Each
 * entry is a corner vertex with the radius of the arc that rounds it;
 * straights run between arcs. Driving order is list order, anticlockwise on
 * screen (bottom straight heading +x).
 *
 *  T1  bottom-right: long left sweeper onto the angled right-hand straight
 *  T2  top-right: two lefts, wide then tight — enter wide, apex the second late
 *  T3  the descent chicane: left flick, hard right, right onto the west run
 *  T4  bottom-left of the infield: right, up the long north straight
 *  T5  top-left hairpin: two lefts
 *  T6  final left onto the start straight — a late apex pays down the whole straight
 */
const SCALE = 1.25

const RAW: [number, number, number][] = [
  // x, y, radius
  [1330, 800, 220], // T1
  [1500, 180, 150], // T2a
  [1010, 180, 90], // T2b
  [1010, 460, 80], // T3a
  [1100, 570, 60], // T3b
  [940, 655, 80], // T3c
  [560, 655, 100], // T4
  [560, 170, 110], // T5a
  [170, 170, 110], // T5b
  [170, 800, 140], // T6
]

export const TRACK: TrackDef = {
  width: 120,
  checkpoints: 7,
  startOffset: 60 * SCALE,
  corners: RAW.map(([x, y, r]) => ({ x: x * SCALE, y: y * SCALE, r: r * SCALE })),
}
