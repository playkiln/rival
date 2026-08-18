# Task 3 — Art (Grok-generated PNG UI & sprites)

**Goal:** replace the drawn-in-code look with image-backed surfaces in one
consistent night-race style — car, tarmac, infield, panel frames, buttons,
medals, menu backdrop and a real store card.

**Owners:** Gerard generates on Grok following the guide below. Claude keys
out backgrounds, slices sheets, integrates (nine-slice frames, tile sprites,
sprite rotation) and rebuilds the store card pipeline.

**Depends on:** Task 1 (final panel footprint, 360×340).

---

## What stays procedural — do not generate these

`TrackRenderer.ts` derives the road, both borders, the kerb striping, the
checkpoint lines and the start chequer from the track geometry. That is what
makes the width, the kerbs and the chicane correct. Grok supplies **surface
textures only** — a tarmac tile and an infield tile that get laid *under* that
geometry. Do not generate track pieces, corners, or a whole circuit; they
cannot be made to line up with the simulation.

## The three failure modes we are pre-empting

1. **Mud at small sizes.** The car is 30×16 world units and the camera zoom
   clamps at 0.7–1.5, so the car sprite is never more than ~45 px long. Flat,
   bold, high-contrast, minimal detail.
2. **Style drift across assets.** Every prompt starts with the same STYLE
   GUIDE block, related assets are generated in one sheet, and everything is
   generated in one or two sittings.
