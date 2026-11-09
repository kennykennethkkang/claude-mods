// Lets a chat see this project's other live chats and wait for them, through Switchboard's hub.
// Also stops an edit to a file another live chat edited lately, and points the chat at chats_wait.
import type { EngineInterface, Register } from 'claude-code'

type Target = { port: number; token: string; workspace: string }
type Discovery = { port?: unknown; hubToken?: unknown; workspace?: unknown }
type ChatRow = { sessionId: string; name?: string; cwd: string; project?: string; live: boolean; ai?: string }
type Task = { subject?: string; status: string }
type Progress = {
  sessionId: string; cwd?: string; state: 'working' | 'done' | 'needs-you' | 'idle'; tasks: Task[]
  question?: string; report?: { done: string[]; left: string[]; you?: string[] }; tests?: { ok: boolean; command?: string; failed?: number }
}
type Live = { sessionId: string; file?: string; fileAt?: number }
type Link = { from: string; to: string[] }
export type HubState = { chats: ChatRow[]; progress: Progress[]; live: Live[]; links?: Link[] }

const CHECK = 'chats_check'
const WAIT = 'chats_wait'
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const REDISCOVER_MS = 30_000
const STATE_MS = 10_000
const POLL_S = 5
// The hub's editGuard window and retry pass (agent-flow extension/src/hub/brain.ts).
const GUARD_MS = 10 * 60_000
const RETRY_MS = 2 * 60_000
// ponytail: one step per tool call, the engine's tool timeout is unknown; raise it if calls survive longer.
const STEP_MS = 4 * 60_000
// A wait Kenneth removed is not posted again for this long.
const REMOVED_MS = 5 * 60_000
const REMOVED = 'Kenneth removed this wait in Switchboard; continue on your own.'

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

const cache = { targets: [] as Target[], foundAt: -Infinity, state: undefined as HubState | undefined, stateAt: -Infinity, tried: new Map<string, number>(), mine: new Map<string, number>(), seen: new Set<string>() }
export function resetCache() {
  Object.assign(cache, { targets: [], foundAt: -Infinity, state: undefined, stateAt: -Infinity, tried: new Map(), mine: new Map(), seen: new Set() })
}

/** This project's other live chats: same repo name when both rows have one, else one folder holds the other. */
export function peersOf(s: HubState, self: string, cwd: string): ChatRow[] {
  const own = s.chats.find(c => c.sessionId === self)
  const home = norm(own?.cwd ?? cwd)
  return s.chats.filter(c => c.live && c.sessionId !== self && (own?.project && c.project
    ? own.project === c.project
    : inside(norm(c.cwd), home) || inside(home, norm(c.cwd))))
}

/** Names (any case), session ids, or id prefixes of at least four characters. */
export function matchTargets(peers: ChatRow[], wanted: string[]) {
  const ids: string[] = [], missing: string[] = []
  for (const w of wanted.map(x => x.trim()).filter(Boolean)) {
    const hit = peers.find(p => p.name?.toLowerCase() === w.toLowerCase())
      ?? peers.find(p => p.sessionId === w || (w.length >= 4 && p.sessionId.startsWith(w)))
    if (hit) { if (!ids.includes(hit.sessionId)) ids.push(hit.sessionId) } else missing.push(w)
  }
  return { ids, missing }
}

/** Whether `from` waits on `to`, directly or through other links. */
export function waitsOn(links: Link[] = [], from: string, to: string): boolean {
  const seen = new Set<string>(), next = [from]
  while (next.length) {
    const at = next.pop()
    for (const id of links.filter(l => l.from === at).flatMap(l => l.to)) {
      if (id === to) return true
      if (!seen.has(id)) { seen.add(id); next.push(id) }
    }
  }
  return false
}

/** Finished: done, needs-you, idle after work, or gone. Clean: done or idle with no failing tests. */
export function outcomeOf(p: Progress | undefined) {
  if (!p) return { finished: true, clean: false }
  const worked = p.tasks.length > 0 || !!p.report
  const finished = p.state === 'done' || p.state === 'needs-you' || (p.state === 'idle' && worked)
  return { finished, clean: finished && p.state !== 'needs-you' && p.tests?.ok !== false }
}

/** The live peer that edited `file` after this chat did, within the hub's guard window, and is not done. */
export function editClash(s: HubState, self: string, cwd: string, file: string, now: number, mine = 0): ChatRow | undefined {
  const target = norm(file)
  const peers = peersOf(s, self, cwd)
  for (const l of s.live) {
    if (!l.file || norm(l.file) !== target || !l.fileAt || l.fileAt <= mine || now - l.fileAt >= GUARD_MS) continue
    const peer = peers.find(p => p.sessionId === l.sessionId)
    if (peer && s.progress.find(p => p.sessionId === l.sessionId)?.state !== 'done') return peer
  }
  return undefined
}

