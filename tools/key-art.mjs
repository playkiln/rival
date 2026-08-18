/**
 * Turn the Grok deliveries (asset-inbox/art/*.jpg) into game-ready art.
 *
 *   node tools/key-art.mjs
 *
 * Writes public/assets/art/* and the store card + icon under public/assets/.
 * Re-runnable: everything is derived from the inbox, nothing is hand-edited.
 *
 * Keying. Grok cannot be trusted to emit transparent PNGs, so anything that
 * needs alpha was generated on "magenta" — and Grok's magenta drifts per
 * image (#FF00FF asked; #FC01FE, #EC039A, #E8048B delivered). So each image
 * is keyed on ITS OWN corner colour, with a soft threshold on RGB distance
 * for the anti-aliased edge, and the key colour is then un-mixed out of
 * those edge pixels (despill) so nothing keeps a pink fringe. The JPEG
 * compression noise near edges is what the soft band is for.
 *
 * Sizes. The car is never more than ~45 px long on screen and the frames
 * are nine-sliced, so nothing here needs to be big; each asset is sized for
 * roughly 2–3× its largest on-screen footprint and no more.
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IN = join(ROOT, 'asset-inbox', 'art')
const OUT = join(ROOT, 'public', 'assets', 'art')
const ASSETS = join(ROOT, 'public', 'assets')

/** RGB distance below this is fully key; above `hi` fully subject; a soft band between. */
const KEY_LO = 48
const KEY_HI = 130

/**
 * Key the background out. Returns an RGBA sharp pipeline, trimmed to the
 * subject's bounding box (plus `pad` transparent pixels).
 */
async function keyed(file, { pad = 2 } = {}) {
  const { data, info } = await sharp(join(IN, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const C = 4
  const px = (x, y) => [0, 1, 2].map((c) => data[(y * W + x) * C + c])
  // Key colour: average of the four corners.
  const corners = [px(4, 4), px(W - 5, 4), px(4, H - 5), px(W - 5, H - 5)]
  const key = [0, 1, 2].map((c) => corners.reduce((a, p) => a + p[c], 0) / 4)

  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  let fringe = 0
  let spill = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * C
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const d = Math.hypot(r - key[0], g - key[1], b - key[2])
      const a = Math.min(1, Math.max(0, (d - KEY_LO) / (KEY_HI - KEY_LO)))
      if (a <= 0) {
        data[i + 3] = 0
        continue
      }
      if (a < 1) {
        // Un-mix the key out of the edge pixel: P = a·C + (1−a)·K  ⇒  C = (P − (1−a)·K) / a
        for (let c = 0; c < 3; c += 1) {
          const v = (data[i + c] - (1 - a) * key[c]) / a
          data[i + c] = Math.max(0, Math.min(255, Math.round(v)))
        }
        fringe += 1
      }
      // Despill. JPEG chroma bleeds the key into dark pixels along an edge
      // without moving them close enough to the key to be treated as edge
      // above; they come out dark pink. Only a magenta-tinted pixel has both
      // R and B above G — none of the palette does — so pulling that excess
      // out neutralises exactly those pixels and nothing else.
      {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const excess = Math.min(r, b) - g
        if (excess > 0) {
          data[i] = r - excess
          data[i + 2] = b - excess
          spill += 1
        }
      }
      data[i + 3] = Math.round(a * 255)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const left = Math.max(0, minX - pad)
  const top = Math.max(0, minY - pad)
  const width = Math.min(W, maxX + pad + 1) - left
  const height = Math.min(H, maxY + pad + 1) - top
  const keyHex = '#' + key.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  return {
    key: keyHex,
    fringe,
    spill,
    box: { left, top, width, height },
    image: sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width, height }),
  }
}

function report(name, extra) {
  console.log(`  ${name.padEnd(22)} ${extra}`)
}

async function writePng(pipeline, name) {
  const out = join(OUT, name)
  const info = await pipeline.png({ compressionLevel: 9 }).toFile(out)
  return `${info.width}×${info.height} ${(info.size / 1024).toFixed(0)} KiB`
}

