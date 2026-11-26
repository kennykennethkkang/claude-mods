// Redraws the subagent rows and Agent calls so each role reads as one aligned, colored line,
// or (style d, the default) as a tree grouped by role.
// Env, read once at session.start: ROLE_ROWS_STYLE=a|b|c|d, ROLE_ROWS_RESULT=1, ROLE_ROWS_BAND=1.
import type { Register } from 'claude-code'

export type Style = 'a' | 'b' | 'c' | 'd'
export type RowInfo = {
  type: string
  status: string
  model?: string
  effort?: string | number
  tokenCount: number
  contextWindowSize?: number
  startTime: number
  label: string
}
export type TreeAgent = RowInfo & { id: string; doneAt?: number }

// One hex set for both themes; codex roles share their base role's color.
const HEX: Record<string, string> = {
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
const W = { role: 14, me: 12, el: 5, ctx: 4, state: 7 }
const HIDE_AFTER = 60_000
// Style d: a finished line stays this long, then folds into its role's +N done.
const KEEP_DONE = 5 * 60_000
// The engine shows five agent rows under main and no setting lifts it.
const SLOTS = 5
const ESC = String.fromCharCode(27)
const SGR = new RegExp(ESC + '\\[[0-9;]*m', 'g')

export const styleOf = (raw?: string): Style => (raw === 'a' || raw === 'b' || raw === 'c' ? raw : 'd')
export const stripAnsi = (s: string) => s.replace(SGR, '')

const sgrOf = (role: string) => {
  const h = HEX[role]
  if (!h) return undefined
  const n = parseInt(h.slice(1), 16)
  return `38;2;${n >> 16};${(n >> 8) & 255};${n & 255}`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function pctOf(tokens: number, window?: number): string {
  if (!window || window <= 0 || !Number.isFinite(tokens)) return '--'
  return `${Math.min(999, Math.round((tokens / window) * 100))}%`
}

export function modelEffort(model?: string, effort?: string | number): string {
  const short = model ? (/opus|sonnet|haiku|fable/.exec(model)?.[0] ?? model.slice(-10)) : undefined
  if (effort === undefined || effort === '') return short ?? '-'
  return `${short ?? '-'}·${effort}`
}

const STATE: Record<string, string> = { completed: 'done', pending: 'queued' }
export const stateWord = (status: string) => STATE[status] ?? status
const STATE_SGR: Record<string, string> = { failed: '31', killed: '31', waiting: '33', completed: '2', idle: '2' }

const FINISHED = new Set(['completed', 'failed', 'killed'])

export function shouldHide(status: string, doneAt: number | undefined, now: number): boolean {
  return FINISHED.has(status) && doneAt !== undefined && now - doneAt > HIDE_AFTER
}

// Run-length groups: a row heads a group when the row above it has another state.
export function startsGroup(rowIds: string[], id: string, statusById: Record<string, string>): boolean {
  const i = rowIds.indexOf(id)
  return i <= 0 || statusById[rowIds[i - 1] ?? ''] !== statusById[id]
}

// Control characters (escape sequences too) turned to spaces, for any model-written field.
const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')

// First non-empty line of model text, control characters (escape sequences too) turned to spaces.
const oneLine = (s: unknown) => {
  const line = String(s ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  return clean(line).replace(/\s+/g, ' ').trim()
}

type Seg = { text: string; sgr?: string }

// Terminal cells of one code point: 0 for joiners and marks, 2 for CJK and emoji. ponytail: a VS16 emoji sequence counts 1.
export function cells(cp: number): number {
  if (cp < 0x300) return 1
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)
  return wide ? 2 : 1
}
export const width = (s: string) => [...s].reduce((n, c) => n + cells(c.codePointAt(0)!), 0)

// First chars of text that fit room cells, an ellipsis last when it was cut.
export function cut(text: string, room: number): string {
  if (width(text) <= room) return text
  if (room < 1) return ''
  let out = ''
  let used = 0
  for (const c of text) {
    const w = cells(c.codePointAt(0)!)
    if (used + w > room - 1) break
    out += c
    used += w
  }
  return out + '…'
}

// Cuts the segments to cols visible cells with an ellipsis.
function fit(segs: Seg[], cols?: number): string {
  let room = cols && cols > 0 ? cols : Infinity
  let out = ''
  for (const s of segs) {
    if (room <= 0) break
    const text = cut(s.text, room)
    room -= width(text)
    out += s.sgr ? `${ESC}[${s.sgr}m${text}${ESC}[0m` : text
  }
  return out
}

const pad = (s: string, n: number) => s.padEnd(n)

export function rowText(r: RowInfo, style: Style, now: number, cols?: number, header = false, doneAt?: number): string {
  const label = oneLine(r.label)
  const ran = (FINISHED.has(r.status) && doneAt !== undefined ? doneAt : now) - r.startTime
  const head: Seg[] = [
    { text: pad(clean(r.type), W.role) + ' ', sgr: sgrOf(r.type) },
    { text: pad(clean(modelEffort(r.model, r.effort)), W.me) + ' ' + elapsed(ran).padStart(W.el) + ' ' + pctOf(r.tokenCount, r.contextWindowSize).padStart(W.ctx) },
  ]
  const state: Seg = { text: ' ' + pad(stateWord(r.status), W.state), sgr: STATE_SGR[r.status] }
  const lines: string[] = []
  if (style === 'c' && header) lines.push(fit([{ text: stateWord(r.status), sgr: '2' }], cols))
  if (style === 'b') {
    lines.push(fit([...head, { ...state, text: state.text.trimEnd() }], cols))
    if (label) lines.push(fit([{ text: '  ' + label, sgr: '2' }], cols))
  } else {
    const segs = style === 'c' ? head : [...head, state]
    lines.push(fit(label ? [...segs, { text: ' ' + label }] : segs.map((s, i) => (i === segs.length - 1 ? { ...s, text: s.text.trimEnd() } : s)), cols))
  }
  return lines.join('\n')
}

const GLYPH: Record<string, Seg> = {
  pending: { text: '◌', sgr: '2' },
  waiting: { text: '◌', sgr: '33' },
  idle: { text: '◌', sgr: '2' },
  completed: { text: '✔', sgr: '32' },
  failed: { text: '✘', sgr: '31' },
  killed: { text: '◌', sgr: '2' },
}
const COUNT_ORDER = ['running', 'pending', 'waiting', 'idle', 'completed', 'failed', 'killed']
const quiet = (a: RowInfo) => a.status === 'completed' || a.status === 'killed'

// Most urgent first: something waiting on a person, then failed, then running.
const RANK: Record<string, number> = { waiting: 0, failed: 1, running: 2, pending: 3, idle: 3 }
const rankOf = (status: string) => RANK[status] ?? 4

// One role as short text: "2 running 1m, 1 failed", a lone running agent just its time, "done" when all ended.
export function roleSummary(list: RowInfo[], now: number): string {
  const live = list.filter((a) => !quiet(a))
  if (!live.length) return `${list.length > 1 ? list.length + ' ' : ''}done`
  const parts: string[] = []
  for (const status of [...new Set(live.map((a) => a.status))].sort((a, b) => rankOf(a) - rankOf(b))) {
    const of = live.filter((a) => a.status === status)
    if (status === 'running') {
      const since = elapsed(now - Math.min(...of.map((a) => a.startTime)))
      parts.push(of.length > 1 ? `${of.length} running ${since}` : since)
    } else parts.push(of.length > 1 || list.length > 1 ? `${of.length} ${clean(stateWord(status))}` : clean(stateWord(status)))
  }
  return parts.join(', ')
}

export function roleSummaries(rows: RowInfo[], now: number): { role: string; text: string }[] {
  const by = new Map<string, RowInfo[]>()
  for (const r of rows) by.set(clean(r.type), [...(by.get(clean(r.type)) ?? []), r])
  return [...by]
    .map(([role, list]) => ({ role, text: roleSummary(list, now), rank: Math.min(...list.filter((a) => !quiet(a)).map((a) => rankOf(a.status)), 9) }))
    .sort((a, b) => a.rank - b.rank)
}

function treeHeader(role: string, all: TreeAgent[], cols?: number): string {
  const n = new Map(COUNT_ORDER.map((s) => [s, 0]))
  for (const a of all) n.set(a.status, (n.get(a.status) ?? 0) + 1)
  const counts = [...n].filter(([, k]) => k).map(([s, k]) => `${k} ${clean(stateWord(s))}`).join(', ')
  const c = sgrOf(role)
  return fit([{ text: role, sgr: c ? `1;${c}` : '1' }, { text: '  ' + counts, sgr: '2' }], cols)
}

function treeChild(a: TreeAgent, conn: string, now: number, cols?: number): string {
  const ended = FINISHED.has(a.status)
  const ran = (ended && a.doneAt !== undefined ? a.doneAt : now) - a.startTime
  const glyph = a.status === 'running' ? { text: '⏺', sgr: sgrOf(a.type) } : (GLYPH[a.status] ?? { text: '◌', sgr: '2' })
  const label = oneLine(a.label)
  const meta = pad(clean(modelEffort(a.model, a.effort)), W.me) + elapsed(ran).padStart(W.el) + ' ' + pctOf(a.tokenCount, a.contextWindowSize).padStart(W.ctx)
  return fit([{ text: ` ${conn} `, sgr: '2' }, glyph, { text: ' ' + meta + (label ? '  ' + label : ''), sgr: ended ? '2' : undefined }], cols)
}

// Style d: every row's body by agent id, a tree grouped by role. The first running agent of a
// role (else its first row) draws the whole role; ids left out hide. Agents come in rowIds order.
export function treeBodies(agents: TreeAgent[], now: number, cols?: number, budget = 20): Map<string, string> {
  type Group = { role: string; all: TreeAgent[]; shown: TreeAgent[]; folded: number; host: string; at: number; one?: boolean }
  const byRole = new Map<string, TreeAgent[]>()
  for (const a of agents) byRole.set(clean(a.type), [...(byRole.get(clean(a.type)) ?? []), a])
  const fresh = (a: TreeAgent) => !FINISHED.has(a.status) || a.doneAt === undefined || now - a.doneAt <= KEEP_DONE
  let groups: Group[] = []
  for (const [role, all] of byRole) {
    if (!all.some(fresh)) continue
    const shown = all.filter(fresh)
    const host = (all.find((a) => !FINISHED.has(a.status)) ?? all[0]!).id
    groups.push({ role, all, shown, folded: all.length - shown.length, host, at: agents.findIndex((a) => a.id === host) })
  }
  groups.sort((x, y) => x.at - y.at)
  let gone: Group[] = []
  const height = () => groups.reduce((n, g) => n + (g.one ? 1 : 1 + g.shown.length + (g.shown.length && g.folded ? 1 : 0)), 0) + (gone.length ? 1 : 0)
  // Short on height: done lines fold into +N done, then roles with nothing else into one line.
  if (height() > budget) for (const g of groups) {
    const keep = g.shown.filter((a) => !quiet(a))
    g.folded += g.shown.length - keep.length
    g.shown = keep
  }
  if (height() > budget && groups.some((g) => g.shown.length)) {
    gone = groups.filter((g) => !g.shown.length)
    groups = groups.filter((g) => g.shown.length)
  }
  // Still too tall: each role into one line, then the whole tree into one roster line.
  if (height() > budget) for (const g of groups) g.one = true
  if (height() > budget && groups.length + gone.length > 1) {
    const everyone = [...groups, ...gone].sort((x, y) => x.at - y.at)
    const segs: Seg[] = []
    for (const r of roleSummaries(everyone.flatMap((g) => g.all.filter(fresh)), now)) {
      const c = sgrOf(r.role)
      segs.push({ text: segs.length ? ' · ' : '', sgr: '2' }, { text: r.role, sgr: c ? `1;${c}` : '1' }, { text: ' ' + r.text, sgr: '2' })
    }
    return new Map([[groups[0]?.host ?? everyone[0]!.host, fit(segs, cols)]])
  }
  const bodies = new Map<string, string[]>()
  groups.forEach((g, i) => {
    if (g.one) {
      const c = sgrOf(g.role)
      const host = groups[Math.min(i, SLOTS - 1)]!.host
      bodies.set(host, [...(bodies.get(host) ?? []), fit([{ text: g.role, sgr: c ? `1;${c}` : '1' }, { text: '  ' + roleSummary(g.all, now), sgr: '2' }], cols)])
      return
    }
    const lines = [treeHeader(g.role, g.all, cols)]
    const fold = g.shown.length && g.folded
    g.shown.forEach((a, j) => lines.push(treeChild(a, j === g.shown.length - 1 && !fold ? '└─' : '├─', now, cols)))
    if (fold) lines.push(fit([{ text: ' └─ ', sgr: '2' }, GLYPH.completed!, { text: ` +${g.folded} finished`, sgr: '2' }], cols))
    const host = groups[Math.min(i, SLOTS - 1)]!.host
    bodies.set(host, [...(bodies.get(host) ?? []), ...lines])
  })
  if (gone.length) {
    const host = groups[Math.min(groups.length, SLOTS) - 1]!.host
    const n = gone.reduce((k, g) => k + g.all.length, 0)
    const line = fit([GLYPH.completed!, { text: ` +${n} finished · ${gone.map((g) => `${g.role} ${g.all.length}`).join(', ')}`, sgr: '2' }], cols)
    bodies.get(host)!.push(line)
  }
  return new Map([...bodies].map(([id, l]) => [id, l.join('\n')]))
}

export function compactHeader(input: unknown, isRunning: boolean, isErrored: boolean): { role: string; text: string } | undefined {
  if (!input || typeof input !== 'object') return undefined
  const i = input as Record<string, unknown>
  const role = typeof i.subagent_type === 'string' && clean(i.subagent_type).trim() ? clean(i.subagent_type).trim() : 'general-purpose'
  const me = typeof i.model === 'string' || typeof i.effort === 'string' ? clean(modelEffort(i.model as string | undefined, i.effort as string | undefined)) : ''
  const mark = isErrored ? '✗' : isRunning ? '●' : '✓'
  const text = [`${mark} ${role}`, me, oneLine(i.description)].filter(Boolean).join('  ')
  return { role, text }
}

const KEEP = /^[\s>*_#-]*(?:Status|Open)[*_]*\s*:/i
export function keepLines(text: string): string | undefined {
  const kept = text.split(/\r?\n/).filter((l) => KEEP.test(l)).map(clean)
  return kept.length ? kept.join('\n') : undefined
}

// What the Agent tool's result holds as text, whatever shape the record has.
function resultText(output: unknown): string {
  if (typeof output === 'string') return output
  const c = (output as { content?: unknown } | null)?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n')
  return ''
}

export function rosterLine(rows: RowInfo[], now: number, cols?: number): string | undefined {
  if (!rows.length) return undefined
  const roles = roleSummaries(rows, now)
  const line = `${roles.length} role${roles.length === 1 ? '' : 's'}: ${roles.map((r) => `${r.role} ${r.text}`).join(' · ')}`
  return cols && cols > 0 ? cut(line, cols) : line
}

// All our bands share a third of the rows, three at least: the tree gets what the to-do and roster lines leave.
export function treeBudget(rows: number | undefined, reserved = 0): number {
  return rows ? Math.max(1, Math.max(3, Math.floor(rows / 3)) - reserved) : 20
}

export const register: Register = (on) => {
  let style: Style = 'a'
  let compactResult = false
  let band = false
  let todo = false
  // When each row was first seen finished: elapsed stops there and the row hides after a minute.
  const doneAt = new Map<string, number>()
  // Style d: what each row showed last, so a change in a row another one draws redraws the rest.
  const lastSig = new Map<string, string>()
  let lastInvalidate = 0

  on('session.start', async ($, e, next) => {
    try {
      style = styleOf(await $.env.get('ROLE_ROWS_STYLE'))
      compactResult = (await $.env.get('ROLE_ROWS_RESULT')) === '1'
      band = (await $.env.get('ROLE_ROWS_BAND')) === '1'
      todo = !!(await $.env.get('SWITCHBOARD_TODO'))
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AgentRow' }, async ($, e, next) => {
    let out = e
    try {
      const p = e.props
      const now = await $.clock.now()
      if (style === 'd') {
        const byId = new Map<string, RowInfo & { id: string }>((await $.agent.list()).map((a) => [a.id, a]))
        byId.set(p.id, p)
        for (const [id, a] of byId) {
          if (!FINISHED.has(a.status)) doneAt.delete(id)
          else if (!doneAt.has(id)) doneAt.set(id, now)
        }
        const ids = p.rowIds.includes(p.id) ? p.rowIds : [...p.rowIds, p.id]
        const agents = ids.flatMap((id) => (byId.has(id) ? [{ ...byId.get(id)!, doneAt: doneAt.get(id) }] : []))
        const rows = e.viewport?.rows
        const body = treeBodies(agents, now, p.columns, treeBudget(rows, (todo ? 1 : 0) + (band ? 1 : 0))).get(p.id)
        // The engine asks a row again only for its own change: a state change, or a hidden row's
        // new line (at most every 2s), asks every row so the one drawing it catches up.
        const sig = [p.status, oneLine(p.label), pctOf(p.tokenCount, p.contextWindowSize)].join('|')
        const was = lastSig.get(p.id)
        if (was === undefined || was === sig) lastSig.set(p.id, sig)
        else if (was.split('|')[0] !== p.status || (body === undefined && now - lastInvalidate >= 2000)) {
          lastSig.set(p.id, sig)
          lastInvalidate = now
          $.ui.invalidate('ui.render')
        }
        out = { ...e, props: body === undefined ? { ...p, isHidden: true } : { ...p, body } }
      } else {
        if (FINISHED.has(p.status)) {
          if (!doneAt.has(p.id)) doneAt.set(p.id, now)
        } else doneAt.delete(p.id)
        const done = doneAt.get(p.id)
        let header = false
        if (style === 'c') {
          const list = await $.agent.list()
          header = startsGroup(p.rowIds, p.id, Object.fromEntries(list.map((a) => [a.id, a.status])))
        }
        const body = rowText(p, style, now, p.columns, header, done)
        out = { ...e, props: { ...p, body, isHidden: shouldHide(p.status, done, now) ? true : p.isHidden } }
      }
    } catch {}
    return next(out)
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    let tree
    try {
      if (e.props.tool === 'Agent' && !e.props.isExpanded) {
        const head = compactHeader(e.props.input, e.props.isRunning, e.props.isErrored)
        if (head) {
          const { Text } = $.ui.resolve(e)
          tree = (
            <Text wrap="truncate-end" color={HEX[head.role]}>
              {head.text}
            </Text>
          )
        }
      }
    } catch {}
    return tree ?? next(e)
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'Agent' } }, async ($, e, next) => {
    let tree
    try {
      if (compactResult && e.props.tool === 'Agent' && !e.props.isExpanded && !e.props.isErrored) {
        const kept = keepLines(resultText(e.props.output))
        if (kept) {
          const { Text } = $.ui.resolve(e)
          tree = <Text dimColor>{kept}</Text>
        }
      }
    } catch {}
    return tree ?? next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let tree
    try {
      if (band && !e.props.hasSurvey) {
        const now = await $.clock.now()
        const list = await $.agent.list()
        const line = rosterLine(list.filter((a) => a.hasRow && a.status !== 'killed'), now, e.props.bodyColumns)
        if (line) {
          const { Text } = $.ui.resolve(e)
          tree = <Text dimColor wrap="truncate-end">{line}</Text>
        }
      }
    } catch {}
    if (!tree) return next(e)
    // Other mods share this slot: stack theirs under ours instead of hiding them.
    const below = await next(e).catch(() => undefined)
    if (!below) return tree
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{tree}{below}</Box>
  })
}
