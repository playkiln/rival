# Rival — polish roadmap

The game is complete and publishable (stages 1–3 done). These three tasks take
it from "complete" to "polished", following the same shape that worked on
Snake. **No gameplay changes**: the car, the track, the ghost, the medal
ladder and the save format's meaning are all closed. This is menus, sound and
art only.

| # | Task | Depends on | Who does what |
|---|------|-----------|----------------|
| 1 | [Menus & flow](01-menus.md) | — | Claude codes it all |
| 2 | [Audio](02-audio.md) | Task 1 (Settings panel) | Gerard makes music on Suno, Claude synthesizes SFX + integrates |
| 3 | [Art](03-art.md) | Task 1 (final layouts) | Gerard generates images on Grok, Claude keys/slices/integrates |

## Why this order

Same reasoning as Snake, and it held up there: flow first because it defines
the panels that audio needs for its toggles and art needs for its frames;
audio second because it is mostly code and lands fast, with Suno tracks
dropping into an already-wired system; art last because it has the longest
human-in-the-loop cycle and it skins whatever is underneath it.

## Asset delivery workflow

Drop generated files into `asset-inbox/`:

```text
asset-inbox/
  music/   ← Suno exports, named per the list in 02-audio.md
  art/     ← Grok images, named per the list in 03-art.md
```

Claude picks them up from there: trims/transcodes music, keys out
backgrounds, slices sheets, moves finished assets into `public/assets/`, and
wires them in. Raw inbox files are committed so anything can be re-derived.

**[`asset-inbox/PROMPTS.md`](../asset-inbox/PROMPTS.md) is the copy-paste
sheet for the generation sittings** — every Suno and Grok prompt in full,
self-contained, with the tool settings and the reject criteria. Use it at the
keyboard; the task files below explain why each asset exists.

## What is different from Snake (do not copy blindly)

1. **Preferences live in the save document, not `localStorage`.** Rival has
   real platform storage (`src/host/SaveStore.ts`). Audio preferences go into
   the same save document, which means bumping Rival's own format `v` from 1
   to 2 and migrating v1 documents instead of rejecting them —
   `parseProgress` currently returns `null` for any `v !== 1`, which would
   silently wipe every existing player's best lap. See Task 1 §4.
2. **`capabilities.audio` is not declared yet.** `index.html` declares only
   `storage`. It gets `audio: true` in Task 2, and only once the mixer
   genuinely honours host mute (DESIGN §11).
3. **Rival has a real engine sound problem Snake did not have** — a continuous
   pitched loop, not one-shots. Task 2 §B treats it as the headline sound.
4. **The track is drawn from geometry, not from tiles.** Grok supplies
   *surface textures*, never track pieces; kerbs, borders, checkpoint lines
   and the start chequer stay procedural in `TrackRenderer.ts`.

## Definition of "polished" (the complete picture)

After all three tasks:

- A real main menu with RACE / SETTINGS, reachable again from pause and from
  the end screen — not a start screen that only exists on attempt 1.
- Settings for music and sound (on/off + volume), persisted in the save,
  layered under the platform's own mute-all button.
- Music in the menus, during the lap, and on the end screen; every meaningful
  event has a sound; the engine note tracks speed.
- Every visible surface image-backed: car, tarmac, infield, panel frames,
  buttons, medals, menu backdrop, and a real store card replacing `card.svg`.
- `playkiln validate` clean, package comfortably inside budget, and the
  manifest's `accent` finally agreeing with the game's own accent colour.
