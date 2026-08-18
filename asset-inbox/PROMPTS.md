# Rival — asset generation prompts

Everything the builder needs to generate, in copy-paste form. Two tables:
**music (Suno)** and **images (Grok)**. Each prompt below is
**self-contained** — click the copy button on the code block, paste it into the
tool, generate. Nothing needs to be assembled by hand.

Task detail lives in [`tasks/02-audio.md`](../tasks/02-audio.md) and
[`tasks/03-art.md`](../tasks/03-art.md); this file is the working copy for the
generation sittings.

## How delivery works

Drop finished downloads into these folders, named **exactly** as the tables
say, and Claude does the rest:

```text
asset-inbox/music/   ← Suno exports          (4 files)
asset-inbox/art/     ← Grok images           (9 required + 1 optional)
```

Claude then trims and loop-crossfades the music, keys the magenta out of the
art, slices sheets, downscales, and wires it all in. Raw inbox files stay
committed so anything can be re-derived without a new generation — music as
FLAC (lossless, so still the raw take, at half the size of WAV), art as
delivered.

**Rerolls:** if you generate several candidates and cannot decide, drop the
runners-up as `car-b.png`, `race-loop-b.wav` and so on. Claude picks against
the real game and the extras cost nothing but disk.

---

# Table 1 — Music (Suno)

| # | File | What it is | Length to aim for | Must loop |
|---|------|-----------|------|---|
| M1 | `race-loop.wav` | In-lap music, plays from the countdown to the finish line | 90–120 s generated | Yes |
| M2 | `menu-loop.wav` | Calmer sibling for main menu, settings and pause | 90–120 s generated | Yes |
| M3 | `result-loop.wav` | End-screen bed, under the lap time and the ghost delta | 60–120 s generated | Yes |
| M4 | `best-sting.wav` | One-shot fanfare on a new personal best | Whatever Suno makes | No |

### Suno settings — the same for all four

1. **Custom mode**, not the simple prompt box.
2. **Instrumental: ON.** There are no lyrics anywhere in this game. Leave the
   lyrics field completely empty.
3. Paste the prompt into the **Style / Description** field.
4. Generate **2–3 candidates** per track and judge on headphones.
5. Download the **highest quality** Suno offers (WAV if available, else the
   best MP3/M4A).
6. Rename to the exact filename and drop into `asset-inbox/music/`.

### How to judge — this is the part that matters

- **Judge the middle, not the intro.** Claude cuts the first and last few
  seconds and loops a stable mid-section, so a track with a gorgeous intro and
  a shapeless middle is the *worse* pick. Scrub to 0:40 and listen from there.
- **Reject anything that evolves.** A build, a drop, a breakdown, a key change
  or a fade-out all break a loop. You want ~60 seconds where nothing structural
  happens.
- **Reject any voice**, including wordless "aahs" and vocal chops — Suno adds
  them even on Instrumental sometimes.
- **The race loop must not be exciting.** It plays under a task requiring
  concentration, for attempt after attempt. If it makes you want to listen, it
  is competing with the driving. Steady and hypnotic wins.
- The three loops should sound like the **same instrument palette** — pick them
  as a set, ideally in one sitting.
- Don't worry about: exact length, silence at the ends, a clean loop seam, or
  file size. All handled in processing.

---

### M1 — `race-loop.wav`

In-lap music. Plays from the countdown through to the finish line, on repeat,
for every attempt. The engine note, tyre scrub and checkpoint ticks sit on top
of it, so it needs to leave the mid and high range fairly clear.

```text
Instrumental driving synthwave for a night-time time-trial racing game, 128 BPM, in a minor key. Pulsing analog arpeggio in even sixteenths, punchy gated drum machine with a tight kick and crisp closed hats, a warm round sub bass throb on the beat, one confident restrained lead line held low in the mix. Tense but never aggressive: focused, in-the-zone concentration music that stays out of the way. Absolutely constant steady energy from the first bar to the last, no intro buildup, no drop, no breakdown, no filter sweeps, no outro, no fade, no key change, no vocals, no vocal samples, no aahs. Dry and clean production with restrained reverb. Seamless loopable background music.
```

