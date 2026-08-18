# Rival

A single-input top-down time trial for [Playkiln](https://playkiln.com). Hold to
turn one way, release to turn the other — that is the whole control scheme, on
touch and on keyboard. Speed is constant; the skill is the racing line.

Your best lap comes back as a **ghost** you race. A time tells you *that* you
were slower. A ghost tells you *where*.

> **Status: in development.** This repository is the source as it is being
> built. Rival is not live yet.

## Built against

Per [`docs/versioning.md`](https://playkiln.com) §7, a published game records the
versions it shipped against. These are the versions at scaffold time and will be
updated at release:

| Field | Value |
| --- | --- |
| Protocol | 1 (`minSdkVersion: 1`) |
| SDK | `@playkiln/game-sdk` 1.0.0, vendored into `public/playkiln-sdk.js` |
| CLI | `@playkiln/cli` 1.2.0 |
| Capabilities | `storage`, `audio` (declared at runtime in `init`, both honoured) |

## Not maintained forward

This repository is an honest record of one game, not a maintained example. Once
Rival ships it is pinned to the versions above and is **not** updated as the SDK
or CLI move on. It keeps playing regardless, because a published game on
Playkiln plays forever.

If you are learning to build for Playkiln, read
[`playkiln/starters`](https://github.com/playkiln/starters) instead — the
teaching burden lives there, deliberately.

## Commands

```bash
npm install
npm run dev          # local Vite dev server
playkiln preview     # build + real Playkiln host sandbox
playkiln validate    # build when needed, then validate dist/
playkiln publish     # build → validate → deterministic ZIP + checksum
```

Assets are derived, never hand-edited. The raw Suno and Grok deliveries live
in `asset-inbox/` (with the prompts that produced them in
`asset-inbox/PROMPTS.md`), and three tools turn them into what ships:

```bash
bash tools/process-music.sh   # loops + sting → public/assets/audio/music
node tools/generate-sfx.mjs   # synthesized SFX → public/assets/audio/sfx
node tools/key-art.mjs        # keyed, sliced, sized art → public/assets/art
```

Validation and publish always check the production package in `dist/`, not the
source tree. Presentation assets live under `public/` and are copied into
`dist/` by `npm run build` (or automatically by the CLI commands above).

## Game page (`playkiln.page.md`)

`playkiln.page.md` is the builder-authored main column on the public game page.
The Vite package plugin copies it into `dist/` next to the manifest (same as
`playkiln.manifest.json`). Supported markdown includes headings, lists, tables,
links, images, code, and blockquotes — raw HTML is not rendered.

## Identity

- Display title: **Rival**
- Game slug (manifest `id`): **rival**

The package declares only the slug. The platform binds the Builder handle at
authenticated publication.

## Host lifecycle

The official SDK is loaded from `public/playkiln-sdk.js`:

1. `Playkiln.init()`, apply `HostInfo.audio.muted` to Phaser `sound.mute`,
   register handlers, then `ready()`
2. Host sends `session.start` (`{ sessionId, attempt }`)
3. Game plays and reports the result with `sessionEnd`
4. Game shows its own game-over screen; "Play again" calls
   `requestNewSession()` and the host answers with a new `session.start`
5. Honor `terminate`: stop the run and go quiet
6. Honor the host sound preference: `onAudioChange` drives `sound.mute`.
   All audio goes through Phaser's Sound Manager — no side `AudioContext`

## AI assistants

You may use Codex, Claude, Cursor, or no assistant. Platform truth is the
Playkiln contract and validator, not model training data.

## License

MIT — see [LICENSE](LICENSE).
