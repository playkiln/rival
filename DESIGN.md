# Rival — design and build spec

How Rival is built. The decisions this is built *against* — the ones not to
relitigate — are in [AGENTS.md](AGENTS.md); this is the how.

## Build order, and why it is not negotiable

**Stage 1 — Driving.** One car, one track, no ghost, no score, no menu, no
persistence. Done when it is fun to drive with nothing else in the game.

**Stage 2 — The ghost.** Recording, playback, medals, the session lifecycle,
sound, the end screen. Done when the game is complete and publishable.

**Stage 3 — Saves.** The best lap survives between visits, on the platform's
storage capability (see §13). Additive by design: the game plays the same
without it.

Do not build stage 2 while stage 1 is unresolved. A progression system hides a
bad handling model — you stop noticing the car is unpleasant because you are
busy chasing a medal. If the driving is not enjoyable on its own, no amount of
ghost will save it, and everything built on top has to be re-tuned anyway.

**Expect to throw the first handling model away.** That is the expected path,
not a failure.

---

## 1. The simulation

**Fixed timestep, 60 Hz, accumulator.** Never drive the simulation from a
variable `dt`.

```
accumulator += frameDelta
while (accumulator >= STEP) { step(STEP); accumulator -= STEP }
render(accumulator / STEP)   // interpolate for smoothness
```

A variable timestep makes the *feel* frame-rate dependent, which is a bug in its
own right: the car handles differently on a 144 Hz monitor than on a throttled
phone. Render interpolation is worth doing immediately — the ghost interpolates
the same way, so the code is shared.

## 2. The car

One input: a boolean, `turning`. Down turns one way, up turns the other. Speed
is constant — no accelerator, no brake.

```
heading  += (turning ? +TURN_RATE : -TURN_RATE) * dt
position += direction(heading) * SPEED * dt
```

That is the whole model, and it is the *starting* point, not the answer. Tune
roughly in this order — the earlier ones move the feel most:

| Parameter | What it controls |
| --- | --- |
| `SPEED` | How much track passes per second — the pace of decisions |
| `TURN_RATE` | Corner radius; the single biggest feel lever |
| Turn ramp | Whether turn rate arrives instantly or eases in over ~100 ms |
| Drift / lateral slip | Whether velocity lags heading — adds weight |
| Off-track penalty | What happens when you leave the surface |

The first version will feel floaty. Floatiness is usually turn rate arriving
instantly plus no lateral slip; a short ease-in on the turn and a little
velocity lag are the two changes that most reliably make a one-input car feel
like it has mass.

## 3. The track

One track. Define it as a **centre-line polyline plus a width** — that single
structure gives you the drivable surface, the visual, and the checkpoints.

- **Checkpoints** at intervals along the centre line, ordered. A lap validates
  only if every checkpoint is passed in order. This is what stops a player
  cutting the circuit and posting a two-second lap.
- **Off-track slows the car.** Do not teleport, do not reset. A hard reset
  punishes a small mistake with the whole lap and kills the retry loop the game
  depends on. Slowing costs time proportionally, which is exactly the feedback a
  time trial wants.
- Design at least one corner that **rewards a non-obvious line**. That corner is
  where the ghost teaches. A track of uniform gentle bends gives the ghost
  nothing to say.

Resist adding a second track. One track, well tuned, with a ghost that teaches,
is better than three nobody replays.

## 4. Input

- Touch: `pointerdown` / `pointerup` anywhere on the canvas.
- Keyboard: any of space / arrow / `W` — one key, not a scheme.
- Both map to the same boolean. **No separate mobile control path.**
- Watch touch latency, and make sure `touch-action` does not let the browser
  read a hold as a scroll or a long-press.

## 5. Presentation

Enough to read the track at a glance and no more. Rival's visual identity is its
own — the Playkiln style guide governs the portal, not game packages. Keep the
canvas readable at phone size, and pick an aspect ratio early, since the portal
renders at the one the manifest declares.