const label = (c: ChatRow) => `${c.name ?? 'unnamed'} (${c.sessionId.slice(0, 8)}${c.ai ? `, ${c.ai}` : ''})`
const lastReport = (p?: Progress) => p?.report?.done.at(-1) ?? p?.report?.left.at(-1)

export function peerLine(s: HubState, c: ChatRow) {
  const p = s.progress.find(x => x.sessionId === c.sessionId)
  const task = p?.tasks.find(t => t.status === 'in_progress')?.subject
  const file = s.live.find(x => x.sessionId === c.sessionId)?.file
  const report = lastReport(p)
  return `- ${label(c)}: ${p?.state ?? 'no progress'}${task ? `, task: ${task}` : ''}${file ? `, file: ${file}` : ''}${report ? `. Last report: ${report}` : ''}`
}

function finishText(s: HubState, ids: string[]) {
  let clean = true
  const lines = ids.map(id => {
    const c = s.chats.find(x => x.sessionId === id) ?? { sessionId: id, cwd: '', live: false }
    const p = s.progress.find(x => x.sessionId === id)
    clean &&= outcomeOf(p).clean
    const tests = p?.tests ? `, tests ${p.tests.ok ? 'passed' : `failing (${p.tests.command ?? 'last run'})`}` : ''
    const r = p?.report
    const report = r ? `\n  Done: ${r.done.join('; ') || 'none'}\n  Left: ${r.left.join('; ') || 'none'}${r.you?.length ? `\n  For Kenneth: ${r.you.join('; ')}` : ''}` : '\n  No report.'
    return `- ${label(c)}: ${p?.state ?? 'ended'}${tests}${p?.question ? `, asking: ${p.question}` : ''}${report}`
  })
  const next = clean
    ? 'Continue on your own: read the report above and pick up your work.'
    : 'Stop and ask Kenneth before going on: a chat you waited for needs him, ended without a report, or has failing tests.'
  return `Finished:\n${lines.join('\n')}\n\n${next}`
}

async function discover($: EngineInterface) {
  const now = await $.clock.now()
  if (now - cache.foundAt < REDISCOVER_MS) return cache.targets
  cache.foundAt = now
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const dir = `${norm(home)}/.claude/switchboard`
  const files: Discovery[] = []
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'workspaces.json') continue
    try { files.push(JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))) } catch { /* a file mid-write */ }
  }
  cache.targets = files.flatMap(f => typeof f.port === 'number' && typeof f.hubToken === 'string' && typeof f.workspace === 'string'
    ? [{ port: f.port, token: f.hubToken, workspace: norm(f.workspace) }] : [])
  return cache.targets
}

// $.clock.sleep spends the hook's 10 s budget; a $ call in flight does not, so waits run a sleep process.
const pause = ($: EngineInterface, s: number) => Promise.resolve().then(() => $.process.run(['sleep', String(s)], { timeoutMs: (s + 5) * 1000 })).catch(() => undefined)
const bounded = <T>($: EngineInterface, p: Promise<T>) => Promise.race([p, pause($, 3).then(() => undefined)]).catch(() => undefined)

async function home($: EngineInterface) {
  const cwd = norm(await $.session.cwd())
  return (await discover($)).filter(t => inside(cwd, t.workspace)).sort((a, b) => b.workspace.length - a.workspace.length)[0]
}

/** The hub's state from the window holding this folder; undefined when none answers. */
async function readState($: EngineInterface): Promise<HubState | undefined> {
  const t = await home($)
  if (!t) return undefined
  const got = await bounded($, $.http.fetch(`http://127.0.0.1:${t.port}/hub/state`, { headers: { 'X-Switchboard-Token': t.token } }))
  if (!got?.ok) { cache.foundAt = -Infinity; return undefined }
  try { return JSON.parse(got.text) as HubState } catch { return undefined }
}

async function cachedState($: EngineInterface) {
  const now = await $.clock.now()
  if (now - cache.stateAt >= STATE_MS) { cache.state = await readState($); cache.stateAt = now }
  return cache.state
}

// Every window; a hub that does not know the kind answers 400, which changes nothing here.
async function post($: EngineInterface, body: Record<string, unknown>) {
  await Promise.all((await discover($)).map(t => bounded($, $.http.fetch(`http://127.0.0.1:${t.port}/hub`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token, ...body }),
  }))))
}

const NO_HUB = 'No Switchboard window holds this folder, so other chats cannot be seen.'

export async function checkText($: EngineInterface) {
  const s = await readState($)
  if (!s) return NO_HUB
  const peers = peersOf(s, await $.session.id(), await $.session.cwd())
  return peers.length ? `Other live chats in this project:\n${peers.map(c => peerLine(s, c)).join('\n')}` : 'No other live chats in this project.'
}

