// Pure layout: snapshot in, lines of colored segments out. No engine calls, so a plain
// node script can print the same lines the pane draws.
import type { Agent, Cache, Snap, Win } from '../types'

export type Seg = { t: string; c?: string; dim?: boolean; b?: boolean }
export type Line = Seg[]
export type View = { lines: Line[]; modsButton: boolean }

// One hex set for both themes; codex roles share their base role's color. Status keeps theme names.
const ROLE: Record<string, string> = {
  engineer: '#bf4340',
  'engineer-codex': '#bf4340',
  designer: '#cf8401',
  qa: '#37a953',
  'qa-codex': '#37a953',
  Explore: '#07a0c5',
  researcher: '#5b6ad2',
  ops: '#7f7703',
  growth: '#ab5bb8',
}
const roleColor = (role: string) => ROLE[role] ?? 'text'
const pctColor = (p: number) => (p >= 90 ? 'error' : p >= 70 ? 'warning' : 'success')
const RANK: Record<string, number> = { waiting: 0, failed: 1, running: 2, pending: 3, idle: 3 }
const STATE: Record<string, string> = { pending: 'queued' }

const len = (s: string) => [...s].length
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
const firstLine = (s: string) => clean(s.split(/\r?\n/).find(l => l.trim()) ?? '')
const cutTo = (s: string, room: number) => (len(s) <= room ? s : [...s].slice(0, Math.max(0, room - 1)).join('') + '…')

export function dur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (ms < 60000) return `${Math.max(0, Math.floor(ms / 1000))}s`
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d` + (h % 24 ? `${h % 24}h` : '')
}

export const until = (w: Win | undefined, now: number) => (w?.resetAt && w.resetAt > now ? dur(w.resetAt - now) : '-')

// Whole cells only: thin eighth glyphs read badly in a narrow pane.
export const bar = (pct: number, w: number) => '█'.repeat(Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)).padEnd(w, '░')

export const short = (model?: string) => (model ? (/opus|sonnet|haiku|fable|gpt-[\w.]+/.exec(model)?.[0] ?? model.slice(-10)) : '-')
const me = (a: Agent) => (a.effort ? `${short(a.model)}·${a.effort}` : short(a.model))
const glyph = (a: Agent): Seg =>
  a.status === 'running' ? { t: '⏺', c: roleColor(a.type) } : a.status === 'waiting' ? { t: '◌', c: 'warning' } : a.status === 'failed' ? { t: '✘', c: 'error' } : { t: '◌', dim: true }

// Cut a line to cols cells, an ellipsis where it was cut.
export function fit(line: Line, cols: number): Line {
  let room = cols
  const out: Line = []
  for (const s of line) {
    if (room <= 0) break
    const l = len(s.t)
    out.push(l <= room ? s : { ...s, t: cutTo(s.t, room) })
    room -= l
  }
  return out
}

function rule(name: string, cols: number, extra = ''): Line {
  const used = len(name) + (extra ? len(extra) + 1 : 0) + 1
  return [{ t: name, b: true }, ...(extra ? [{ t: ' ' + extra, dim: true }] : []), { t: ' ' + '─'.repeat(Math.max(0, cols - used)), c: 'subtle' }]
}

// Most urgent first: waiting, failed, running, then the rest, grouped by role.
function ordered(s: Snap): Agent[] {
  const m = new Map<string, Agent[]>()
  for (const a of s.agents) m.set(a.type, [...(m.get(a.type) ?? []), a])
  const rank = (l: Agent[]) => Math.min(9, ...l.map(a => RANK[a.status] ?? 4))
  return [...m.values()].sort((x, y) => rank(x) - rank(y)).flat()
}

export function waitingOf(s: Snap, asks: string[]): string[] {
  return [...asks, ...s.agents.filter(a => a.status === 'waiting').map(a => `${a.type}: ${firstLine(a.label) || 'waiting'}`)]
}

// Words of text in lines of room cells, at most max lines, the last cut with an ellipsis.
export function wrap(text: string, room: number, max: number): string[] {
  const out: string[] = []
  let cur = ''
  const words = text.split(' ').filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    const next = cur ? `${cur} ${w}` : w
    if (len(next) <= room) {
      cur = next
      continue
    }
    if (cur) out.push(cur)
    cur = w
    if (out.length === max - 1) {
      out.push(cutTo(words.slice(i).join(' '), room))
      return out
    }
  }
  if (cur) out.push(cutTo(cur, room))
  return out
}

const size = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / 1e3)}k`)
const mins = (ms: number) => Math.max(0, Math.round(ms / 60000))