---

## 6. Recording a lap

Sample at **20 Hz** — every third step at 60 Hz — capturing position and
heading:

```
{ t: frameIndex, x, y, heading }
```

20 Hz is chosen against interpolation quality, not fidelity: at racing speed the
car moves little enough in 50 ms that linear or Catmull-Rom interpolation
between samples is visually smooth. Higher rates cost payload for no visible
gain.

**Encode compactly.** A 45-second lap is ~900 samples — as naïve JSON floats
that is 30–40 KB. Target **under 8 KB**:

- Quantise to fixed-point integers — position to centimetres or track units,
  heading to 1/1024 turn. Sub-pixel precision is invisible.
- Delta-encode against the previous sample; consecutive deltas are small.
- Pack and base64 the result, or use a compact varint scheme.

Write the encoder and decoder as a **pure, round-trip-tested pair**: encode,
decode, assert the path matches within tolerance. This is the one part of Rival
worth unit tests — a silently lossy encoder produces a ghost that drifts through
walls and looks like a physics bug.

Record continuously; keep the recording only if the lap is valid *and* faster
than the current best.

## 7. Playing a ghost back

A second car sprite: translucent, non-colliding, driven purely by interpolating
recorded samples against the current run's elapsed time. There is no simulation,
which is exactly why it cannot desync.

Reuse the render interpolation from §1. The ghost should read as a racer, not a
replay scrubber — same sprite, lower alpha, no trail unless it aids legibility.

**Ghost and player must share one clock.** Driving the ghost from wall time
while the car runs on the fixed-step accumulator makes it drift late in a lap.

## 8. Medals — solving the cold start

Three ghosts ship **inside the package** as encoded data, hand-driven during
development: bronze, silver, gold.

- Session one races bronze. Beating a medal reveals the next.
- Beating gold switches the ghost permanently to the player's own best. With
  saves (§13) that survives the visit; on a host without them it lasts the tab.

This is why the game is complete without any storage: **there is always a
rival.**

Record the medal laps yourself once handling is final. Gold should be achievable
but demanding — if you cannot beat your own gold reliably, it is too fast.

Beating gold and switching to your own ghost is a real moment. Make it legible,
or players will not notice the game changed.

## 9. The session lifecycle

Wire the real contract, not an approximation. The Phaser boot contract in
[AGENTS.md](AGENTS.md) governs the order; this is what each moment carries.

| Moment | Call |
| --- | --- |
| Boot | `init()` → `HostInfo`; declare capabilities |
| Assets ready | `loading(progress)` then `ready()` |
| Host starts a run | `onSessionStart(ctx)` — one lap attempt; note `ctx.sessionId` |
| Lap finishes or player quits | `sessionEnd({ sessionId, outcome, score, durationMs })` |
| Player retries | `requestNewSession()` from the game's own end screen |
| Host tears down | `onTerminate(...)` — stop audio and the loop |

- `score` is **lap time in milliseconds**, with the manifest declaring
  `features.score: true` and `features.scoreDirection: 'lower'`. Rival is the
  first game on Playkiln to use `scoreDirection`, so treat it as untested.
- `outcome` is `'completed'` for a valid lap, `'quit'` if abandoned, `'failed'`
  for an invalid (cut) lap.
- **Echo the host-issued `sessionId` exactly.** A mismatch is rejected as
  `invalid_session`; the host takes the first `session.end` per session and
  marks later ones duplicate.

**Do not expect the platform to remember the score.** The portal discards
session results today and there is no score persistence. Rival's best time lives
in Rival's own save document, never in a platform record. This is deliberate.

## 10. The end screen

The game owns it — the portal shows no result chrome by design. It carries:

- the lap time,
- **the delta to the ghost**, which is the payoff of the whole design,
- the medal state,
- a retry button calling `requestNewSession()`.

Keep medal state legible even after gold is beaten. A player stuck below their
own best needs a visible target, or the ghost stops being motivating and starts
being a reproach.

