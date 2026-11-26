// Side pane: usage, running agents, what waits on you, Smart picks, cache and mods, beside the chat.
// /side toggles it, /side mods shows the mods list. Layout C: while it is drawn, the band above the
// prompt keeps only todo-band's row (Smart and cache live here). With no pane, todo-band and
// cache-keeper step aside for smart-select's one row, which carries both.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Cache, Smart, Snap, Win } from '../types'
import { view } from './view'

const PANE = 'side'
const TITLE = 'Side'
const POLL_MS = 3000
const QUIET_TICKS = 20
const HIDE_OPEN = new Set(['role-rows', 'smart-select', 'cache-keeper'])
const HIDE_CLOSED = new Set(['todo-band', 'cache-keeper'])
const NONE = new Set<string>()
const ASK_TOOLS = new Set(['AskUserQuestion', 'mcp__switchboard__ask'])
const ENDED = new Set(['completed', 'killed'])
const EMPTY: Snap = { at: 0, usage: [], agents: [], done: {}, smart: {}, mods: [] }
const SNAP_REFRESH_MS = 30_000

const snap = atom({ plugin: 'side-pane', key: 'snap' } as const, EMPTY, { shape: 'snap-1' })
const modsOpen = atom({ plugin: 'side-pane', key: 'modsOpen' } as const, false)
const placed = atom({ plugin: 'side-pane', key: 'placed' } as const, false)
const asks = atom({ plugin: 'side-pane', key: 'asks' } as const, [] as string[])
let quietTicks = 0
let lastPollStartedAt = -Infinity
let lastHadAgents = false
let polling = false

export function needsSnapUpdate(previous: Snap, next: Snap, now: number) {
  const before = { ...previous }, after = { ...next }
  delete before.at
  delete after.at
  return JSON.stringify(before) !== JSON.stringify(after) || next.agents.length > 0 || now - previous.at >= SNAP_REFRESH_MS
}

export function panePollDue(ticks: number, hasAgents: boolean) {
  return ticks < QUIET_TICKS || hasAgents || ticks % 10 === 0
}

const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

// Claude writes ISO, Codex unix seconds. A window past its reset reads 0%.
export function windows(raw: any, who: Win['who'], now: number): Win[] {
  const out: Win[] = []
  for (const w of Array.isArray(raw?.windows) ? raw.windows : []) {
    const kind = String(w?.kind ?? '')
    const name = /five_hour/.test(kind) ? '5h' : /seven_day/.test(kind) ? 'wk' : undefined
    if (!name) continue
    const r = String(w.resetsAt ?? '')
    const resetAt = /^\d+$/.test(r) ? Number(r) * (r.length > 11 ? 1 : 1000) : Date.parse(r) || undefined
    const pct = resetAt !== undefined && resetAt <= now ? 0 : Number(w.percentUsed) || 0
    out.push({ who, win: name, pct, resetAt })
  }
  return out.sort((a, b) => a.win.localeCompare(b.win))
}

// Latest pick per kind for this session, a final row overriding its pick. A spawned role logs its
// role and model rows at the same ms: those give the roles list, not the chat's own model.
export function smartOf(text: string, session: string): Smart {
  const picks: any[] = []
  const finals = new Map<string, string>()
  for (const line of text.split('\n')) {
    let r: any
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (r?.session !== session) continue
    if (r.t === 'pick') picks.push(r)
    else if (r.t === 'final') finals.set(r.key, r.final)
  }
  const val = (p: any) => (p ? String(finals.get(p.key) ?? p.pick) : undefined)
  const spawned = new Set(picks.filter(r => r.kind === 'role').map(r => r.at))
  const last = (kind: string) => picks.filter(r => r.kind === kind && !spawned.has(r.at)).at(-1)
  const roles = new Map<string, string>()
  for (const r of picks.filter(r => r.kind === 'role')) roles.set(val(r)!, val(picks.filter(m => m.kind === 'model' && m.at === r.at).at(-1)) ?? '')
  return {
    ponytail: val(last('ponytail')),
    model: val(last('model')),
    effort: val(last('effort')),
    why: last('ponytail')?.why,
    roles: [...roles].map(([role, model]) => ({ role, model })),
  }
}

async function tail($: EngineInterface, path: string, bytes = 65536): Promise<string> {
  try {
    const { size } = await $.fs.stat(path)
    const offset = Math.max(0, size - bytes)
    return await $.fs.read(path, { offset, length: size - offset })
  } catch {
    return ''
  }
}

