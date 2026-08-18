/**
 * Offline SFX synthesizer — bakes every game sound to WAV.
 *
 *   node tools/generate-sfx.mjs
 *
 * Writes public/assets/audio/sfx/*.wav. Everything is synthesized: licence
 * clean, perfectly consistent, and re-tweakable by editing the recipes below
 * and re-running. WAV rather than OGG on purpose — the three driving loops
 * must join sample-exactly, and PCM has no encoder priming or padding to put
 * a click at the seam. The whole set is well under a megabyte.
 *
 * Three sounds are LOOPS the game drives continuously (engine by playback
 * rate, tyres and offtrack by gain). Loop content is built to be periodic in
 * the buffer: tonal parts use only whole-number cycles per second and the
 * buffer is exactly one second, filters are warmed up over extra passes so
 * their state is stationary at the seam, and noise gets its tail blended
 * into its head. Medal pitch is NOT baked — the game plays `medal` at a
 * higher rate per tier.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'audio', 'sfx')

// ------------------------------------------------------------ synth helpers

/** Oscillator with per-sample frequency control (phase accumulation). */
function tone({ dur, freq, wave = 'square', gain = 1, attack = 0.004, decay }) {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  const tau = decay ?? dur / 3
  let phase = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / SR
    const f = typeof freq === 'function' ? freq(t / dur) : freq
    phase += (2 * Math.PI * f) / SR
    let s
    if (wave === 'sine') s = Math.sin(phase)
    else if (wave === 'square') s = Math.sign(Math.sin(phase)) * 0.7
    else if (wave === 'triangle') s = (2 / Math.PI) * Math.asin(Math.sin(phase))
    else s = 2 * ((phase / (2 * Math.PI)) % 1) - 1 // saw
    const env = Math.min(1, t / attack) * Math.exp(-t / tau)
    out[i] = s * env * gain
  }
  return out
}

/** White noise burst with exponential decay and crude one-pole lowpass. */
function noise({ dur, gain = 1, decay, lowpass = 1 }) {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  const tau = decay ?? dur / 3
  let last = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / SR
    const white = Math.random() * 2 - 1
    last = last + lowpass * (white - last)
    out[i] = last * Math.exp(-t / tau) * gain
  }
  return out
}

/** Mix layers at offsets (seconds); result length fits everything. */
function mix(...layers) {
  const end = Math.max(...layers.map(([buf, at = 0]) => buf.length + Math.round(at * SR)))
  const out = new Float32Array(end)
  for (const [buf, at = 0] of layers) {
    const start = Math.round(at * SR)
    for (let i = 0; i < buf.length; i += 1) out[start + i] += buf[i]
  }
  return out
}

/** Note sequence: [freq, dur, gapAfter][]  */
function melody(notes, { wave = 'square', gain = 0.5 } = {}) {
  const layers = []
  let at = 0
  for (const [freq, dur, gap = 0] of notes) {
    layers.push([tone({ dur, freq, wave, gain, decay: dur / 2.2 }), at])
    at += dur + gap
  }
  return mix(...layers)
}

// ------------------------------------------------------------- loop helpers

/**
 * One second of a steady waveform, exactly periodic in the buffer. `voices`
 * are [freq (whole Hz), gain, wave]; a one-pole lowpass at `lowpass` is
 * warmed up over two extra passes so its state matches at the seam.
 */
function steadyTone(voices, { lowpass = 1 } = {}) {
  const n = SR
  const passes = 3
  const out = new Float32Array(n)
  let last = 0
  for (let p = 0; p < passes; p += 1) {
    for (let i = 0; i < n; i += 1) {
      const t = i / SR
      let s = 0
      for (const [f, g, wave = 'saw'] of voices) {
        const ph = 2 * Math.PI * f * t
        if (wave === 'sine') s += Math.sin(ph) * g
        else if (wave === 'square') s += Math.sign(Math.sin(ph)) * 0.7 * g
        else s += (2 * ((f * t) % 1) - 1) * g
      }
      last = last + lowpass * (s - last)
      if (p === passes - 1) out[i] = last
    }
  }
  return out
}

/** One second of coloured noise, tail blended into head so it loops clean. */
function steadyNoise({ lowpass = 1, highpass = 0, blend = 0.06 }) {
  const n = SR
  const k = Math.round(blend * SR)
  const out = new Float32Array(n + k)
  let lp = 0
  let hpPrev = 0
  let hpOut = 0
  for (let i = 0; i < n + k; i += 1) {
    const white = Math.random() * 2 - 1
    lp = lp + lowpass * (white - lp)
    // one-pole highpass to thin the bottom out of a scrub
    hpOut = highpass > 0 ? highpass * (hpOut + lp - hpPrev) : lp
    hpPrev = lp
    out[i] = hpOut
  }
  for (let i = 0; i < k; i += 1) {
    const w = i / k
    // equal-power blend of the k samples past the loop end into the first k,
    // so sample n-1 runs into sample 0 the way it ran into sample n.
    const head = out[i]
    const tail = out[n + i]
    out[i] = head * Math.sqrt(w) + tail * Math.sqrt(1 - w)
  }
  return out.subarray(0, n)
}

/** Multiply two buffers sample-wise (amplitude modulation), result length of the shorter. */
function modulate(a, b) {
  const n = Math.min(a.length, b.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = a[i] * b[i]
  return out
}

/** Slow periodic gain wobble: whole-number Hz so it repeats per second. */
function wobble(hz, depth, n = SR) {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = 1 - depth + depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * hz * (i / SR)))
  return out
}

