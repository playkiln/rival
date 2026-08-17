import type { TrackDef } from './sim/track'

/**
 * The one track. Authored on a ~1600 × 900 grid, y down, then scaled; driving
 * order is the order of the points and the first is the start/finish, heading +x.
 *
 * Corners, in driving order:
 *  T1  bottom-right sweeper, fast and long — hold early, carry it
 *  T2  top-right, tightens on exit into the descent — enter wide, apex late
 *  T3  mid chicane, right-left flick — the line through T2 decides this
 *  T4  right onto the west run
 *  T5  right, up toward the top-left
 *  T6  top-left hairpin
 *  T7  final left onto the straight — a late apex pays down the whole straight
 */
const SCALE = 1.25

const RAW = [
  [330, 795],
  [640, 800],
  [960, 800],
  [1290, 775],
  [1470, 640],
  [1500, 450],
  [1450, 270],
  [1290, 150],
  [1110, 190],
  [1010, 330],
  [1000, 430],
  [1060, 525],
  [1005, 650],
  [830, 665],
  [600, 600],
  [520, 540],
  [470, 420],
  [470, 280],
  [400, 150],
  [250, 160],
  [160, 290],
  [150, 450],
  [140, 620],
  [180, 750],
]

export const TRACK: TrackDef = {
  width: 120,
  checkpoints: 7,
  controls: RAW.map(([x, y]) => ({ x: x * SCALE, y: y * SCALE })),
}