// Smart then Cache: dim labels, plain values, color only on role names and the cold status.
function smartLines(s: Snap, cache: Cache | undefined, cols: number): Line[] {
  const L: Line[] = []
  const { ponytail, model, effort, why, roles } = s.smart
  const me = [model, effort].filter(Boolean).join(' ')
  if (ponytail || me || why || roles?.length) {
    L.push(rule('Smart', cols))
    if (ponytail || me) L.push([{ t: '  ponytail ', dim: true }, { t: ponytail ?? '-' }, ...(me ? [{ t: '  ' + me }] : [])])
    if (why) L.push([{ t: '  why ' + why, dim: true }])
    for (const r of roles ?? []) L.push([{ t: '  ' + r.role, c: roleColor(r.role) }, ...(r.model ? [{ t: ' ' + r.model, dim: true }] : [])])
  }
  if (cache && (cache.state === 'warm' || cache.state === 'cold')) {
    L.push(rule('Cache', cols))
    if (cache.state === 'cold') L.push([{ t: '  cold', c: 'warning' }], [{ t: `  next prompt re-reads ${size(cache.tokens)}`, dim: true }])
    else {
      const ping = mins((cache.pingAt ?? cache.warmUntil - 5 * 60000) - cache.now)
      L.push([{ t: `  warm ${mins(cache.warmUntil - cache.now)}m` }], [{ t: `  ${size(cache.tokens)} cached, ping in ${ping}m`, dim: true }])
    }
  }
  return L
}

export function view(s: Snap, asks: string[], cols: number, now: number, modsOpen = false, cache?: Cache): View {
  const L: Line[] = []
  const waiting = waitingOf(s, asks)
  if (waiting.length) {
    L.push(rule('Waiting on you', cols, String(waiting.length)))
    for (const w of waiting) for (const [i, t] of wrap(w, cols - 2, 2).entries()) L.push([{ t: i ? '  ' : '! ', c: 'warning', b: true }, { t, c: 'warning' }])
  }
  const order = ordered(s)
  L.push(rule('Running', cols, String(order.filter(a => a.status === 'running').length)))
  if (!order.length) L.push([{ t: 'No agents running.', dim: true }])
  for (const a of order) {
    const el = dur(now - a.startTime)
    const meta = me(a) + (a.status === 'running' ? '' : ' ' + (STATE[a.status] ?? a.status))
    const gap = Math.max(1, cols - 3 - len(a.type) - len(meta) - len(el))
    L.push([glyph(a), { t: ' ' + a.type + ' ', c: roleColor(a.type), b: true }, { t: meta + ' '.repeat(gap), dim: true }, { t: el, b: true }])
    for (const t of wrap(firstLine(a.label), cols - 2, 2)) L.push([{ t: '  ' + t }])
  }
  const done = Object.entries(s.done).filter(([, n]) => n)
  if (done.length) L.push([{ t: '+ done: ' + done.map(([r, n]) => `${r} ${n}`).join(', '), dim: true }])

  L.push(rule('Usage', cols))
  // Capped so a full-width dock keeps the numbers next to the bar; too narrow for 4 cells, the bar goes, not the reset time.
  const barW = Math.min(24, cols - 22)
  for (const w of s.usage) {
    L.push([
      { t: `${w.who} ${w.win}`.padEnd(10) },
      ...(barW >= 4 ? [{ t: bar(w.pct, barW), c: pctColor(w.pct) }] : []),
      { t: `${Math.round(w.pct)}%`.padStart(5), c: pctColor(w.pct), b: true },
      { t: until(w, now).padStart(7), dim: true },
    ])
  }
  if (!s.usage.length) L.push([{ t: 'No usage read yet.', dim: true }])

  L.push(...smartLines(s, cache, cols))

  L.push(rule('Mods', cols, `${s.mods.length} on`))
  if (modsOpen) {
    let row = '  '
    for (const m of s.mods) {
      if (len(row) + len(m) + 2 > cols && row.trim()) {
        L.push([{ t: row.trimEnd(), dim: true }])
        row = '  '
      }
      row += m + '  '
    }
    if (row.trim()) L.push([{ t: row.trimEnd(), dim: true }])
  }
  return { lines: L.map(l => fit(l, cols)), modsButton: s.mods.length > 0 }
}

// Plain text of the lines, one per row, for renders and tests.
export const plain = (v: View) => v.lines.map(l => l.map(s => s.t).join('')).join('\n')
