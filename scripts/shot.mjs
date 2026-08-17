/**
 * Screenshot the game inside the real `playkiln preview` host using headless
 * Chrome over the DevTools protocol — no extra dependencies.
 *
 *   node scripts/shot.mjs out.png [--hold 1200,300 --hold 2000,400] [--wait 3000] [--size 1280x720]
 *
 * Steps: open the preview, press the host's session.start, optionally hold
 * the "turn" input for the given windows (start,duration in ms), then capture.
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
let wait = 2500
let size = [1280, 720]
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--hold') holds.push(args[++i].split(',').map(Number))
  if (args[i] === '--wait') wait = Number(args[++i])
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

  // Press the host's session.start control, whatever it is called in the DOM.
  const started = await cdp('Runtime.evaluate', {
    expression: `(() => {
      const els = [...document.querySelectorAll('button, [role=button], input[type=button]')]
      const el = els.find(e => /session\\.start|start session|start/i.test(e.textContent || e.value || ''))
      if (!el) return 'no start control: ' + els.map(e => (e.textContent||e.value||'').trim()).join(' | ')
      el.click(); return 'clicked: ' + (el.textContent || el.value).trim()
    })()`,
    returnByValue: true,
  })
  console.log(started.result.value)

  // Drive: hold the pointer on the game canvas for each window.
  const t0 = Date.now()
  const iframeRect = await cdp('Runtime.evaluate', {
    expression: `(() => { const f = document.querySelector('iframe'); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    returnByValue: true,
  })
  const at = iframeRect.result.value ?? { x: size[0] / 2, y: size[1] / 2 }
  const end = holds.length ? Math.max(...holds.map(([s, d]) => s + d)) + 400 : 2200
  for (const [start, dur] of holds) {
    await sleep(Math.max(0, t0 + start - Date.now()))
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await sleep(dur)
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  }
  await sleep(Math.max(0, t0 + end - Date.now()))

  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('wrote', out)

  // Pull anything the host logged, for the protocol trail.
  const log = await cdp('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('pre, [class*=log], textarea'); return el ? el.textContent.slice(-1500) : '' })()`,
    returnByValue: true,
  })
  if (log.result.value) console.log('--- host log tail ---\n' + log.result.value)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    chrome.kill()
  })
