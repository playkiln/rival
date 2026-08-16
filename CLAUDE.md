# Rival

Read **[AGENTS.md](AGENTS.md)** and **[DESIGN.md](DESIGN.md)** before working in
this repository.

- `AGENTS.md` — the Playkiln host boot contract, the design decisions that are
  closed, the boundaries of this repository, and commit rules. The identity rule
  in it matters: this repository is public and commits must stay pseudonymous.
- `DESIGN.md` — how Rival is built: simulation, track, ghost encoding, session
  lifecycle, and what done means at each stage.

A real file rather than a symlink to `AGENTS.md`, because this repository is
cloned on Windows, where git symlinks need `core.symlinks` and developer mode.