export async function waitStep($: EngineInterface, input: { chats?: unknown; reason?: unknown }) {
  const wanted = Array.isArray(input.chats) ? input.chats.filter((x): x is string => typeof x === 'string') : []
  if (!wanted.length) return 'Give chats: the names or session ids to wait for.'
  const self = await $.session.id()
  const cwd = await $.session.cwd()
  let s = await readState($)
  if (!s) return NO_HUB
  const peers = peersOf(s, self, cwd)
  const matched = matchTargets(peers, wanted), missing = matched.missing
  let ids = matched.ids
  if (missing.length) return `No live chat in this project matches ${missing.join(', ')}. Live ones:\n${peers.map(c => peerLine(s!, c)).join('\n') || '(none)'}`
  const loop = ids.find(id => waitsOn(s!.links, id, self))
  if (loop) return `${label(peers.find(p => p.sessionId === loop)!)} already waits on this chat, so both would wait forever. Do not wait on it: continue on your own or ask Kenneth.`
  const start = await $.clock.now()
  const removed = ((await Promise.resolve().then(() => $.store.get('removed')).catch(() => undefined)) ?? {}) as Record<string, number>
  for (const k of Object.keys(removed)) if (start - removed[k] >= REMOVED_MS) delete removed[k]
  // A link seen up and gone now, with the wait still on: Kenneth unlinked it in Switchboard.
  const dropGone = async (now: number) => {
    if (!s?.links) return
    const up = new Set(s.links.filter(l => l.from === self).flatMap(l => l.to))
    for (const id of ids) {
      if (up.has(id)) cache.seen.add(id)
      else if (cache.seen.has(id)) { cache.seen.delete(id); removed[`${self}\n${id}`] = now }
    }
    ids = ids.filter(id => !removed[`${self}\n${id}`])
    await Promise.resolve().then(() => $.store.set('removed', removed)).catch(() => undefined)
  }
  await dropGone(start)
  if (!ids.length) return REMOVED
  await post($, { kind: 'link', from: self, to: ids, reason: String(input.reason ?? ''), auto: false, since: start })
  for (;;) {
    if (s && ids.every(id => outcomeOf(s!.progress.find(p => p.sessionId === id)).finished)) {
      await post($, { kind: 'link-end', from: self, to: ids })
      for (const id of ids) cache.seen.delete(id)
      return finishText(s, ids)
    }
    const now = await $.clock.now()
    if (now - start >= STEP_MS) {
      const lines = s ? ids.flatMap(id => { const c = s!.chats.find(x => x.sessionId === id); return c ? [peerLine(s!, c)] : [] }).join('\n') : ''
      return `Still waiting${lines ? `:\n${lines}` : '.'}\nCall chats_wait again with the same chats to keep waiting.`
    }
    await pause($, POLL_S)
    s = (await readState($)) ?? s
    await dropGone(now)
    if (!ids.length) return REMOVED
  }
}

/** Why this edit should wait, once per file per two minutes; posts the auto link. */
export async function editDenial($: EngineInterface, file: string) {
  const s = await cachedState($)
  if (!s) return undefined
  const now = await $.clock.now()
  for (const [k, at] of cache.tried) if (now - at >= RETRY_MS) cache.tried.delete(k)
  const target = norm(file)
  if (cache.tried.has(target)) return undefined
  const self = await $.session.id()
  const peer = editClash(s, self, await $.session.cwd(), target, now, cache.mine.get(target))
  if (!peer) return undefined
  cache.tried.set(target, now)
  await post($, { kind: 'link', from: self, to: [peer.sessionId], reason: target, auto: true, since: now })
  return `Another live chat, ${label(peer)}, is editing ${target}. Call chats_wait with chats ["${peer.sessionId}"] and reason "${target}", then re-read the file before editing. Retrying this edit goes ahead without waiting.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: CHECK,
      description: "This project's other live chats: name, AI, state, current task, the file each is editing, and its last report line.",
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: WAIT,
      description: 'Wait for other live chats in this project to finish (names or session ids from chats_check). Returns their reports when done, or after about four minutes with "still waiting"; then call it again. Continue on your own when the result says so; otherwise stop and ask Kenneth.',
      inputSchema: {
        type: 'object',
        properties: { chats: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } },
        required: ['chats', 'reason'],
      },
    })
    return started
  })

  on('tool.call', { tool: `mcp__chat-wait__${CHECK}` }, async $ => ({ result: await checkText($) }))
  on('tool.call', { tool: `mcp__chat-wait__${WAIT}` }, async ($, e) => ({ result: await waitStep($, e as { chats?: unknown; reason?: unknown }) }))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!EDITS.has(tool)) return next(e)
    const raw = (e as { file_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path
    if (typeof raw !== 'string') return next(e)
    const file = raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) ? norm(raw) : `${norm(await $.session.cwd())}/${raw}`
    const why = await editDenial($, file).catch(() => undefined)
    if (why) return { deny: why }
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) cache.mine.set(file, await $.clock.now())
    return ran
  })
}
