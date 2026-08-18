# Working prompts

The standing instructions for building Rival. Pointing an assistant at this file
is the same as typing the active prompt below.

**Do only what is under "Active now."** Everything under "Later" is triggered
by the builder saying so, never by reading this file. If you have just been
handed this file and nothing else, the active prompt is the one and only thing
to act on.

---

## Active now — Stage 1: Driving

> Read `DESIGN.md` and `AGENTS.md`, then build **Stage 1 only**: one car, one
> track, no ghost, no medals, no score, no end screen.
>
> Work to the Stage 1 checklist under "Done means". The bar is that it is fun to
> drive with nothing else in the game — not that the checklist is ticked.
>
> Run `playkiln preview` and tell me when there is something to drive. I judge
> the feel; you tune against what I say. Expect the first handling model to be
> thrown away — that is the expected path, not a failure.
>
> Do not build anything from Stage 2 or 3. Do not reach into the Playkiln
> monorepo — build against the CLI, the validator and the published contract
> only. If something is impossible to work out from those, say so; that is a
> finding worth recording, not a reason to go looking.

That last paragraph is the one that matters. Rival's whole build order exists to
stop a progression system hiding a bad handling model, and an assistant that has
read `DESIGN.md` will otherwise helpfully start on the ghost.

## Talking about feel

Be concrete rather than asking for a fix.

- **Works:** "too floaty in the tight left — the car pivots without carrying any
  weight." That points at the turn ramp and lateral slip.
- **Does not work:** "make it feel better." That produces a random walk through
  five parameters.

Name the corner, name what the car did, name what you expected instead.

---

## Later — only when the builder says so

**When Stage 1 is called done**

> Give me the parameter values you settled on and why, then stop. I want to
> drive it more before we move on.

Locks the tuning in as a decision rather than an accident, and stops the work
rolling into Stage 2 on its own.

**When you hit starter or CLI friction**

> Record that in the commit message for this change, on a line starting
> "Finding:".

These are feedback on the Playkiln tooling, gathered by building a real game
with it. `Finding:` makes them greppable later:

```bash
git log --grep='^Finding:' --all
```