async function pollOnce($: EngineInterface, force: boolean) {
  lastPollStartedAt = await $.clock.now()
  const panes = await $.ui.panes().catch(() => [])
  const mine = panes.find(p => p.id === PANE)
  const isPlaced = mine?.isPlaced === true
  if ((await read($, placed)) !== isPlaced) await update($, placed, () => isPlaced)
  if (!mine) { lastHadAgents = false; return }
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const sw = `${home}/.claude/switchboard`
  const [now, session, lim, cx, settings, picks, flag, list] = await Promise.all([
    $.clock.now(),
    $.session.id().catch(() => ''),
    readJson($, `${sw}/limits.json`),
    readJson($, `${sw}/codex-limits.json`),
    readJson($, `${home}/.claude/settings.json`),
    tail($, `${sw}/smart-picks.jsonl`),
    $.fs.read(`${home}/.claude/.ponytail-active`).catch(() => ''),
    $.agent.list().catch(() => []),
  ])
  const agents: Agent[] = []
  const done: Record<string, number> = {}
  for (const a of list) {
    if (ENDED.has(a.status)) done[a.type] = (done[a.type] ?? 0) + 1
    else agents.push({ id: a.id, type: a.type, status: a.status, model: a.model, effort: a.effort === undefined ? undefined : String(a.effort), startTime: a.startTime, label: a.label })
  }
  // smart-select now writes one file per session and mod beside the shared ledger.
  let own = ''
  const id = session.replace(/[^\w.-]/g, '_')
  for (const f of await $.fs.list(`${sw}/smart-picks.d`).catch(() => [])) {
    if (id && f.kind === 'file' && f.name.startsWith(`${id}-`) && f.name.endsWith('.jsonl')) own += '\n' + (await tail($, `${sw}/smart-picks.d/${f.name}`))
  }
  const smart = smartOf(picks + own, session)
  smart.ponytail ??= flag.trim() || undefined
  const mods = Object.entries(settings?.enabledPlugins ?? {})
    .filter(([, on]) => on === true)
    .map(([id]) => id.split('@')[0]!)
    .sort()
  const next: Snap = { at: now, usage: [...windows(lim, 'Claude', now), ...windows(cx, 'Codex', now)], agents, done, smart, mods }
  lastHadAgents = list.some(a => ['running', 'pending', 'waiting'].includes(a.status))
  const previous = await read($, snap)
  if (force || needsSnapUpdate(previous, next, now)) await update($, snap, () => next)
}

async function poll($: EngineInterface, force = false) {
  if (polling) return
  polling = true
  try { await pollOnce($, force) } finally { polling = false }
}

function activity($: EngineInterface) {
  const wasQuiet = quietTicks >= QUIET_TICKS
  quietTicks = 0
  if (wasQuiet) void poll($).catch(() => undefined)
}

async function open($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    quietTicks = 0
    await $.command.register({ name: 'side', description: 'Toggle the side pane; /side mods shows or hides the mods list' })
    void open($).then(() => poll($, true)).catch(() => undefined)
    $.clock.every(POLL_MS, () => {
      if (panePollDue(++quietTicks, lastHadAgents)) void poll($).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'side' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'mods') {
      const shown = await update($, modsOpen, o => !o)
      await open($)
      return { text: shown ? 'Side pane: mods shown.' : 'Side pane: mods hidden.' }
    }
    if (arg) return { text: 'Use /side to open or close the pane, /side mods for the mods list.' }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      await update($, placed, () => false)
      return { text: 'Side pane closed.' }
    }
    quietTicks = 0
    const got = await open($)
    await poll($, true)
    return { text: got.isPlaced ? 'Side pane opened.' : `Side pane waits: ${got.reason}` }
  })

  on('prompt.submit', async ($, e, next) => { activity($); return next(e) })
  on('agent.spawn', async ($, e, next) => { activity($); return next(e) })
  on('turn.complete', async ($, e, next) => { activity($); return next(e) })

  // A question to the person is in flight from call to answer.
  on('tool.call', async ($, e, next) => {
    activity($)
    const tool = String(e.tool)
    if (!ASK_TOOLS.has(tool)) return next(e)
    const name = tool === 'AskUserQuestion' ? 'question' : 'Switchboard ask'
    await update($, asks, l => [...l, name]).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      await update($, asks, l => {
        const i = l.indexOf(name)
        return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)]
      }).catch(() => undefined)
    }
  })

  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const now = await $.clock.now()
    if (now - lastPollStartedAt >= POLL_MS) void poll($).catch(() => undefined)
    // Closed: smart-select's row carries the to-do and cache, so theirs hide only while it is there.
    const hide = (await read($, placed)) ? HIDE_OPEN : e.props.rows.some(r => r.plugin === 'smart-select') ? HIDE_CLOSED : NONE
    return next({ ...e, props: { ...e.props, rows: e.props.rows.filter(r => !hide.has(r.plugin)) } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // cache-keeper's keep, read as its own state
    const keep = read($, atom({ plugin: 'cache-keeper', key: 'keep' } as never, null as never) as never).catch(() => null) as Promise<Cache | null>
    const [s, open, waiting, cache] = await Promise.all([read($, snap), read($, modsOpen), read($, asks), keep])
    const v = view(s, waiting, Math.max(20, e.props.bodyColumns), s.at, open, cache ?? undefined)
    return (
      <Box flexDirection="column">
        {v.lines.map(line => (
          <Text wrap="truncate-end">
            {line.length === 0 ? ' ' : line.map(g => <Text color={g.c} dimColor={g.dim} bold={g.b}>{g.t}</Text>)}
          </Text>
        ))}
        {v.modsButton && <Button key="mods" hotkey="m" label={open ? 'Hide mods' : 'Show mods'} onPress={() => update($, modsOpen, o => !o)} />}
      </Box>
    )
  })
}
