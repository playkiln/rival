# Rival — agent notes

This is a Playkiln game package (slug `rival`).

## Rules

- Keep `playkiln.manifest.json` valid. `id` is the game slug only (no builder handle).
- Use the official SDK via `window.Playkiln` (loaded from `playkiln-sdk.js`).
- Do not embed payment providers, accounts, or platform navigation.
- Package must be static (no server runtime). `privacy.usesNetwork` must match reality.
- Build output is `dist/` and must include the manifest, entry HTML, assets, and SDK.

## Playkiln × Phaser (boot contract — do not regress)

1. `init()` first, apply `HostInfo.audio.muted` to Phaser `sound.mute`,
   register `onAudioChange` / `onSessionStart` / `onTerminate`, then
   `ready()`. Handlers must exist before `ready()`, never after. All
   audio goes through Phaser's Sound Manager — no side `AudioContext`.
2. `new Phaser.Game(...)` boots **asynchronously**. Await game ready and a running
   scene; never call `getScene()` on the line after the constructor, and never call
   methods on the result without waiting for it.
3. Queue `session.start` until the scene is bound, then `beginSession`. Never
   drop a session — the host starts the first one the instant it sees `ready`.
4. The game owns the whole run, including the ending. When a run ends, report
   the result with `sessionEnd` and show the in-game game-over screen. "Play
   again" calls `requestNewSession()` — fire-and-forget; the host answers with
   a fresh `session.start`, which must reset the run cleanly.
5. If the engine fails to bind, `reportError({ fatal: true })` — do **not** call
   `ready()`. `ready` means "I can accept sessions"; a game that cannot must say so.
6. Read the save **before** `ready()`. `ready` licenses the host to start
   session one immediately, and a session that starts before the save is read
   races the wrong ghost. `HostInfo.storage` absent means this host has no
   saves: run medals-only, with no error and no banner. A document that will
   not parse is treated as absent — a corrupt save must never break the game.
   Write only on a new personal best or a newly earned medal, never every lap,
   and treat write failures as non-fatal.
7. `src/host/GameHost.ts` and `src/host/SaveStore.ts` own all of the above.
   Gameplay code stays in `src/game/`, knows nothing about postMessage or the
   SDK, and is driven only through `beginSession` / `abortSession` /
   `setEndHandler` / `setReplayHandler` / `setProgress` / `setSaveHandler`.
8. Truth is `playkiln validate` and the `playkiln preview` protocol log — not
   assistant memory. If preview hangs on "waiting for host session", look for
   `ready` and for `iframe.exception` lines in that log before suspecting the host.

## Useful commands

```bash
npm run dev
npm run build
playkiln preview
playkiln validate
playkiln publish
```

## Loop

Edit `src/game/MainScene.ts` for gameplay. Leave the boot sequence in `src/main.ts`
and the host bus in `src/host/GameHost.ts` alone unless you are changing lifecycle
behavior on purpose — see the boot contract above.

---

# Rival — the game

Everything above is the Playkiln starter as it shipped, and it applies. What
follows is specific to Rival.

## What Rival is

A single-input top-down time trial. Hold to turn one way, release to turn the
other. Constant speed, no accelerator, no brake. Your best lap returns as a
ghost you race.

## Design decisions — closed, do not re-derive

These were argued through before any code was written. If you think one is
wrong, say so and stop; do not quietly build the other thing.

1. **One input, one implementation.** A boolean `turning`, identical on touch
   (`pointerdown`/`pointerup`) and keyboard (space / arrow / `W` — one key, not
   a scheme). No separate mobile control path.
2. **Fixed timestep, 60 Hz, accumulator.** Never drive the simulation from a
   variable `dt` — the car must not handle differently on a 144 Hz monitor than
   on a throttled phone. Interpolate on render; the ghost interpolates the same
   way, so the code is shared.
3. **The ghost is the design.** A number tells you *that* you were slower; a
   ghost tells you *where*. Everything else serves that.
4. **Position replay, not input replay.** Sample position and heading at 20 Hz
   and store those. Input replay is smaller but demands a simulation that never
   diverges; position replay cannot desync because there is nothing to diverge.
   This is the single biggest scope saver in the project.
5. **The ghost is your best lap**, not your previous one, and there is no
   toggle. Your best is provably achievable because you drove it.
6. **Authored medal ghosts ship inside the package** — three hand-driven laps
   at bronze/silver/gold pace. Session one has a rival, the game has a
   difficulty curve, and **the game is fully playable with no storage at all.**
   Storage upgrades Rival; it does not enable it.
7. **The game owns its game-over screen**, as the contract requires: lap time,
   delta to the ghost, medal, retry. Retry is `requestNewSession()`.
8. **Off-track slows the car.** Never teleport, never reset the run — a hard
   reset punishes a small mistake with the whole lap and kills the retry loop
   the game depends on.
9. **Checkpoints in order validate a lap**, so the circuit cannot be cut.
10. **The visual identity is Rival's own.** `docs/styleguide.md` is the
    portal's design system and does not govern game packages.

## Boundaries

- **This repository does not read the Playkiln monorepo.** Rival is built the
  way an outside builder would build it: the shipped CLI, the starter as it
  ships, `playkiln validate`, `playkiln preview`, and the published contract
  docs. If something is impossible to work out from those, that is a finding
  about the platform — record it, do not reach into platform source to unblock.
- **Report friction.** Starter rough edges, confusing CLI output, missing docs:
  write them down. They are the point, not a distraction.
- Process, phases and platform-side work live in the Playkiln monorepo under
  `task-force/012-second-lap/`. Nothing about that belongs in this repository.

## Commits

- Prefix `game:`. Match the style of existing history: what changed and why,
  not a changelog line.
- **Identity is pseudonymous and must stay that way from the first commit.**
  This repository is public. `git log --format='%an <%ae>'` must show only the
  project persona and a `users.noreply.github.com` address — check before
  pushing, never after. The same goes for anything embedded in the package:
  the manifest `developer` block, credits, comments.

## Manifest and capabilities

The manifest declares `features.scoreDirection: lower` (lap milliseconds).
`capabilities` are declared at runtime in the `init` payload, not in the
manifest, and only once true — `audio` when the sound stage lands, `storage`
when saves land. Today the payload declares none.
