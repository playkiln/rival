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
  panel: 0x141821,
  panelStroke: 0x2a3140,
  bronze: '#d19a66',
  silver: '#c9d1dc',
  gold: '#ffd166',
} as const

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
 */
export function button(
  scene: Phaser.Scene,
  text: string,
  width: number,
  height: number,
  onPress: () => void,
  primary = false,
): Button {
  const bg = scene.add.graphics()
  const draw = (hover: boolean): void => {
    bg.clear()
    if (primary) {
      bg.fillStyle(UI.accentHex, hover ? 1 : 0.92)
    } else {
      bg.fillStyle(0xffffff, hover ? 0.14 : 0.08)
    }
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8)
    if (!primary) {
      bg.lineStyle(1.5, 0xffffff, 0.25)
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8)
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
      onPress()
    },
  )
  const container = scene.add.container(0, 0, [bg, t, zone])
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
  const value = button(scene, '', 96, 32, onCycle)
  value.container.setX(width / 2 - 48)
  const container = scene.add.container(0, 0, [t, value.container])
  return {
    container,
    setValue(s: string) {
      value.setLabel(s)
    },
  }
}

/** Rounded backdrop for a panel, centred on its container. */
export function backdrop(scene: Phaser.Scene, width: number, height: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  g.fillStyle(UI.panel, 0.96)
  g.fillRoundedRect(-width / 2, -height / 2, width, height, 14)
  g.lineStyle(2, UI.panelStroke, 1)
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, 14)
  return g
}
