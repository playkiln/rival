# Rival

A small Rival session on Playkiln.

This file is **your** game page on Playkiln. It ships in the package next to
`playkiln.manifest.json` and is rendered on `/game/rival` as the main column
under the play surface. Edit it freely — this is builder voice, not platform copy.

## How to play

1. Press **Play now** on the game page.
2. [Describe the goal in one sentence.]
3. [What counts as a good run?]

## Controls

| Input | Action |
| --- | --- |
| Click / tap | [Primary action] |
| Arrow keys / WASD | [Movement, if any] |

## Build notes

This starter uses Phaser + Vite. Run `npm install` then `playkiln preview`.
Ship only the production build contents your publish path packages.

## Tips

- Keep this page short and concrete.
- Supported markdown: headings, paragraphs, lists, tables, links, images,
  code blocks, and blockquotes. Raw HTML is not rendered.
- Package-relative images work (`![shot](assets/card.svg)`).
- If you omit `descriptionFile` from the manifest, the page falls back to the
  manifest `description` string, then `tagline`.
