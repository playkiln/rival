/**
 * Screenshot the game inside the real `playkiln preview` host using headless
 * Chrome over the DevTools protocol — no extra dependencies.
 *
 *   node scripts/shot.mjs out.png [--flag autodrive] [--hold 1200,300 ...] [--press 2000,Space ...] [--click 3000,0,50 ...]
 *                         [--nostart] [--wait 3000] [--total 6000] [--size 1280x720] [--shots a.png ...]
 *
 * Steps: open the preview, optionally set rival.dev.<flag>=1 in the game's
 * localStorage and reload, press the host's session.start, then over `total`
 * ms: hold the turn input for the given windows, press keys at the given
 * times, capture extra shots at the given times; capture `out` at the end.
 * Prints the host protocol log tail so the sessionEnd trail can be checked.
 * Requires `playkiln preview` running on 127.0.0.1:5180 and Chrome installed.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5180/'
const PORT = 9333

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'shot.png'
const holds = []
const presses = []
const shots = []
const flags = []
const clicks = []
let wait = 2500
let total = null
let nostart = false
let size = [1280, 720]
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--hold') holds.push(args[++i].split(',').map(Number))
  if (args[i] === '--press') { const [t, k] = args[++i].split(','); presses.push([Number(t), k]) }
  if (args[i] === '--shots') { const [f, t] = args[++i].split('@'); shots.push([f, Number(t)]) }
  if (args[i] === '--click') { const [t, dx, dy] = args[++i].split(',').map(Number); clicks.push([t, dx, dy]) }
  if (args[i] === '--flag') flags.push(args[++i])
  if (args[i] === '--nostart') nostart = true
  if (args[i] === '--wait') wait = Number(args[++i])
  if (args[i] === '--total') total = Number(args[++i])
  if (args[i] === '--size') size = args[++i].split('x').map(Number)
}

const profile = mkdtempSync(join(tmpdir(), 'rival-shot-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${size[0]},${size[1]}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  'about:blank',
])
chrome.stderr.on('data', () => {})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {}
    await sleep(100)
  }
  throw new Error('chrome did not open the devtools port')
}

let nextId = 1
const pending = new Map()
let ws
function send(method, params = {}, sessionId) {
  const id = nextId++
  const msg = { id, method, params }
  if (sessionId) msg.sessionId = sessionId
  ws.send(JSON.stringify(msg))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function main() {
  const version = await waitForDevtools()
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const cdp = (method, params) => send(method, params, sessionId)
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: size[0],
    height: size[1],
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp('Page.navigate', { url: URL })
  await sleep(wait)

  // Dev flags live in the game's own localStorage (same origin as the host
  // page in preview); set them, then reload the package through the host.
  if (flags.length) {
    const r = await cdp('Runtime.evaluate', {
      expression: `(() => {
        const f = document.querySelector('iframe'); if (!f) return 'no iframe'
        try { ${JSON.stringify(flags)}.forEach(k => f.contentWindow.localStorage.setItem('rival.dev.' + k, '1')) } catch (e) { return 'flag error ' + e.message }
        const btn = [...document.querySelectorAll('button')].find(b => /reload/i.test(b.textContent))
        if (btn) btn.click()
        return 'flags set' + (btn ? ', reloaded' : ' (no reload button)')
      })()`,
      returnByValue: true,
    })
    console.log(r.result.value)
    await sleep(wait)
  }

  // Press the host's session.start control (unless --nostart: the host
  // auto-starts attempt 1 on ready, which is the only way to see attempt 1).
  const started = nostart ? { result: { value: 'not started (autostart only)' } } : await cdp('Runtime.evaluate', {
    expression: `(() => {
      const els = [...document.querySelectorAll('button, [role=button], input[type=button]')]
      const el = els.find(e => /session\.start|start session|start/i.test(e.textContent || e.value || ''))
      if (!el) return 'no start control: ' + els.map(e => (e.textContent||e.value||'').trim()).join(' | ')
      el.click(); return 'clicked: ' + (el.textContent || el.value).trim()
    })()`,
    returnByValue: true,
  })
  console.log(started.result.value)

  const t0 = Date.now()
  const iframeRect = await cdp('Runtime.evaluate', {
    expression: `(() => { const f = document.querySelector('iframe'); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    returnByValue: true,
  })
  const at = iframeRect.result.value ?? { x: size[0] / 2, y: size[1] / 2 }
  // Focus the game so key presses land in the iframe.
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })

  // Merge everything into one timeline.
  const events = []
  for (const [s, d] of holds) {
    events.push({ t: s, run: () => cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 }) })
    events.push({ t: s + d, run: () => cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 }) })
  }
  const KEYS = { Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, KeyP: { key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 } }
  for (const [t, k] of presses) {
    const key = KEYS[k] ?? { key: k, code: k }
    events.push({ t, run: async () => {
      // Click the iframe first so it has keyboard focus, without a drag.
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 })
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
      await sleep(80)
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    } })
  }
  for (const [t, dx, dy] of clicks) {
    events.push({ t, run: async () => {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x + dx, y: at.y + dy, button: 'left', clickCount: 1 })
      await sleep(60)
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + dx, y: at.y + dy, button: 'left', clickCount: 1 })
    } })
  }
  for (const [f, t] of shots) {
    events.push({ t, run: async () => {
      const s = await cdp('Page.captureScreenshot', { format: 'png' })
      writeFileSync(f, Buffer.from(s.data, 'base64'))
      console.log('wrote', f, 'at', t)
    } })
  }
  events.sort((a, b) => a.t - b.t)
  const end = total ?? (events.length ? Math.max(...events.map((e) => e.t)) + 400 : 2200)
  for (const e of events) {
    await sleep(Math.max(0, t0 + e.t - Date.now()))
    await e.run()
  }
  await sleep(Math.max(0, t0 + end - Date.now()))

  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('wrote', out)

  // Pull anything the host logged, for the protocol trail.
  const log = await cdp('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('pre, [class*=log], textarea'); return el ? el.textContent.slice(-2500) : '' })()`,
    returnByValue: true,
  })
  if (log.result.value) console.log('--- host log tail ---\n' + log.result.value.replace(/\[(\d\d:\d\d:\d\d)\]/g, '\n[$1]'))
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    chrome.kill()
  })