## 11. Sound

Declare `capabilities.audio: true` **only once the mixer actually honours host
mute** — route all audio through one master gain, apply `getAudio()` at startup
and `onAudioChange` thereafter. The portal gates its speaker control on this
declaration, so declaring it falsely gives players a mute button that does
nothing.

An engine note pitched to speed, plus a checkpoint tick, is enough. Sound is not
where this game's novelty lives.

## 12. Manifest

```jsonc
{
  "schemaVersion": 1,
  "id": "rival",
  "minSdkVersion": 1,
  "features": { "score": true, "scoreDirection": "lower", "duration": true },
  "presentation": { /* cardImage, accent, icon, screenshots */ }
}
```

`minSdkVersion` stays **1** throughout. Run `playkiln validate` and fix
everything it reports: the package must be relocatable (no root-relative URLs)
with the SDK vendored and referenced relatively.

---

## 13. Saves

Built against SDK 1.1.0, which ships inside CLI 1.3.0. `src/host/SaveStore.ts`
owns the seam with the platform and `src/game/progress.ts` owns the format;
nothing else in the game knows saves exist. `MainScene` receives progress
through `setProgress` and announces changes through `setSaveHandler`, exactly
as it receives sessions — it never touches the SDK.

The save is one JSON object in a single opaque slot:

```jsonc
{
  "v": 1,                    // document format version, Rival's own
  "bestMs": 41230,
  "ghost": "<encoded lap>",  // §6's encoder output
  "medals": ["bronze", "silver"]
}
```

`v` is **Rival's** format version, not the platform's — the platform never
parses this. When Rival changes its own format it bumps `v` and handles the old
shape.

- **Reading**, after `init()` resolves and before `ready()`: if
  `HostInfo.storage` is absent, the host has no saves — run medals-only, with no
  error and no warning banner. If present, `await pk.storage.get()`; `null` is a
  first-time player, start at bronze.
- A document that fails to parse or carries an unknown `v` is **treated as
  absent**. Never let a corrupt save break the game; overwrite on the next best.
- **Writing** happens only on a new personal best and on first medal earned —
  never every lap.
- Write failures are non-fatal: `reportError({ fatal: false })` and carry on. A
  player who cannot save should still be able to race.
- Read the size limit from `HostInfo.storage.maxBytes` rather than hard-coding.
- Writes are queued, so two quick personal bests cannot land out of order.

A real document with a best lap in it is about **3.9 KB** — comfortably inside
both the 16 KB the game budgets for itself and the platform's 64 KB limit. The
size is asserted in `scripts/save.test.ts` so a change to the encoder cannot
quietly grow it.

The "no saved data" path is the normal case, not an error branch: a host with
no storage, a first-time player, and a document that will not parse are all
just `null`, and the medal ghosts make that a complete game (§8).

---

## Done means

**Stage 1**
- [ ] `playkiln preview` runs it; a lap can be driven start to finish.
- [ ] Fixed timestep; handling identical at 60 Hz, 144 Hz, and throttled mobile.
- [ ] One input, touch and keyboard, no separate code path.
- [ ] Checkpoints prevent a cut lap from validating.
- [ ] Leaving the track costs time without resetting the run.
- [ ] **It is fun to drive with nothing else in the game.**

**Stage 2**
- [ ] Encoder/decoder round-trips within tolerance, unit tested.
- [ ] A recorded lap plays back as a ghost following the driven path.
- [ ] Encoded lap under 8 KB.
- [ ] Three medal ghosts in the package; session one has a rival.
- [ ] Full lifecycle correct against the real host in `playkiln preview`,
      including replay via `requestNewSession()`.
- [ ] `score` is lap milliseconds; manifest declares `scoreDirection: 'lower'`.
- [ ] Host mute silences the game; `audio` declared only because it is true.
- [ ] `playkiln validate` passes clean.
- [ ] **The game is publishable as-is, with no platform change.**