/** Soft-clip and normalize to a target peak, preserving relative loudness. */
function finalize(buf, peak = 0.85) {
  let max = 0
  for (const s of buf) max = Math.max(max, Math.abs(Math.tanh(s)))
  const scale = max > 0 ? peak / max : 1
  return Float32Array.from(buf, (s) => Math.tanh(s) * scale)
}

function writeWav(name, samples) {
  const data = finalize(samples)
  const n = data.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2)
  }
  writeFileSync(join(OUT_DIR, `${name}.wav`), buf)
  console.log(`  ${name}.wav  ${(buf.length / 1024).toFixed(1)} KiB`)
}

// ---------------------------------------------------------------- recipes

const sounds = {
  // ----- driving loops -----

  // The headline sound. A low saw pair a hertz apart (one slow beat per
  // second), an octave below for body, all through a lowpass so it hums
  // rather than buzzes. The game pitches it 0.8–1.15 by real speed.
  engine: () =>
    modulate(
      steadyTone(
        [
          [88, 0.55, 'saw'],
          [89, 0.45, 'saw'],
          [44, 0.5, 'sine'],
          [176, 0.12, 'square'],
        ],
        { lowpass: 0.045 },
      ),
      wobble(11, 0.08),
    ),

  // Slip scrub: thin, hissy noise with a fast flutter. Gain follows slip.
  tyres: () => modulate(steadyNoise({ lowpass: 0.35, highpass: 0.9 }), wobble(23, 0.35, SR)),

  // Off-track gravel: low rumble with a coarse, lumpy modulation.
  offtrack: () =>
    mix([modulate(steadyNoise({ lowpass: 0.09 }), wobble(7, 0.5, SR))], [modulate(steadyNoise({ lowpass: 0.03 }), wobble(3, 0.4, SR))]),

  // ----- one-shots -----

  // Ahead of the ghost at a checkpoint: a bright, quick tick.
  'checkpoint-up': () =>
    mix(
      [tone({ dur: 0.07, freq: 1568, wave: 'sine', gain: 0.5, decay: 0.03 })],
      [tone({ dur: 0.1, freq: 2093, wave: 'sine', gain: 0.35, decay: 0.04 }), 0.03],
    ),

  // Behind the ghost: the same tick, duller and lower.
  'checkpoint-down': () =>
    mix(
      [tone({ dur: 0.08, freq: 784, wave: 'sine', gain: 0.45, decay: 0.035 })],
      [tone({ dur: 0.1, freq: 659, wave: 'triangle', gain: 0.25, decay: 0.045 }), 0.035],
    ),

  // F1-style light: one clean beep.
  'countdown-tick': () => mix([tone({ dur: 0.1, freq: 880, wave: 'square', gain: 0.4, decay: 0.045 })]),

  // Lights out — the release tone, higher and held a touch longer.
  'countdown-go': () =>
    mix(
      [tone({ dur: 0.32, freq: 1319, wave: 'square', gain: 0.4, decay: 0.12 })],
      [tone({ dur: 0.32, freq: 1760, wave: 'sine', gain: 0.3, decay: 0.14 })],
    ),

  // Valid lap over the line: a clean confirming major chord.
  'lap-done': () =>
    mix(
      [tone({ dur: 0.5, freq: 523, wave: 'triangle', gain: 0.4, decay: 0.2 })],
      [tone({ dur: 0.5, freq: 659, wave: 'triangle', gain: 0.35, decay: 0.2 }), 0.02],
      [tone({ dur: 0.55, freq: 784, wave: 'sine', gain: 0.35, decay: 0.22 }), 0.04],
    ),

  // Invalid lap: a flat two-note refusal, downward.
  'lap-invalid': () =>
    melody(
      [
        [330, 0.14, 0.03],
        [247, 0.24],
      ],
      { wave: 'square', gain: 0.4 },
    ),

  // Medal chime; the game raises the rate for silver and gold.
  medal: () =>
    melody(
      [
        [659, 0.08],
        [784, 0.08],
        [988, 0.08],
        [1319, 0.24],
      ],
      { wave: 'triangle', gain: 0.55 },
    ),

  'ui-tap': () =>
    mix(
      [tone({ dur: 0.03, freq: 1900, wave: 'sine', gain: 0.35, decay: 0.012 })],
      [noise({ dur: 0.02, gain: 0.1, decay: 0.008, lowpass: 0.6 })],
    ),

  'ui-toggle': () =>
    mix(
      [tone({ dur: 0.04, freq: 1200, wave: 'sine', gain: 0.3, decay: 0.018 })],
      [tone({ dur: 0.05, freq: 1600, wave: 'sine', gain: 0.3, decay: 0.02 }), 0.045],
    ),

  'pause-in': () =>
    melody(
      [
        [700, 0.08],
        [500, 0.12],
      ],
      { wave: 'sine', gain: 0.4 },
    ),

  'pause-out': () =>
    melody(
      [
        [500, 0.08],
        [700, 0.12],
      ],
      { wave: 'sine', gain: 0.4 },
    ),
}

mkdirSync(OUT_DIR, { recursive: true })
console.log(`Writing ${Object.keys(sounds).length} sounds to ${OUT_DIR}`)
for (const [name, make] of Object.entries(sounds)) writeWav(name, make())