3. **No real transparency.** Grok cannot be trusted to emit transparent PNGs.
   Everything that needs alpha is generated on **solid magenta (#FF00FF)** and
   keyed out locally with `tools/key-art.sh` (ported from Snake). Magenta
   appears nowhere in Rival's palette, so keying is safe. Full-bleed images
   (backdrop, card, tiles) need no magenta.

## Ground rules for every generation

- Paste the STYLE GUIDE block first, then the asset prompt.
- **No text or letters in any image** — every label stays live Phaser text.
  The one exception is the optional wordmark at the end of the list.
- Generate at Grok's max resolution; Claude downscales.
- 2–3 candidates per asset; pick the cleanest silhouette, not the most
  detailed one.
- Name the download exactly as listed, drop it in `asset-inbox/art/`.

## STYLE GUIDE block (paste before every single prompt)

> STYLE GUIDE for a matching set of video game assets — follow strictly:
> Clean flat vector style, night-time motorsport, bold simple shapes, crisp
> edges, minimal detail, high contrast, cool and focused mood with one warm
> accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821,
> slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347,
> cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from
> top-left, flat fills with at most two tones per shape, no gradients heavier
> than that, no photorealism, no 3D render look, no motion blur, no lens
> flare, no text, no letters, no numbers, no logos, no watermark.

Then, per asset, append either:

> Plain solid magenta #FF00FF background, subject fully inside frame with
> generous margin.

(for anything needing transparency), or:

> Full-bleed image, no border, no frame.

(for the tiles, the backdrop and the card).

## Asset list & prompts

### A. The car (the one that matters most)

**`car.png`** — the player car; the ghost is the same sprite at lower alpha
(a closed design decision), so there is exactly one car to generate.

> [STYLE GUIDE] A single top-down view of a small open-wheel racing car seen
> directly from above, pointing to the RIGHT, warm amber bodywork with a cream
> nose cone and dark cockpit opening, four dark tyres visible at the corners,
> compact and chunky proportions so it reads clearly when small, symmetrical
> about its long axis, subject fully inside frame with generous margin.
> [MAGENTA]

*(Rotation is handled in code — it must face right and nothing else.)*

### B. Surfaces (the quiet stuff — must NOT compete with the car)

**`tarmac-tile.png`** — laid under the drawn road:

> [STYLE GUIDE] A seamless tileable dark asphalt texture, near-solid asphalt
> grey #3B3F48, extremely low contrast, very fine even grain with a few faint
> darker patches, no road markings, no lines, no cracks, must look almost
> flat from a distance, square, seamless tileable edges. [FULL-BLEED]

**`infield-tile.png`** — replaces the dot grid outside and inside the road:

> [STYLE GUIDE] A seamless tileable dark ground texture for the area beside a
> race track, near-solid dark blue-black #12161C with a faint suggestion of
> short flat grass and gravel, extremely low contrast, no objects, no
> markings, square, seamless tileable edges. [FULL-BLEED]

**`menu-backdrop.jpg`** — sits behind the menu, settings and end panels:

> [STYLE GUIDE] A calm wide atmospheric backdrop for a racing game menu: a
> night-time race circuit seen from high above at a steep angle, dark and
> low-contrast, a ribbon of asphalt curving through darkness with faint amber
> floodlight pools along the edges, empty of cars, no focal point in the
> centre, 16:9 landscape, heavily darkened so foreground UI reads over it.
> [FULL-BLEED]

### C. UI chrome

**`panel-frame.png`** — nine-sliced, so ornament at the **edges only**; one
frame serves menu, settings, pause and end panels:

> [STYLE GUIDE] A rectangular frame for a game menu panel: a clean dark navy
> #141821 panel with a precise slate #2A3140 border, a thin warm amber pin
> stripe running just inside the border, and small square corner brackets in
> amber at the four corners only — every edge midpoint plain and uniform so
> the frame can stretch. Slightly wider than tall, about 18:17. [MAGENTA]

**`button-frame.png`** — nine-sliced, ornament at the ends only:

> [STYLE GUIDE] A wide rounded-rectangle game button frame, dark navy fill
> with a crisp slate border and a thin amber underline along the bottom edge,
> tiny amber angle marks only at the far left and far right ends, the entire
> middle section plain and uniform so it can stretch, about 5:1 wide.
> [MAGENTA]

*(The hover and primary states are derived by tinting in code — no second
generation, and the states stay perfectly consistent.)*

**`medals-sheet.png`** — 1×3, for the menu ladder and the end screen:

> [STYLE GUIDE] A 1x3 grid of three separate square tiles, each containing one
> simple circular racing medal seen face-on with a short ribbon tab at the
> top: left tile bronze, middle tile silver, right tile gold, each a plain
> flat disc with a single engraved chevron and a rim highlight, no text, no
> numbers, identical shape and size across the three tiles, clear gaps between
> tiles. [MAGENTA]

### D. Store presence (the hero image — detail welcome HERE)

**`card.jpg`** — replaces `assets/card.svg` in the manifest (`cardImage`):

> [STYLE GUIDE — but rich detail is allowed for this one] A striking game
> store hero image: two small top-down racing cars on a night circuit taken
> from a dramatic high angle, one solid amber and one translucent glowing blue
> ghost car racing side by side through a floodlit corner, amber light pooling
> on wet asphalt, red and white kerbs, dark empty surroundings, dynamic
> diagonal composition, bold and readable as a small thumbnail, 16:9
> landscape. [FULL-BLEED]

**`icon.png`** — square icon (the manifest currently reuses the card, which
crops badly):

> [STYLE GUIDE] A simple square app icon for a racing game: one amber top-down
> racing car centred on a dark navy background above a single white kerb
> stripe curve, extremely bold and simple, readable at 64 pixels, 1:1 square.
> [FULL-BLEED]

### E. Optional

**`logo-rival.png`** — a wordmark, if Grok renders the lettering cleanly. AI
text is unreliable; if two or three attempts come out malformed, drop it and
keep the current Phaser text title, which is honestly fine.

> [STYLE GUIDE] A game logo wordmark reading exactly "RIVAL" in bold condensed
> italic uppercase sans-serif letters, warm amber with a thin cream outline
> and a subtle slate drop shadow, letters clean and correctly spelled, nothing
> else in the image. [MAGENTA]

## Delivery checklist (drop in `asset-inbox/art/`)

```text
car.png            tarmac-tile.png    infield-tile.png   menu-backdrop.jpg
panel-frame.png    button-frame.png   medals-sheet.png
card.jpg           icon.png           logo-rival.png (optional)
```

9 required generations plus one optional (plus rerolls). Do them in one or two
sittings for consistency; reroll off-style ones with the same STYLE GUIDE
block.

## Integration plan (Claude)

- Port `tools/key-art.sh` from Snake; key magenta → alpha, trim, downscale,
  slice `medals-sheet`.
- `makeCarTexture()` in `TrackRenderer.ts` is replaced by the loaded `car`
  image, keeping `CAR_LENGTH` / `CAR_WIDTH` as the display size so the
  simulation and the tyre-mark offsets are untouched. The ghost keeps sharing
  the texture at alpha 0.42.
- The ground `tileSprite` swaps from the generated dot texture to
  `infield-tile`; the road polygon gets a `tarmac-tile` fill layered under the
  existing borders, kerbs, checkpoint lines and chequer, all of which stay
  procedural.
- `backdrop()` and `button()` in `ui/widgets.ts` become `NineSlice` objects
  with code-tinted states; the panel behind menu/settings/end gains the
  `menu-backdrop` image, darkened, on its own layer.
- `card.jpg` replaces `card.svg` as `presentation.cardImage`, `icon.png`
  becomes `presentation.icon`, and `scripts/shot.mjs` regenerates the
  screenshots against the finished look.
- Fallback: the current code-drawn look stays behind a flag until all art has
  landed, so the game is never broken mid-task.

## Acceptance criteria

- [ ] Car, surfaces, panels, buttons, medals and backdrop all image-backed;
      no placeholder rectangles in normal play.
- [ ] The car reads clearly at the real in-game size on a phone viewport
      (squint test), at both zoom extremes.
- [ ] Tiles are seamless — no visible grid at any camera position.
- [ ] Kerbs, borders, checkpoint lines and chequer still align exactly with
      the drivable surface.
- [ ] One coherent style across every asset; palette matches the game's.
- [ ] No text baked into any image except the optional wordmark.
- [ ] No magenta fringing on any keyed asset.
- [ ] Store card and icon updated in the manifest, accent colour agreed.
- [ ] `playkiln validate` passes; package comfortably inside budget.
