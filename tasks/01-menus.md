# Task 1 — Menus & flow

**Goal:** a real main menu, a pause menu that can reach it, and a settings
panel — without adding a single tap to the finish → RACE AGAIN loop.

**Owner:** Claude (all code). No assets needed.

**Depends on:** nothing.

---

## The problem being fixed

`MainScene.beginSession()` branches on `ctx.attempt === 1`: the start screen
exists only on the first session of a page load. After that, every session
goes straight to the countdown, and there is no way back to a menu for the
rest of the visit. Pause offers RESUME and RESTART only. There is nowhere to
put settings, and nowhere to see the medal ladder except in passing.

## Target flow

```text
session.start ─► MAIN MENU ──RACE──► COUNTDOWN ─► RACING ──finish──► END
                   ▲   ▲                 │                        │   │
                   │   │                 ▼                        │   │
                   │   └── PAUSE ── RESUME / RESTART / SETTINGS ───┘   │
                   │         │                                        │
                   │         └── MAIN MENU (quit)                     │
                   └──────────── MAIN MENU ◄─────────────────────────-┘
                              (RACE AGAIN, 1 tap) ◄───────────────────┘
```

- **Main menu** — title, the rival you are about to race, your best, the
  medal ladder (three pips, earned ones lit), **RACE** (primary), **SETTINGS**.
  Every `session.start` that is not an immediate replay lands here.
- **Countdown / racing** — unchanged, plus the existing pause button.
- **Pause** — RESUME (primary), RESTART, SETTINGS, MAIN MENU.
- **End screen** — unchanged content (time, delta, medal, next rival) plus a
  quiet **MENU** secondary next to RACE AGAIN.
- **Settings** — MUSIC on/off, MUSIC volume, SOUND on/off, SOUND volume, BACK.
  Reachable from main menu and pause; returns to whichever opened it.

## Structural changes

1. **Kill the attempt branch.** `beginSession` stops inspecting `ctx.attempt`.
   The scene tracks *why* the session was requested instead:
   `nextSessionIntent: 'race' | 'menu'`, set at `requestReplay()` time,
   defaulting to `'menu'`. RACE AGAIN sets `'race'`; quit-to-menu and restart
   set `'menu'`; the first session of a page load is `'menu'` by default.
2. **State machine.** `State` becomes
   `'idle' | 'menu' | 'settings' | 'countdown' | 'racing' | 'finished'`, with
   `paused` staying an orthogonal flag as it is today. Settings is a panel
   over a remembered `returnTo` state, not a state that can be resumed into.
3. **Quit to menu ends the session honestly** — `outcome: 'quit'` with the
   live `sessionId`, then `requestNewSession()`, exactly as `restartRun()`
   already does. The only difference is the intent it leaves behind.
4. **Preferences in the save document.** `src/game/settings.ts` (new) owns
   `Preferences` + `DEFAULT_PREFERENCES` + `sanitizePreferences`, mirroring
   Snake's file. `src/game/progress.ts` grows a `prefs` field on
   `SaveDocument` and **bumps `SAVE_FORMAT_VERSION` to 2**:
   - `parseProgress` accepts `v === 1` and `v === 2`. A v1 document is a valid
     v2 document with default preferences — it must never be treated as
     absent, or every existing player loses their best lap and medals.
   - Anything else still yields `null`. Keep the existing
     "treated as absent" contract for genuinely unknown versions.
   - `scripts/save.test.ts` gains a v1→v2 migration case and keeps asserting
     the size budget (preferences add ~60 bytes).
   - Writing preferences follows the same queued path as a new best. Changing
     a volume writes; it is a rare, deliberate action, not a per-lap write.
5. **Widgets.** `src/game/ui/widgets.ts` gains a `toggleRow(label, value)` —
   a labelled row with a cycling value button — reused by all four settings
   rows. Volume cycles 0 → 20 → … → 100 % like Snake's `nextVolume`; it needs
   no drag handling and works identically on touch.
6. **Panel sizing.** Standardise all four panels (menu, pause, settings, end)
   on one footprint so Task 3's frame art fits every one of them without
   distortion. Today they are 340×320, 300×200 and 360×316. Target **360×340**
   with the existing small-screen scale clamp unchanged.
7. **Input guards.**
   - Space/Enter stays the primary action: RACE on the menu, RESUME when
     paused, RACE AGAIN on the end screen. Inert on the settings panel.
   - Esc/P: racing → pause, paused → resume, settings → back, menu → ignored.
   - The end screen's primary stays inert for ~400 ms after it appears, so
     mashing the turn key at the finish line cannot skip the result unseen.
     (New — Rival does not have this guard today and the whole payoff of the
     game is on that panel.)
   - Pointer-down on the canvas still starts the race from the menu, but not
     while the settings panel is up.

## Also fix while in here

- `playkiln.page.md` still says "Your best lap and medals last for the visit.
  Saving between visits arrives when the platform offers storage." Stage 3
  shipped; update the copy and document the settings.
- Manifest `presentation.accent` is `#6c8cff`; the game's accent is `#ffb347`
  (`UI.accent`). Pick the amber and make the portal match the game.

## Acceptance criteria

- [ ] Finish → RACE AGAIN → new lap: exactly 1 tap, no menu, no regression.
- [ ] Finish → MENU → RACE: 2 taps, correct rival shown.
- [ ] Pause → MAIN MENU reports `outcome: 'quit'` with the correct sessionId,
      then lands on the main menu with a fresh session.
- [ ] Settings reachable from both menu and pause, and BACK returns to the
      right one.
- [ ] A v1 save document loads with its best lap, medals and default
      preferences intact, and is rewritten as v2 on the next write.
- [ ] A corrupt or unknown-version document is still treated as absent.
- [ ] Medal ladder visible on the main menu and legible after gold is beaten.
- [ ] Terminate during any state goes quiet — no stray sessionEnd or
      requestNewSession after.
- [ ] `npm run build` clean, `npm test` clean, `playkiln validate` passes.
