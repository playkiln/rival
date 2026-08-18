import Phaser from 'phaser'

/** Rival's own look: dark panels, one warm accent, monospace numbers. */
export const UI = {
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  text: '#e8eaed',
  dim: '#9aa3b2',
  accent: '#ffb347',
  accentHex: 0xffb347,
  good: '#7ee0a0',
  bad: '#ff8fa0',
  bronze: '#d19a66',
  silver: '#c9d1dc',
  gold: '#ffd166',
} as const

/**
 * The UI art. Frames are nine-sliced from images generated at 2× and drawn
 * at half scale, so the corner brackets keep their proportion on any panel
 * and stay crisp on dense screens. Insets are the ones tools/key-art.mjs
 * printed for the source images.
 */
const ART = {
  panel: { key: 'panel-frame', file: 'assets/art/panel-frame.png', inset: 72 },
  button: { key: 'button-frame', file: 'assets/art/button-frame.png', insetX: 64, insetY: 16 },
  backdrop: { key: 'backdrop', file: 'assets/art/backdrop.jpg' },
  logo: { key: 'logo', file: 'assets/art/logo.png' },
  medals: { bronze: 'assets/art/medal-bronze.png', silver: 'assets/art/medal-silver.png', gold: 'assets/art/medal-gold.png' },
} as const

export type MedalTier = keyof typeof ART.medals

/** Queue every UI image. */
export function queueUiAssets(load: Phaser.Loader.LoaderPlugin): void {
  load.image(ART.panel.key, ART.panel.file)
  load.image(ART.button.key, ART.button.file)
  load.image(ART.backdrop.key, ART.backdrop.file)
  load.image(ART.logo.key, ART.logo.file)
  for (const [tier, file] of Object.entries(ART.medals)) load.image(`medal-${tier}`, file)
}

export function label(
  scene: Phaser.Scene,
  str: string,
  size: number,
  color: string = UI.text,
  align: 'left' | 'center' | 'right' = 'center',
): Phaser.GameObjects.Text {
  const t = scene.add.text(0, 0, str, { fontFamily: UI.font, fontSize: `${size}px`, color, align })
  t.setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5)
  return t
}

export type Button = {
  container: Phaser.GameObjects.Container
  setLabel(text: string): void
}

/**
 * A tappable button. The press is swallowed (stopPropagation) so it never
 * reaches the scene's turn input — the whole canvas is otherwise "hold".
 *
 * One frame image serves every button; the primary state is an accent fill
 * laid inside the frame and the hover state a light wash over it, both drawn
 * in code, so the states can never drift from each other.
 */
export function button(
  scene: Phaser.Scene,
  text: string,
  width: number,
  height: number,
  onPress: () => void,
  primary = false,
  silent = false,
): Button {
  const frame = scene.add
    .nineslice(0, 0, ART.button.key, undefined, width * 2, height * 2, ART.button.insetX, ART.button.insetX, ART.button.insetY, ART.button.insetY)
    .setScale(0.5)
  const state = scene.add.graphics()
  const draw = (hover: boolean): void => {
    state.clear()
    // Inside the frame's border, above its amber underline.
    const inset = 3
    const r = Math.min(8, height / 2 - inset)
    if (primary) {
      state.fillStyle(UI.accentHex, hover ? 1 : 0.94)
      state.fillRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2 - 1, r)
    } else if (hover) {
      state.fillStyle(0xffffff, 0.1)
      state.fillRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2 - 1, r)
    }
  }
  draw(false)
  const t = label(scene, text, 17, primary ? '#1a1206' : UI.text)
  const zone = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true })
  zone.on('pointerover', () => draw(true))
  zone.on('pointerout', () => draw(false))
  zone.on(
    'pointerdown',
    (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation()
      // Announced on the scene rather than played here: widgets know nothing about audio.
      if (!silent) scene.events.emit('ui:tap')
      onPress()
    },
  )
  const container = scene.add.container(0, 0, [frame, state, t, zone])
  return {
    container,
    setLabel(s: string) {
      t.setText(s)
    },
  }
}

export type SettingRow = {
  container: Phaser.GameObjects.Container
  setValue(text: string): void
}

/**
 * One settings row: a label on the left, a small cycling value button on the
 * right. Cycling — not sliding — because it works identically on touch and
 * needs no drag handling, and the values are few enough to tap through.
 */
export function settingRow(scene: Phaser.Scene, name: string, width: number, onCycle: () => void): SettingRow {
  const t = label(scene, name, 15, UI.dim, 'left')
  t.setX(-width / 2)
  // Silent: the value change itself has a sound (`ui-toggle`), and two clicks per tap is one too many.
  const value = button(scene, '', 96, 32, onCycle, false, true)
  value.container.setX(width / 2 - 48)
  const container = scene.add.container(0, 0, [t, value.container])
  return {
    container,
    setValue(s: string) {
      value.setLabel(s)
    },
  }
}

/** The panel frame, centred on its container. One image dresses every panel. */
export function panelFrame(scene: Phaser.Scene, width: number, height: number): Phaser.GameObjects.NineSlice {
  const i = ART.panel.inset
  return scene.add.nineslice(0, 0, ART.panel.key, undefined, width * 2, height * 2, i, i, i, i).setScale(0.5)
}

/** The scenery behind the menu, settings and end panels: cover-fitted to the viewport by `layout`. */
export function backdropImage(scene: Phaser.Scene): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, ART.backdrop.key).setAlpha(0.9)
}

/** Cover-fit an image to a box: fills it, cropping the long side. */
export function coverFit(img: Phaser.GameObjects.Image, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height)
  img.setScale(s).setPosition(w / 2, h / 2)
}

/** The wordmark, at a given width. */
export function logo(scene: Phaser.Scene, width: number): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, ART.logo.key)
  img.setScale(width / img.width)
  return img
}

/** A medal at a given height. */
export function medal(scene: Phaser.Scene, tier: MedalTier, height: number): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, `medal-${tier}`)
  img.setScale(height / img.height)
  return img
}