// ------------------------------------------------------------------ keyed

/** The car: faces right, rotated in code. Sized for ~3× its largest on-screen length. */
async function car() {
  const k = await keyed('car.jpg')
  const s = await writePng(k.image.resize({ width: 144 }), 'car.png')
  report('car.png', `${s}  key ${k.key}, ${k.fringe} edge px un-mixed, ${k.spill} despilled`)
}

/**
 * Nine-sliced frames. The insets are printed so the scene's NineSlice calls
 * can quote them; they cover the corner brackets / end marks with margin.
 */
async function frames() {
  const p = await keyed('panel-frame.jpg')
  const ps = await writePng(p.image.resize({ width: 720 }), 'panel-frame.png')
  report('panel-frame.png', `${ps}  key ${p.key}, insets 72`)

  const b = await keyed('button-frame.jpg')
  const bs = await writePng(b.image.resize({ height: 96 }), 'button-frame.png')
  report('button-frame.png', `${bs}  key ${b.key}, insets l/r 64 t/b 16`)
}

/** Medal sheet: three tiles, split on the empty columns between them. */
async function medals() {
  const k = await keyed('medals-sheet.jpg', { pad: 0 })
  const { data, info } = await k.image.raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  // Column occupancy from alpha, then runs of occupied columns are the tiles.
  const occupied = new Array(W).fill(false)
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        occupied[x] = true
        break
      }
    }
  }
  const runs = []
  let start = -1
  for (let x = 0; x <= W; x += 1) {
    const on = x < W && occupied[x]
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      runs.push([start, x])
      start = -1
    }
  }
  const tiles = runs.filter(([a, b]) => b - a > W * 0.1)
  if (tiles.length !== 3) throw new Error(`medals-sheet: expected 3 tiles, found ${tiles.length} (${JSON.stringify(runs)})`)
  const names = ['bronze', 'silver', 'gold']
  for (let i = 0; i < 3; i += 1) {
    const [a, b] = tiles[i]
    const tile = sharp(data, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: a, top: 0, width: b - a, height: H })
      .trim({ threshold: 8 })
      .resize({ height: 128 })
    const s = await writePng(tile, `medal-${names[i]}.png`)
    report(`medal-${names[i]}.png`, s)
  }
}

async function logo() {
  const k = await keyed('logo-rival.jpg')
  const s = await writePng(k.image.resize({ width: 640 }), 'logo.png')
  report('logo.png', `${s}  key ${k.key}`)
}

// -------------------------------------------------------------- full-bleed

async function fullBleed() {
  const tile = async (file, name) => {
    const info = await sharp(join(IN, file)).resize(512, 512).jpeg({ quality: 88 }).toFile(join(OUT, name))
    report(name, `${info.width}×${info.height} ${(info.size / 1024).toFixed(0)} KiB`)
  }
  await tile('tarmac-tile.jpg', 'tarmac.jpg')
  await tile('infield-tile.jpg', 'infield.jpg')

  const bd = await sharp(join(IN, 'menu-backdrop.jpg')).resize(1280, 720).jpeg({ quality: 82 }).toFile(join(OUT, 'backdrop.jpg'))
  report('backdrop.jpg', `${bd.width}×${bd.height} ${(bd.size / 1024).toFixed(0)} KiB`)

  const card = await sharp(join(IN, 'card.jpg')).resize(1280, 720).jpeg({ quality: 86 }).toFile(join(ASSETS, 'card.jpg'))
  report('../card.jpg', `${card.width}×${card.height} ${(card.size / 1024).toFixed(0)} KiB`)
  const icon = await sharp(join(IN, 'icon.jpg')).resize(512, 512).png({ compressionLevel: 9 }).toFile(join(ASSETS, 'icon.png'))
  report('../icon.png', `${icon.width}×${icon.height} ${(icon.size / 1024).toFixed(0)} KiB`)
}

mkdirSync(OUT, { recursive: true })
console.log(`Writing art to ${OUT}`)
await car()
await frames()
await medals()
await logo()
await fullBleed()
console.log('Done.')
