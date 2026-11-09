#!/usr/bin/env node
// Screenshots every page of a local site: desktop, mobile, reduced motion and each hover state it finds.
// Usage: node shoot.mjs http://localhost:5173 [--out shots] [--pages /,/about] [--max-pages 12] [--max-hovers 8] [--allow-host fonts.gstatic.com]
// Needs playwright in the project or on NODE_PATH; SKILL.md has the pinned install.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def }
const base = args.find(a => /^https?:\/\//.test(a))
const out = path.resolve(opt('--out', 'shots'))
const maxPages = Number(opt('--max-pages', 12)), maxHovers = Number(opt('--max-hovers', 8))

const fail = msg => { console.error(msg); process.exit(2) }
if (!base) fail('usage: node shoot.mjs <local url> [--out shots] [--pages /,/about]')
const origin = new URL(base)
const LOCAL = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']
// 3000 and 3131 belong to other apps on this machine.
const OFF_LIMITS = ['3000', '3131']
if (!LOCAL.includes(origin.hostname)) fail(`${origin.hostname} is not local; serve the site locally first`)
if (OFF_LIMITS.includes(origin.port)) fail(`port ${origin.port} is off limits; serve on another port`)
// Fonts, images, stylesheets and media only; never scripts, fetches, documents or sockets.
const allowHosts = opt('--allow-host', '').split(',').filter(Boolean)
const ALLOW_TYPES = ['font', 'image', 'stylesheet', 'media']
const isLocal = u => { try { const x = new URL(u); return !/^(https?|wss?):$/.test(x.protocol) || (LOCAL.includes(x.hostname) && !OFF_LIMITS.includes(x.port)) } catch { return false } }
const blocked = new Set()
// route() never sees WebSockets; they get their own check.
// Only non-local sockets are routed; local ones (dev server reload) connect untouched.
function guardSocket(ws) {
  blocked.add(`${new URL(ws.url()).host} (websocket)`)
  ws.close({ code: 1008, reason: 'blocked by shoot.mjs' })
}
// Redirects are fetched hop by hop here, so a 302 to another host or port is caught before the browser follows it.
async function guard(route) {
  const req = route.request(), u = new URL(req.url())
  if (!isLocal(req.url()) && !(allowHosts.includes(u.hostname) && ALLOW_TYPES.includes(req.resourceType()))) { blocked.add(`${u.host} (${req.resourceType()})`); return route.abort('blockedbyclient') }
  if (!req.isNavigationRequest()) return route.continue()
  const res = await route.fetch({ maxRedirects: 0 })
  const to = res.headers().location
  if (to && !isLocal(new URL(to, req.url()).href)) { blocked.add(`${new URL(to, req.url()).host} (redirect)`); return route.abort('blockedbyclient') }
  return route.fulfill({ response: res })
}
async function open(ctx, url, before = () => {}) {
  const p = await ctx.newPage()
  before(p)
  const res = await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(e => { throw new Error(`${url}: ${e.message.split('\n')[0]} (blocked: ${[...blocked].join(', ') || 'none'})`) })
  if (!isLocal(p.url())) throw new Error(`${url} landed on ${p.url()}; stopping`)
  return [p, res]
}

function loadPlaywright() {
  const req = createRequire(path.join(process.cwd(), 'noop.js'))
  for (const name of ['playwright', '@playwright/test']) { try { return req(name) } catch {} }
  fail('playwright not found in the project or on NODE_PATH; see SKILL.md step 5 for a pinned install outside the project')
}
const { chromium } = loadPlaywright()

const slug = u => { const p = new URL(u).pathname.replace(/\/+$/, ''); return p ? p.slice(1).replace(/[^a-z0-9]+/gi, '-') : 'home' }
const sameSite = href => { try { const u = new URL(href, base); return u.origin === origin.origin && !/\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4|css|js|json|xml|txt)$/i.test(u.pathname) ? `${u.origin}${u.pathname}` : null } catch { return null } }

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  // Scroll through once so reveal-on-scroll and lazy images are in their final state.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)) }
    scrollTo(0, 0)
  })
  await page.waitForTimeout(600)
}

const browser = await chromium.launch()
const manifest = { base, shotAt: new Date().toISOString(), pages: [], blocked: [] }
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  for (const ctx of [desktop, mobile, reduced]) { await ctx.route('**/*', guard); await ctx.routeWebSocket(u => !isLocal(u.href), guardSocket) }

  const listed = opt('--pages')
  const queue = listed ? listed.split(',').map(p => sameSite(p)).filter(Boolean) : [sameSite(base)]
  const seen = new Set(queue)

  for (let i = 0; i < queue.length && i < maxPages; i++) {
    const url = queue[i], dir = path.join(out, slug(url))
    fs.mkdirSync(dir, { recursive: true })
    const entry = { url, dir: path.relative(process.cwd(), dir), shots: [], consoleErrors: [] }

    const [page, res] = await open(desktop, url, pg => {
      pg.on('console', m => { if (m.type() === 'error') entry.consoleErrors.push(m.text().slice(0, 200)) })
      pg.on('pageerror', e => entry.consoleErrors.push(String(e.message).slice(0, 200)))
    })
    entry.status = res?.status()
    await settle(page)
    await page.screenshot({ path: path.join(dir, 'desktop.png'), fullPage: true })
    entry.shots.push('desktop.png')

    if (!listed) for (const href of await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')))) {
      const u = sameSite(href)
      if (u && !seen.has(u)) { seen.add(u); queue.push(u) }
    }

    // Hover states: links, buttons and cards, one shot per element, cropped around it.
    const targets = await page.$$('a, button, [role=button], summary, [class*=card], [class*=Card]')
    const boxes = []
    for (const el of targets) {
      if (boxes.length >= maxHovers) break
      const box = await el.boundingBox()
      if (!box || box.width < 8 || box.height < 8 || !(await el.isVisible())) continue
      if (boxes.some(b => Math.abs(b.x - box.x) < 4 && Math.abs(b.y - box.y) < 4)) continue
      boxes.push(box)
      await el.scrollIntoViewIfNeeded().catch(() => {})
      await el.hover({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(400)
      const b = await el.boundingBox()
      if (!b) continue
      const vp = page.viewportSize(), pad = 40
      const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad) }
      clip.width = Math.min(vp.width - clip.x, b.width + pad * 2)
      clip.height = Math.min(vp.height - clip.y, b.height + pad * 2)
      if (clip.width < 1 || clip.height < 1) continue
      const name = `hover-${String(boxes.length).padStart(2, '0')}.png`
      await page.screenshot({ path: path.join(dir, name), clip })
      entry.shots.push(name)
      await page.mouse.move(0, 0)
    }
    await page.close()

    for (const [ctx, name] of [[mobile, 'mobile.png'], [reduced, 'reduced-motion.png']]) {
      const [p] = await open(ctx, url)
      await settle(p)
      await p.screenshot({ path: path.join(dir, name), fullPage: true })
      entry.shots.push(name)
      await p.close()
    }
    manifest.pages.push(entry)
    console.log(`${url}: ${entry.shots.length} shots${entry.consoleErrors.length ? `, ${entry.consoleErrors.length} console errors` : ''}`)
  }
} finally {
  manifest.blocked = [...blocked]
  await browser.close()
}
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`manifest: ${path.join(out, 'manifest.json')}`)
