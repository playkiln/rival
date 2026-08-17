/**
 * A ghost is a decoded lap plus what the HUD needs from it: the frame at
 * which it crosses each checkpoint and the finish, so the live split delta
 * can be shown as the player crosses the same line.
 */
import type { LapRecording } from './recording'
import { lapDelta, nearestOnTrack, type Track } from './track'

export type Ghost = {
  lap: LapRecording
  /** Lap time in fixed-step frames. */
  frames: number
  /** Frame at which the ghost crosses each checkpoint, in order (interpolated). */
  checkpointFrames: number[]
}

export function makeGhost(track: Track, lap: LapRecording): Ghost {
  const marks = track.checkpointS
  const checkpointFrames: number[] = new Array(marks.length).fill(lap.frames)
  let next = 0
  let seg: number | undefined
  let prevS = 0
  let prevT = 0
  for (let i = 0; i < lap.samples.length && next < marks.length; i++) {
    const smp = lap.samples[i]
    const near = nearestOnTrack(track, smp.x, smp.y, seg)
    seg = near.seg
    if (i > 0) {
      const adv = lapDelta(track, prevS, near.s)
      // Only forward, plausible motion counts (mirrors lap.ts).
      if (adv > 0 && adv < track.halfWidth * 4) {
        while (next < marks.length) {
          const toMark = lapDelta(track, prevS, marks[next])
          if (toMark > 0 && toMark <= adv) {
            checkpointFrames[next] = prevT + (smp.t - prevT) * (toMark / adv)
            next++
          } else break
        }
      }
    }
    prevS = near.s
    prevT = smp.t
  }
  return { lap, frames: lap.frames, checkpointFrames }
}