**Good candidate:** you could put it on repeat for ten minutes without noticing
a seam. **Reject:** anything with a moment you'd call "the good bit".

---

### M2 — `menu-loop.wav`

Main menu, settings and pause. Quieter and slower than the race loop but
unmistakably the same soundtrack.

```text
Instrumental calm ambient synthwave menu music for a night racing game, 90 BPM, minor key, same warm analog palette as a synthwave racing soundtrack. Slow sustained pad chords, a sparse plucked arpeggio well back in the mix, soft deep sub bass, minimal percussion — a soft rim tick at most, no full drum kit. Patient and atmospheric with a faint hint of anticipation, like waiting on the grid. Constant mellow energy throughout, no intro, no build, no swell, no outro, no fade, no vocals, no vocal samples. Spacious clean production. Seamless loopable menu music.
```

**Good candidate:** it feels like it could sit there indefinitely.
**Reject:** anything that arrives somewhere, or any percussion that starts
driving.

---

### M3 — `result-loop.wav`

End screen, under the lap time, the delta to the ghost and the medal state. It
plays at the emotional moment of the game — a lap either beaten or not — so it
should not judge the result either way.

```text
Instrumental reflective synthwave bed for a racing game results screen, 100 BPM, minor key, warm analog palette matching a night racing soundtrack. Wide warm pads, one simple wistful melody line on a soft lead synth, light unobtrusive percussion, a gentle bass pulse. Satisfied and a little melancholy — the feeling of rolling back into the pits after a lap. Neither triumphant nor sad. Steady and unchanging, no intro, no build, no climax, no outro, no fade, no vocals, no vocal samples. Seamless loopable.
```

**Good candidate:** works equally well over a personal best and over a blown
lap. **Reject:** anything celebratory (that is M4's job) or anything defeated.

---

### M4 — `best-sting.wav`

A short fanfare on a new personal best. It ducks the result loop, plays, and
the loop fades back in. Suno makes full songs rather than four-second stings —
that is fine, Claude cuts the sting out of the opening bar or two, so **only
the first ~4 seconds matter.**

```text
Instrumental short triumphant synthwave fanfare: a bright ascending analog synth melody over one punchy drum hit and a shimmering cymbal, resolving upward to a clean confident major chord. The sound of setting a new track record. Starts immediately on the downbeat with absolutely no build-up, no count-in, no silence at the start, no risers, no vocals. Bright, celebratory, clean and short.
```

**Good candidate:** the first two seconds already read as "you did it", and it
resolves upward. **Reject:** anything that opens with a riser, a pad swell or
silence — there is nothing to cut out of it.

---

# Table 2 — Images (Grok)

| # | File | What it is | Alpha needed | Aspect |
|---|------|-----------|---|---|
| A1 | `car.png` | The player car (the ghost is the same sprite at 42% alpha) | **Magenta** | 1:1 |
| A2 | `tarmac-tile.png` | Seamless asphalt texture, laid under the drawn road | Full-bleed | 1:1 |
| A3 | `infield-tile.png` | Seamless ground texture beside and inside the road | Full-bleed | 1:1 |
| A4 | `menu-backdrop.jpg` | Backdrop behind the menu, settings and end panels | Full-bleed | 16:9 |
| A5 | `panel-frame.png` | Nine-sliced frame for menu / settings / pause / end panels | **Magenta** | ~18:17 |
| A6 | `button-frame.png` | Nine-sliced button frame; states are tinted in code | **Magenta** | ~5:1 |
| A7 | `medals-sheet.png` | 1×3 bronze / silver / gold, for the ladder and end screen | **Magenta** | 3:1 |
| A8 | `card.jpg` | Store hero image — replaces `card.svg` | Full-bleed | 16:9 |
| A9 | `icon.png` | Square store icon (the manifest currently crops the card) | Full-bleed | 1:1 |
| A10 | `logo-rival.png` | *Optional* wordmark, only if the lettering comes out clean | **Magenta** | ~3:1 |

### Ground rules

- **Generate at Grok's maximum resolution.** Claude downscales; you cannot
  upscale.
- **Set the aspect ratio control** to the column above if the tool offers one.
  The prompts also state it, but the control is more reliable.
- **No text, letters or numbers in any image** — every label in the game is
  live Phaser text. A10 is the only exception.
- **Magenta means transparency.** Grok cannot be trusted to emit real
  transparent PNGs, so anything needing alpha is generated on solid magenta
  `#FF00FF` and keyed out locally. Magenta appears nowhere in Rival's palette,
  so the key is safe. Any prompt above marked "Magenta" already says so.
- **2–3 candidates each; pick the cleanest silhouette, not the most detailed
  one.** Detail turns to mud in-game. A8 is the one exception — detail is
  welcome on the store card.
- **Do it in one or two sittings.** Style drift between sittings is the main
  risk; every prompt below repeats the same style guide verbatim to fight it.
- Name the download exactly as the table says, drop it in `asset-inbox/art/`.

### What "too detailed" means here, concretely

The car is 30×16 world units and the camera zoom clamps at 0.7–1.5, so **the
car sprite is never more than about 45 px long on screen** — smaller than the
thumbnail Grok shows you. Same story for the medals and the button ornament.
Before accepting a candidate, shrink the preview to the size of a fingernail.
If it stops reading, reroll.

---

### A1 — `car.png` — the one that matters most

The player car, drawn top-down and rotated in code. The ghost rival is the
**same sprite at 42% alpha**, so this is the only car in the game and it has to
work both solid and faded.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A single small open-wheel racing car seen strictly from directly overhead, orthographic top-down view, pointing to the RIGHT of the frame. Warm amber #FFB347 bodywork with a cream #FFF1D6 nose cone and a dark near-black cockpit opening, four dark tyres clearly visible at the four corners, a simple rear wing. Compact chunky proportions with a strong readable silhouette so it stays legible when drawn only 40 pixels long. Perfectly symmetrical about its long axis. No driver figure, no shadow on the ground, no reflections, no track, no background scenery.

Plain solid magenta #FF00FF background, subject fully inside frame with generous margin.
```

**Must face right and nothing else** — rotation is code's job, and a car
pointing up or at three-quarter view is unusable. Check: symmetrical top and
bottom, the nose clearly distinguishable from the tail at fingernail size, no
soft drop shadow (it would key into a grey halo).

---

### A2 — `tarmac-tile.png`

Laid under the road polygon. The road edges, kerbs, checkpoint lines and start
chequer are all drawn procedurally on top from the track geometry, so this tile
carries **no markings of any kind** — and it must not compete with the car.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A seamless tileable dark asphalt texture, near-solid asphalt grey #3B3F48, extremely low contrast, very fine even grain with a few barely-visible darker patches. No road markings, no painted lines, no cracks, no manhole covers, no debris, no kerbs, no edges. It must look almost perfectly flat from a distance and show no large features. Perfectly square, seamless tileable on all four edges, uniform lighting with no vignette and no hotspot.

Full-bleed image, no border, no frame.
```

**Reject** any tile with a bright patch, a visible large feature, or a
lighting gradient — all three read as a repeating grid once tiled.

---

### A3 — `infield-tile.png`

Everything outside and inside the road. Replaces the current dot grid, whose
one real job is making motion legible where no track is in view — so a *very*
faint texture is better than a perfectly flat one.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A seamless tileable dark ground texture for the run-off area beside a race track, seen from directly overhead. Near-solid very dark blue-black #12161C with the faintest suggestion of short flat grass and fine gravel, extremely low contrast, slightly darker than asphalt. No objects, no rocks, no plants, no tyre barriers, no markings, no track, no edges. Perfectly square, seamless tileable on all four edges, uniform lighting with no vignette.

Full-bleed image, no border, no frame.
```

**Must read darker than the tarmac tile** — the boundary between on-track and
off-track is real gameplay information.

---

### A4 — `menu-backdrop.jpg`

Sits behind the menu, settings, pause and end panels, darkened further in code.
It is scenery, never a focal point: the panel lands dead centre, so the middle
of the image should be the emptiest part.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A calm wide atmospheric backdrop for a racing game menu: a night-time race circuit seen from high above at a steep angle, very dark and low contrast overall. A ribbon of asphalt curves away through darkness, with faint warm amber floodlight pools along its edges and a suggestion of red and white kerbing. Completely empty of cars and people. The centre of the image is deliberately plain and empty with no focal point, the interest sitting near the corners and edges. Heavily darkened, almost silhouetted, so bright user interface text reads clearly over the middle. 16:9 landscape.

Full-bleed image, no border, no frame.
```

**Reject** anything bright, busy or centre-weighted, and anything where a
bright element crosses the middle third.

---

### A5 — `panel-frame.png`

One nine-sliced frame serving the main menu, settings, pause and end panels, at
a footprint of **360×340 px**. Nine-slicing stretches the edge midpoints, so
**every ornament must be at the corners** — anything in the middle of an edge
gets smeared.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A rectangular frame for a game menu panel, seen perfectly flat and straight on. A clean solid dark navy #141821 panel field with a precise thin slate #2A3140 border, a thin warm amber #FFB347 pin stripe running just inside that border, and small square corner brackets in amber at the four corners only. Every edge is otherwise perfectly plain, straight and uniform along its whole length, and the interior field is completely empty and flat so text can be placed over it. No ornament anywhere except the four corners, no rivets, no screws, no notches, no tabs, no icons, no rounded decoration, no inner panels or dividers. Slightly wider than tall, about 18:17.

Plain solid magenta #FF00FF background, subject fully inside frame with generous margin.
```

**Check:** the four edge midpoints are identical and featureless, the interior
is genuinely empty, and the corners are sharp rather than glowing.

---

### A6 — `button-frame.png`

Nine-sliced too. Hover and primary states are derived by **tinting in code**,
so there is no second generation and the states can never drift apart.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A wide rounded-rectangle game button frame, seen perfectly flat and straight on. Dark navy #141821 fill with a crisp slate #2A3140 border and a thin warm amber #FFB347 underline along the bottom edge only. Tiny amber angle marks at the far left and far right ends only. The entire middle section is completely plain, empty, flat and uniform so it can be stretched horizontally and have a text label placed over it. No icons, no arrows, no gloss, no highlight sweep, no gradient across the middle, no ornament anywhere except the two ends. About 5:1 wide, low and wide.

Plain solid magenta #FF00FF background, subject fully inside frame with generous margin.
```

**Reject** any gloss highlight or gradient running along the width — it
stretches into a visible smear.

---

### A7 — `medals-sheet.png`

Three tiles in one image so the tiers cannot drift in style. Used small in the
menu's medal ladder and slightly larger on the end screen.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A 1x3 horizontal grid of three separate square tiles, each tile containing exactly one simple circular racing medal seen face-on with a short straight ribbon tab at the top. Left tile bronze, middle tile silver, right tile gold. Each medal is a plain flat disc with a single engraved chevron in the centre and a thin rim highlight. Identical shape, size, framing and position in all three tiles — only the metal colour differs. Clear even gaps between the tiles. No text, no numbers, no stars, no laurels, no ribbons other than the small top tab.

Plain solid magenta #FF00FF background, subject fully inside frame with generous margin.
```

**Check:** all three the same size and vertically aligned, and each one still
reads as its tier at fingernail size — bronze vs gold at 20 px is the usual
failure.

---

### A8 — `card.jpg` — the store hero, detail welcome here

Replaces `assets/card.svg` as the manifest's `cardImage`. This is the one image
seen at a decent size, before anyone has played, so the style guide's
"minimal detail" rule is relaxed — but the palette still holds.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly, except that rich detail IS allowed for this one image: Night-time motorsport, bold shapes, crisp edges, high contrast, cool and focused mood with one warm accent. Fixed palette: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. No photorealism, no 3D render look, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A striking game store hero image. Two small open-wheel racing cars seen from a dramatic high angle on a night circuit, racing side by side through a floodlit corner. The leading car is solid warm amber #FFB347 with a cream nose; the car beside it is a translucent faded ghost of the same car, pale and semi-transparent, clearly the same machine racing itself. Warm amber floodlight pools on dark wet asphalt, crisp red and white kerbs on the corner apex, dark empty surroundings falling away into near-black. Dynamic diagonal composition, bold and readable as a small thumbnail. 16:9 landscape.

Full-bleed image, no border, no frame.
```

**The two cars must read as the same car**, one solid and one ghosted — that
is the entire game in one picture. Reject candidates where they are two
different liveries or two different colours. Also squint at thumbnail size: if
you cannot tell there are two cars, reroll.

---

### A9 — `icon.png`

Square store icon. The manifest currently reuses the card here, which crops
badly. It is shown small, so this one is a pure silhouette exercise.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark.

ASSET: A simple square app icon for a racing game. One amber #FFB347 open-wheel racing car seen from directly overhead, centred, above a single bold off-white kerb stripe curving beneath it, on a flat dark navy #141821 background. Extremely bold and simple with only two or three shapes total, generous empty margin around the car, no scenery, no border, no rounded corner mask. It must still read clearly at 64 pixels square. 1:1 square.

Full-bleed image, no border, no frame.
```

**Test at 64 px** before accepting. If the car becomes a smudge, pick a bolder
candidate.

---

### A10 — `logo-rival.png` — optional

A wordmark, only if Grok renders the lettering cleanly. AI text is unreliable;
**if two or three attempts come out misspelled or malformed, drop this
entirely** — the current Phaser text title is honestly fine and a broken
wordmark is far worse than no wordmark.

```text
STYLE GUIDE for a matching set of video game assets — follow strictly: Clean flat vector style, night-time motorsport, bold simple shapes, crisp edges, minimal detail, high contrast, cool and focused mood with one warm accent. Fixed palette only: near-black blue #0B0D12, panel navy #141821, slate #2A3140, asphalt grey #3B3F48, off-white #E6E8EE, warm amber #FFB347, cream #FFF1D6, kerb red #D8483F. Soft single-direction lighting from top-left, flat fills with at most two tones per shape, no gradients heavier than that, no photorealism, no 3D render look, no motion blur, no lens flare, no text, no letters, no numbers, no logos, no watermark — except that this one image is a wordmark and MUST contain lettering.

ASSET: A game logo wordmark reading exactly the five letters R I V A L, spelled RIVAL, in bold condensed italic uppercase sans-serif letters on a single line. Warm amber #FFB347 letters with a thin cream #FFF1D6 outline and a subtle slate drop shadow. Letters clean, evenly spaced, correctly spelled, no extra letters, no duplicated letters, no additional words, no tagline, nothing else in the image. About 3:1 wide.

Plain solid magenta #FF00FF background, subject fully inside frame with generous margin.
```

**Read the letters out loud** before accepting. R-I-V-A-L, five letters, no
more.

---

## Universal reject checklist

Before dropping a file in the inbox, check it is not:

- **Text where there should be none** (A1–A9) — even a tiny sponsor decal.
- **A soft drop shadow or glow on a magenta asset** — it keys into a grey or
  pink halo. Crisp edges only.
- **Three-quarter or perspective view** where the prompt asked for straight
  top-down (A1) or flat-on (A5, A6, A7).
- **Off-palette** — teal, purple, neon pink, or a second accent colour
  alongside the amber.
- **A tile with a visible feature or lighting gradient** (A2, A3).
- **Ornament in the middle of an edge** on a nine-slice asset (A5, A6).
- **Mud at fingernail size** (A1, A7, A9). This is the most common failure and
  the hardest to see while looking at a big preview.

## Notes for Claude, not for the generator

- The delivered art arrived as `.jpg` throughout (Grok's export), including the
  "png" assets; `tools/key-art.mjs` reads `.jpg` and keys from there. Grok's
  magenta drifted per image (`#FC02FD` … `#E8038A`), which is why the tool
  keys on each image's own corner colour.
- `presentation.accent` is `#ffb347` and agrees with `UI.accent`; `cardImage`
  is `card.jpg` and `icon` is `icon.png`.
- The in-game ghost is the player car at alpha 0.42, so A8's ghost car is
  honest to the game rather than artistic licence. Keep it that way if the card
  is ever regenerated.
