// Usage feed for Switchboard: posts this chat's context, limits, token diet and Jev runs
// to every open Switchboard window, and carries back what was typed in any of them (a
// message, Remote Control, a compaction). Draws nothing in the terminal.
import type { EngineInterface, Register, SessionContextBreakdown, SessionUsage } from 'claude-code'

type Target = { port: number; token: string; workspace: string }
type Discovery = { port?: unknown; hubToken?: unknown; workspace?: unknown }
type InboxItem = { id: string; kind: 'prompt'; text: string } | { id: string; kind: 'rc' } | { id: string; kind: 'compact' } | { id: string; kind: 'close' } | { id: string; kind: 'handoff' }

const POST_EVERY_MS = 5_000
const POLL_MS = 2_000
const REDISCOVER_MS = 30_000
const FETCH_MS = 2_000

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Every Switchboard window (Agent Flow alone writes no hub token): any of them can show and talk to this chat. */
export function targetsOf(files: Discovery[]): Target[] {
  return files.flatMap(f => typeof f.port === 'number' && typeof f.hubToken === 'string' && typeof f.workspace === 'string'
    ? [{ port: f.port, token: f.hubToken, workspace: norm(f.workspace) }]
    : [])
}

/** A Jev run from jev.py's one-line summary on stderr. */
export function jevRun(command: string, output: string) {
  const m = /\[jev\] (\d+) items · ([\d.]+)s wall · .*? · \$([\d.]+) · (\d+) errors(?: · sure (\d+) \/ unsure (\d+))?/.exec(output)
  if (!m) return undefined
  const preset = /--preset[ =](\S+)/.exec(command)?.[1]
  const split = m[5] === undefined ? {} : { sure: Number(m[5]), unsure: Number(m[6]) }
  return { preset, items: Number(m[1]), seconds: Number(m[2]), costUsd: Number(m[3]), errors: Number(m[4]), ...split }
}

/** OpenRouter credits left, from jev.py status or the get-credits tool; the feed never asks for them itself. */
export function creditsIn(text: string): number | undefined {
  const printed = /credits:\s+\$([\d.]+) left/.exec(text)
  if (printed) return Number(printed[1])
  const bought = /"total_credits"\s*:\s*([\d.]+)/.exec(text)
  const used = /"total_usage"\s*:\s*([\d.]+)/.exec(text)
  return bought && used ? Number(bought[1]) - Number(used[1]) : undefined
}

// mcp__plugin_bland_bland__x -> bland; mcp__openrouter__x -> openrouter.
export const ownerOf = (tool: string) => {
  const server = tool.split('__')[1] ?? tool
  return /^plugin_([^_]+)_/.exec(server)?.[1] ?? server
}

const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n)

/** What loads on every call, biggest first, and the plugins never used since counting began. */
export function dietOf(b: SessionContextBreakdown, uses: Record<string, number>) {
  const rows = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).map(c => ({ label: c.name, tokens: c.tokens }))
  const owners = new Map<string, number>()
  const plugins = new Set<string>()
  for (const s of b.skills?.skillFrontmatter ?? []) {
    add(owners, s.pluginName ? `skills: ${s.pluginName}` : 'skills: yours', s.tokens)
    if (s.pluginName) plugins.add(s.pluginName)
  }
  for (const t of b.mcpTools) {
    const owner = ownerOf(t.name)
    // A deferred tool costs its name in the listing, not its schema.
    add(owners, `mcp: ${owner}`, t.isLoaded ? t.tokens : Math.round(t.name.length / 3.5))
    if (/^plugin_/.test(t.serverName)) plugins.add(owner)
  }
  const detail = [...owners].map(([label, tokens]) => ({ label, tokens })).sort((x, y) => y.tokens - x.tokens).slice(0, 8)
  const memory = b.memoryFiles.map(f => ({ label: `memory: ${f.path.split(/[\\/]/).pop() ?? f.path}`, tokens: f.tokens }))
  return {
    total: b.totalTokens,
    rows: [...rows.sort((x, y) => y.tokens - x.tokens), ...detail, ...memory],
    unused: [...plugins].filter(p => !uses[p]).sort(),
  }
}

/** Hands the panel's queued items to this chat: a message as Kenneth's own, Remote Control, close, a handoff, or a compaction. */
export async function deliver($: EngineInterface, items: InboxItem[]) {
  for (const item of items) {
    if (item.kind === 'prompt') {
      if (item.text.startsWith(HUB_RESUME)) {
        // Resumed here already: one turn, not two. Switchboard first: the hold lifts with it.
        await loadHold($)
        const now = await $.clock.now()
        if (held.resumedAt !== undefined && now - held.resumedAt < RESUME_DEDUP_MS) continue
        if (held.hold) await liftHold($, now)
      }
      await $.prompt.submit({ text: item.text, asUser: true })
      // The window holding this chat's terminal brings it up.
      await post($, { kind: 'prompted', sessionId: await $.session.id() })
    }
    else if (item.kind === 'rc') await $.command.run({ command: 'remote-control' })
    else if (item.kind === 'close') await $.command.run({ command: 'exit' }).catch(async () => post($, { kind: 'close-failed', sessionId: await $.session.id() }))
    else if (item.kind === 'handoff') await maybeHandoff($, true)
    else {
      // Runs only between turns (it rejects mid-turn), so a chat with open tasks would sit idle after it.
      const { skip } = await $.session.compact({}).catch(() => ({ skip: true }))
      if (skip) continue
      await restoreFeed($).catch(() => undefined)
      feed.nudge = undefined
      await keepGoing($, lastAnswer)
    }
  }
}

// Roles: model from ~/.claude/agents/<role>.md, raised by the smart switch; daily budget per role.

/** `model:` in an agent file's frontmatter; inherit or none leaves the spawn alone. */
export function agentFileModel(text: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const m = /^model:\s*["']?([^\s"'#]+)/m.exec(front)?.[1]
  return m && m !== 'inherit' ? m : undefined
}

const agentCache = new Map<string, { mtimeMs: number; model?: string }>()
async function agentModel($: EngineInterface, role: string) {
  if (!/^[\w-]+$/.test(role)) return undefined
  const path = `${await homeDir($)}/.claude/agents/${role}.md`
  const st = await $.fs.stat(path).catch(() => undefined)
  if (!st) return undefined
  const hit = agentCache.get(path)
  if (hit?.mtimeMs === st.mtimeMs) return hit.model
  const model = agentFileModel(String(await $.fs.read(path).catch(() => '')))
  agentCache.set(path, { mtimeMs: st.mtimeMs, model })
  return model
}

// Smart switch: three redesign rounds on one component raise that role one step.
export const LADDER = ['haiku', 'sonnet', 'opus', 'fable']
const level = (model?: string) => LADDER.findIndex(n => (model ?? '').toLowerCase().includes(n))
const alias = (model: string) => LADDER[level(model)] ?? model
export const cleanReport = (answer: string) => /^[\s*#_-]*status[\s*_]*:[\s*_]*done[\s.*_]*$/im.test(answer)
// "debug" always reads as debugging; the other words lose to a design word ("redesign the error banner").
export const debugBrief = (brief: string) => /\bdebug\w*/i.test(brief) ||
  (/\b(bugs?|errors?|crash\w*|fail\w*|stack ?traces?)\b/i.test(brief) && !/\b(re)?design\w*|\b(layout|restyle|rebuild|rework|look)\w*/i.test(brief))
const ROUNDS = 3
const COOL_AFTER = 5

export type Run = { role: string; brief: string; model: string; files: string[]; clean: boolean; round: number }
export type Learned = { project: string; role: string; files: string[]; from: string; to: string; reason: string; at: number; resolvedBy?: string; clean?: number }
const rel = (project: string, f: string) => (f.startsWith(`${project}/`) ? f.slice(project.length + 1) : f)
const overlaps = (a: string[], b: string[]) => a.some(f => b.includes(f))

/** What one finished subagent run teaches: its churn round, and the project's escalations after it. */
export function learnRun(runs: Run[], learned: Learned[], r: Omit<Run, 'round'>, project: string, now: number) {
  const files = r.files.map(f => rel(project, f))
  const at = runs.map(x => x.role).lastIndexOf(r.role)
  const prev = runs[at]
  const qaFound = runs.slice(at + 1).some(x => x.role === 'qa' && !x.clean)
  const churn = !!prev && overlaps(prev.files.map(f => rel(project, f)), files) && (!prev.clean || qaFound) && !debugBrief(r.brief)
  let round = churn ? prev.round + 1 : 1
  let changed = false
  let out = learned.map(l => ({ ...l }))
  for (const l of out) {
    if (l.project !== project || l.role !== r.role || !overlaps(l.files, files) || level(r.model) < level(l.resolvedBy ?? l.to) || !r.clean) continue
    changed = true
    if (!l.resolvedBy) { l.resolvedBy = alias(r.model); continue }
    l.clean = (l.clean ?? 0) + 1
    if (l.clean < COOL_AFTER) continue
    l.to = l.resolvedBy = LADDER[level(l.to) - 1]
    l.clean = 0
  }
  out = out.filter(l => level(l.to) > level(l.from))
  const up = LADDER[level(r.model) + 1]
  if (round >= ROUNDS && !r.clean && up && level(r.model) >= 0) {
    const reason = `${ROUNDS} redesign rounds without a clean Report`
    const same = out.find(l => l.project === project && l.role === r.role && overlaps(l.files, files))
    if (same) Object.assign(same, { files: [...new Set([...same.files, ...files])], to: up, reason, at: now, resolvedBy: undefined, clean: 0 })
    else out.push({ project, role: r.role, files, from: alias(r.model), to: up, reason, at: now })
    round = 0
    changed = true
  }
  return { round, learned: out, changed }
}

// Project-relative path only: a bare basename (index.ts, page.tsx) names too many files.
const named = (brief: string, f: string) => brief.includes(f)

/** The spawn's model: its agent file's, or higher when this project learned that role needs more for the files the brief names. */
export function pickModel(base: string | undefined, role: string, brief: string, learned: Learned[], project: string) {
  const want = Math.max(-1, ...learned.filter(l => l.project === project && l.role === role && l.files.some(f => named(brief, f))).map(l => level(l.resolvedBy ?? l.to)))
  return want > level(base) ? LADDER[want] : base
}

// Claude Code's own layout: the project root with every non-alphanumeric as '-'.
export const projectDir = (home: string, root: string) => `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`
export const memoryDir = (home: string, root: string) => `${projectDir(home, root)}/memory`
const rootOf = async ($: EngineInterface) => norm(await Promise.resolve().then(() => $.session.root()).catch(() => $.session.cwd()))
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const escalationNote = (learned: Learned[]) => [
  '---', 'name: Model escalations', 'description: Roles the smart switch raised a model step after three redesign rounds, and which model fixed them', 'metadata:', '  type: project', '---', '',
  ...learned.map(l => `- ${l.files.join(', ')}: ${l.role}, ${l.from} failed ${ROUNDS} redesign rounds, ${l.resolvedBy ? `${l.resolvedBy} fixed it` : `raised to ${l.to}, not fixed yet`} (${dayOf(l.at)})`),
  '',
].join('\n')
const MEMORY_LINE = '- [Model escalations](model-escalations.md): roles raised a model step after three redesign rounds; which model fixed what'

const cwdOf = ($: EngineInterface) => Promise.resolve().then(() => $.session.cwd()).then(norm).catch(() => '')
const learnPath = async ($: EngineInterface) => `${await homeDir($)}/.claude/switchboard/model-learn.json`
async function readLearn($: EngineInterface): Promise<Learned[]> {
  try { const l = JSON.parse(String(await $.fs.read(await learnPath($)))); return Array.isArray(l) ? l : [] } catch { return [] }
}

// This chat's subagent runs, in the order they ended. ponytail: in memory, so a mod reload forgets the chain.
const runs: Run[] = []
const live = new Map<string, { role: string; brief: string; model: string; files: Set<string> }>()

async function endRun($: EngineInterface, agentId: string, answer: string) {
  const a = live.get(agentId)
  if (!a) return
  live.delete(agentId)
  const project = await cwdOf($)
  const r = { role: a.role, brief: a.brief, model: a.model, files: [...a.files], clean: cleanReport(answer) }
  const now = await $.clock.now()
  const path = await learnPath($)
  // fs has no lock or rename: reread, merge, write, then verify; retry if another chat overwrote us.
  let out = learnRun(runs, await readLearn($), r, project, now)
  for (let i = 0; i < 4 && out.changed; i++) {
    const text = JSON.stringify(out.learned, null, 2)
    await $.fs.write(path, text)
    const seen = JSON.stringify(await readLearn($), null, 2)
    if (seen === text) break
    out = learnRun(runs, await readLearn($), r, project, now)
  }
  runs.push({ ...r, round: out.round })
  if (!out.changed) return
  const dir = memoryDir(await homeDir($), await rootOf($).catch(() => project))
  await $.fs.write(`${dir}/model-escalations.md`, escalationNote(out.learned.filter(l => l.project === project)))
  const index = String(await $.fs.read(`${dir}/MEMORY.md`).catch(() => ''))
  if (!index.includes('(model-escalations.md)')) await $.fs.write(`${dir}/MEMORY.md`, `${index}${index && !index.endsWith('\n') ? '\n' : ''}${MEMORY_LINE}\n`)
}

export function budgetDenial(role: string, used: Record<string, number>, budgets: Record<string, number>): string | undefined {
  const cap = budgets[role]
  return cap !== undefined && (used[role] ?? 0) >= cap ? `Switchboard: ${role} has used its ${cap} starts for today. Raise the budget on the Company card, or do this yourself.` : undefined
}

const READS = new Set(['Read', 'Grep', 'Glob'])
export const pausedDenial = (tool: string, paused: boolean) => (paused && !READS.has(tool) ? 'Switchboard is paused from the Company card: reading only until it is resumed.' : undefined)

// Usage hold: owned here, so a chat pauses near the limit and resumes after the reset with no Switchboard window open.
type Window = { kind: string; percentUsed: number; resetsAt?: string | number }
export type Hold = { kind: string; percent: number; resetsAt: number; mid?: boolean }
type HubPause = { kind?: unknown; percent?: unknown; resumeAt?: unknown }
const msOf = (r?: string | number) => (typeof r === 'number' ? r : r ? Date.parse(r) : NaN)
const kindText = (k: string) => k.replace(/_/g, '-')

/** The fullest window at pauseAt or over (99 by default, null off). One past its reset, or one the hub resumed by hand (pauseOff), counts as empty. */
export function overLimit(windows: Window[], pauseAt: number | null | undefined, now: number, pauseOff = -Infinity): Hold | undefined {
  if (pauseAt === null) return undefined
  const w = windows.filter(l => l.percentUsed >= (pauseAt ?? 99) && msOf(l.resetsAt) > Math.max(now, pauseOff)).sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return w && { kind: w.kind, percent: Math.floor(w.percentUsed), resetsAt: msOf(w.resetsAt) }
}

/** The hub's pause from limits.json, until its resumeAt: a window that closed never lifts it, so the time does. */
export const hubHold = (p: HubPause | undefined, now: number): Hold | undefined => {
  if (!p) return undefined
  const resetsAt = typeof p.resumeAt === 'number' ? p.resumeAt : Number.MAX_SAFE_INTEGER
  return resetsAt > now ? { kind: typeof p.kind === 'string' ? p.kind : 'usage', percent: typeof p.percent === 'number' ? p.percent : 99, resetsAt } : undefined
}

export function untilText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`
}

export const holdLine = (h: Hold, now: number) => `Paused: ${kindText(h.kind)} limit at ${h.percent}%, resumes in ${untilText(h.resetsAt - now)}`
export const holdDenial = (h: Hold, now: number) => `Paused by usage-meter: ${kindText(h.kind)} usage at ${h.percent}%. Stop here; this chat resumes by itself when the limit resets, in ${untilText(h.resetsAt - now)}.`

const COMPANY_MS = 10_000
const company: { at: number; paused: boolean; budgets: Record<string, number>; smart: boolean; advanced: Record<string, boolean>; limit?: HubPause; windows: Window[]; pauseAt?: number | null; pauseOff: number } = { at: -Infinity, paused: false, budgets: {}, smart: true, advanced: {}, windows: [], pauseOff: -Infinity }
const homeDir = async ($: EngineInterface) => norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')

/** The hub's company.json, read at most every 10 seconds; missing or broken means not paused, no budgets. */
async function readCompany($: EngineInterface) {
  const now = await $.clock.now()
  if (now - company.at < COMPANY_MS) return company
  company.at = now
  const home = await homeDir($)
  try {
    const f = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/company.json`)))
    company.paused = f.paused === true
    company.budgets = f.budgets && typeof f.budgets === 'object' ? f.budgets : {}
    company.smart = f.smartModelSwitch !== false
    company.advanced = f.advancedMode && typeof f.advancedMode === 'object' ? f.advancedMode : {}
  } catch { company.paused = false; company.budgets = {}; company.smart = true; company.advanced = {} }
  try {
    const l = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/limits.json`)))
    company.limit = l.paused === true && l.pause && typeof l.pause === 'object' ? l.pause : undefined
    company.windows = Array.isArray(l.windows) ? l.windows : []
    company.pauseAt = l.pauseAt === null ? null : typeof l.pauseAt === 'number' ? l.pauseAt : undefined
    company.pauseOff = typeof l.pauseOff === 'number' ? l.pauseOff : -Infinity
  } catch { company.limit = undefined; company.windows = []; company.pauseAt = undefined; company.pauseOff = -Infinity }
  return company
}

// This chat's own limits from session.measure; limits.json adds what other chats saw.
let measured: Window[] = []
const held: { id?: string; hold?: Hold; resumedAt?: number } = {}
let holdBusy = false
// Switchboard's resume prompt (hub-service.ts PAUSE_CONTINUE).
const HUB_RESUME = 'Usage limit reset. Continue where you stopped'
const RESUME_DEDUP_MS = 30 * 60_000
// A hold that starts this soon after a tool call, prompt or turn end cut work off, even with no call denied.
const RECENT_MS = 10 * 60_000
let activeAt = -Infinity
export const noteActive = async ($: EngineInterface) => { activeAt = await Promise.resolve().then(() => $.clock.now()).catch(() => activeAt) }

async function loadHold($: EngineInterface) {
  const id = await $.session.id()
  if (held.id === id) return
  const k = (await Promise.resolve().then(() => $.store.get('hold')).catch(() => undefined)) as typeof held | undefined
  const mine = k?.id === id
  Object.assign(held, { id, hold: mine ? k?.hold : undefined, resumedAt: mine ? k?.resumedAt : undefined })
}
const saveHold = ($: EngineInterface) => Promise.resolve().then(() => $.store.set('hold', { ...held })).catch(() => undefined)
const postHold = async ($: EngineInterface) => post($, { kind: 'hold', sessionId: held.id, hold: held.hold ?? null }).catch(() => undefined)

async function liftHold($: EngineInterface, now: number) {
  held.hold = undefined
  held.resumedAt = now
  // The cached limits.json may still hold the pause just lifted; reread it next tick.
  company.at = -Infinity
  await saveHold($)
  await $.ui.status(undefined)
  await postHold($)
}

const resumeText = (step?: string) => `${OWN}usage limit reset. Carry on from where you stopped${step ? `: ${step}` : ''}. Resume any subagents cut off with SendMessage.`

/** Every poll, idle or not: starts the hold, keeps its status line, and after the reset lifts it with one prompt if it cut work off. */
export async function holdTick($: EngineInterface) {
  if (holdBusy) return
  holdBusy = true
  try {
    await loadHold($)
    const now = await $.clock.now()
    const c = await readCompany($)
    const due = overLimit([...measured, ...c.windows], c.pauseAt, now, c.pauseOff) ?? hubHold(c.limit, now)
    const was = held.hold
    if (due) {
      await restoreFeed($).catch(() => undefined)
      const busy = was ? was.mid : now - activeAt < RECENT_MS || feed.shells.size > 0 || [...feed.tasks.values()].some(t => t.status === 'in_progress')
      held.hold = was && was.resetsAt >= due.resetsAt ? was : { ...due, ...(busy ? { mid: true } : {}) }
      if (held.hold !== was) { await saveHold($); await postHold($) }
      await $.ui.status(holdLine(held.hold, now))
      return
    }
    if (!was) return
    await liftHold($, now)
    if (!was.mid) return void (await $.ui.toast('Usage limit reset: unpaused'))
    await $.ui.toast('Resumed: limit reset')
    const step = [...feed.tasks.values()].find(t => t.status === 'in_progress')?.subject ?? feed.prompt
    await $.prompt.submit({ text: resumeText(step) })
  } finally { holdBusy = false }
}

/** The denial while held; a denied call means the chat was mid-work, so it gets the resume prompt. */
export async function heldNow($: EngineInterface) {
  await loadHold($)
  const now = await $.clock.now()
  const h = held.hold
  if (!h || h.resetsAt <= now) return undefined
  if (!h.mid) { held.hold = { ...h, mid: true }; await saveHold($) }
  return holdDenial(h, now)
}

/** Held and not past the reset: nothing here may start a turn, since the hold denies its every call. */
async function holding($: EngineInterface) {
  await loadHold($)
  return held.hold !== undefined && held.hold.resetsAt > (await $.clock.now())
}

async function startsToday($: EngineInterface) {
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const kept = ((await $.store.get('starts')) ?? {}) as { day?: string; used?: Record<string, number> }
  return { day, used: kept.day === day ? kept.used ?? {} : {} }
}

// Env style names (OPENAI_API_KEY) and the snake names that hold keys (api_key); sort_key or next_token hold none.
const NAMED = String.raw`\b(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|(?:api|access|secret|private|auth|client|refresh|session)_(?:key|token|secret))\b`
// A SECRET or PASSWORD name holds a secret whatever its value looks like.
const NAMED_ANY = String.raw`\b[A-Z0-9_]*(?:PASSWORD|SECRET)\b`
// Shapes keys and tokens take; a match becomes [removed] before a note is written or summarized.
const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // AWS secret keys: after their name, or next to an access key id (so before the AKIA rule).
  /(?<=aws_secret_access_key\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  /(?<=AKIA[0-9A-Z]{16}[\s,:;="'|]+)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Passwords (DB_PASSWORD, PGPASSWORD, passwd, pwd): a quoted value whole, any bare value right after '=',
  // and after ':' or a spaced '=' only a token with a digit or symbol, so 'password: done' stays prose.
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*")[^"\n]+(?=")/gi,
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*')[^'\n]+(?=')/gi,
  /(?<=(?:password|passwd|pwd)=)[^\s"']+/gi,
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*)(?=[^\s"',]*[0-9!@#$%^&*_.+\/~-])[^\s"',]+/gi,
  // A bearer token has a digit or symbol; 'Bearer authentication' is prose.
  /(?<=\bBearer\s+)(?=[A-Za-z]*[0-9_.~+/=-])[A-Za-z0-9_.~+/=-]{16,}(?![A-Za-z0-9_.~+/=-])/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  // --password x, --pass=x.
  /(?<=--pass(?:word)?[= ]["']?)[^\s"']+/gi,
  // A named value after = or :, quoted always, bare when it looks like a secret (a digit or symbol, or 12+ characters).
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*")[^"\\n]+(?=")`, 'g'),
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*')[^'\\n]+(?=')`, 'g'),
  new RegExp(`(?<=${NAMED_ANY}["']?\\s*[:=]\\s*)[^\\s"',;]+`, 'g'),
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*)(?=[^\\s"',;}]*[0-9!@#$%^&*_.+/~-]|[^\\s"',;}]{12})[^\\s"',;}]+`, 'g'),
  // mysql -pSECRET.
  /(?<=\bmysql(?:dump)?\b[^\n]*\s-p)[^\s"']+/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  // The password in scheme://user:password@host.
  /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[0-9a-fA-F]{32,}\b/g,
]
export const redact = (text: string) => SECRETS.reduce((s, re) => s.replace(re, '[removed]'), text)

/** The plan's tasks with steps still unticked. */
export function openTasks(plan: string) {
  const out: Array<{ n: string; title: string; done: number; total: number }> = []
  let cur: (typeof out)[number] | undefined
  for (const line of plan.split('\n')) {
    const head = /^### Task (\d+): (.+)$/.exec(line)
    if (head) {
      const task = { n: head[1] ?? '', title: (head[2] ?? '').trim(), done: 0, total: 0 }
      out.push(task)
      cur = task
      continue
    }
    if (/^#{1,3} /.test(line)) { cur = undefined; continue }
    const step = /^- \[( |x)\] \*\*Step/.exec(line)
    if (step && cur) { cur.total++; if (step[1] === 'x') cur.done++ }
  }
  return out.filter(t => t.total > 0 && t.done < t.total)
}

function decisions(plan: string, last = 5): string[] {
  const at = plan.indexOf('## Decisions')
  if (at < 0) return []
  const rows: string[] = []
  for (const line of plan.slice(at).split('\n').slice(1)) {
    if (/^#{1,3} /.test(line)) break
    if (line.startsWith('|') && !/^\|\s*-/.test(line) && !/^\|\s*Question\s*\|/.test(line)) rows.push(line.trim())
  }
  return rows.slice(-last)
}

type Task = { subject: string; status: string }

// Bullets under a plan's "## Dead ends", newest last.
function deadEnds(plan: string): string[] {
  const at = plan.indexOf('## Dead ends')
  if (at < 0) return []
  const rows: string[] = []
  for (const line of plan.slice(at).split('\n').slice(1)) {
    if (/^#{1,3} /.test(line)) break
    if (line.startsWith('- ')) rows.push(line.trim())
  }
  return rows
}

// ~1,250 tokens, plus what is never cut: the last request, open tasks, running work and errors.
const NOTE_BUDGET = 5_000
// [dead ends, files touched, earlier requests, subagent results] kept at each step.
const TRIMS: Array<[number, number, number, number]> = [[5, 40, 5, 8], [3, 15, 3, 4], [1, 5, 1, 2], [0, 0, 0, 0]]
const REQUEST_MAX = 300
const openLine = (t: Task) => `- [ ] ${t.subject} (${t.status.replace('_', ' ')})`

export type Summary = { goal?: string; tests?: string; decisions?: string[]; next?: string }

/** The fixed lines the wrap-up turn ends with; undefined when it wrote none. */
export function summaryOf(answer: string): Summary | undefined {
  const one = (k: string) => new RegExp(`^${k}:[ \\t]*(\\S.*)$`, 'mi').exec(answer)?.[1]?.trim()
  const block = /^Decisions:[ \t]*\n((?:[ \t]*- .*(?:\n|$))+)/mi.exec(answer)?.[1]
  const decisions = block?.split('\n').map(l => l.trim().replace(/^- /, '')).filter(Boolean)
  const s: Summary = { goal: one('Goal'), tests: one('Tests'), next: one('Next'), ...(decisions?.length ? { decisions } : {}) }
  const set = Object.entries(s).filter(([, v]) => v !== undefined)
  return set.length ? Object.fromEntries(set) : undefined
}

export function handoffNote(o: {
  project: string; cwd: string; branch?: string; planPath?: string; planText?: string; session: string; now: number
  tasks?: Task[]; ask?: string; requests?: string[]; errors?: string[]; running?: string[]; changed?: string[]; transcript?: string
  summary?: Summary; results?: string[]; stopped?: string[]
}): string {
  const stamp = new Date(o.now).toISOString().slice(0, 16).replace('T', ' ')
  const plan = o.planText ? openTasks(o.planText) : []
  const picked = o.planText ? decisions(o.planText) : []
  const dead = o.planText ? deadEnds(o.planText) : []
  const tasks = o.tasks ?? []
  // git status lines to paths: the new chat runs git diff itself.
  const files = (o.changed ?? []).map(l => l.slice(3).trim()).filter(Boolean)
  const results = o.results ?? []
  const quote = (t: string) => t.split('\n').map(l => `> ${l}`)
  const cut = (t: string) => (t.length > REQUEST_MAX ? `${t.slice(0, REQUEST_MAX)} (cut, see transcript)` : t)
  // The last request has its own section; the list does not repeat it.
  const asked = o.ask !== undefined && o.requests?.at(-1) === o.ask ? o.requests.slice(0, -1) : o.requests ?? []
  const open = [...tasks.filter(t => t.status !== 'completed').map(openLine), ...plan.map(t => `- Task ${t.n}: ${t.title} (${t.done} of ${t.total} steps done)`)]
  const done = tasks.filter(t => t.status === 'completed').length
  const s = o.summary ?? {}
  const firstAsk = (o.requests?.[0] ?? o.ask ?? '').split('\n')[0]?.slice(0, 200)
  const build = ([deadCap, filesCap, asksCap, resultsCap]: [number, number, number, number]) => {
    const lines = [
      `# Handoff: ${o.project}, ${stamp} UTC`,
      '',
      'Read this note fully before acting. Recreate every open task below with the task tools before any other work, then, if the aar skill is installed, have a subagent run it on the old chat (Old transcript below), then take the next action. A task counts as done only with the check that proved it.',
    ]
    if (o.ask) lines.push('', '## Last request, verbatim', '', ...quote(o.ask))
    lines.push('', '## Goal', '', s.goal ?? (firstAsk || 'see the last request'))
    lines.push('', '## State', '', `- Folder: ${o.cwd}`, `- Branch: ${o.branch ?? 'unknown'}`, `- Plan: ${o.planPath ?? 'none'}`, `- Tests last run: ${s.tests ?? 'unknown, run them first'}`)
    const why = [...(s.decisions ?? []).map(d => `- ${d}`), ...picked]
    if (why.length) lines.push('', '## Decisions', '', ...why)
    // A chat that never used the task tools records none: say so, so the next chat looks elsewhere.
    const none = tasks.length || plan.length ? '- none' : '- none recorded (task tools may be missing in that chat); check Subagent results and Next action'
    lines.push('', '## Open tasks', '', ...(o.stopped ?? []).map(a => `- stopped: ${a} (cut off by TaskStop, check what it finished)`), ...(open.length ? open : [none]))
    if (o.running?.length) lines.push('', '## Running work', '', 'The old chat may still be running these: check its process (ps for its session id) and recent file changes first; if it is alive, wait for its report instead of rerunning. Otherwise check each output and rerun what is cut off.', '', ...o.running.map(r => `- ${r}`))
    if (o.errors?.length) lines.push('', '## Errors', '', '```', ...o.errors, '```')
    if (results.length && resultsCap) lines.push('', '## Subagent results', '', ...results.slice(-resultsCap).map(r => `- ${r}`))
    if (files.length) {
      const shown = files.slice(0, filesCap)
      lines.push('', '## Files touched', '', ...shown, ...(files.length > shown.length ? [`and ${files.length - shown.length} more (git status)`] : []))
    }
    lines.push('', '## Next action', '', s.next ?? (open.length ? 'Take the first open task.' : 'Carry on with the last request.'))
    if (done) lines.push('', `${done} task${done === 1 ? '' : 's'} done in the old chat.`)
    const shown = asked.length > asksCap ? asked.slice(-asksCap) : asked
    if (shown.length) lines.push('', '## Earlier requests', '', ...(asked.length > shown.length ? [`${asked.length - shown.length} older, see transcript`, ''] : []), ...shown.flatMap((r, i) => [...(i ? [''] : []), ...quote(cut(r))]))
    const deadShown = dead.slice(dead.length - Math.min(deadCap, dead.length))
    if (deadShown.length) lines.push('', '## Dead ends', '', ...deadShown, ...(dead.length > deadShown.length ? [`(${dead.length - deadShown.length} older in the plan)`] : []))
    lines.push(
      '',
      `- Old transcript: ${o.transcript ?? 'unknown'} (grep it for detail, do not paste it)`,
      `- Old session: ${o.session}`,
      '',
      'Keys, tokens and passwords are never written here; anything shaped like one was removed.',
    )
    return redact(lines.join('\n'))
  }
  const kept = (o.ask?.length ?? 0) + (o.errors ?? []).join('\n').length + open.join('\n').length + (o.running ?? []).join('\n').length
  let note = ''
  for (const caps of TRIMS) {
    note = build(caps)
    if (note.length <= NOTE_BUDGET + kept) break
  }
  return note
}

/** Last check before the note goes out: every unfinished task in the store is under Open tasks. */
export function ensureOpenTasks(note: string, tasks: Task[]): string {
  const at = note.indexOf('## Open tasks')
  const end = at < 0 ? -1 : note.indexOf('\n## ', at + 1)
  const section = at < 0 ? '' : note.slice(at, end < 0 ? undefined : end)
  // The note is redacted, so subjects are too, to compare and to insert.
  const missing = tasks.map(t => ({ ...t, subject: redact(t.subject) })).filter(t => t.status !== 'completed' && !section.includes(`] ${t.subject} (`)).map(openLine)
  if (!missing.length) return note
  if (at < 0) {
    // Where it belongs: before the first section that follows Open tasks.
    const where = Math.min(...['\n## Running work', '\n## Errors', '\n## Subagent results', '\n## Files touched', '\n## Next action'].map(h => note.indexOf(h)).filter(i => i >= 0), note.length)
    return `${note.slice(0, where)}\n\n## Open tasks\n\n${missing.join('\n')}${note.slice(where)}`
  }
  const cut = end < 0 ? note.length : end
  return `${note.slice(0, cut).replace(/\n+$/, '').replace(/\n- none(?: recorded .*)?$/, '')}\n${missing.join('\n')}\n${note.slice(cut)}`
}

const STOP = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'for', 'and', 'with', 'my', 'me', 'please', 'can', 'you', 'could', 'i', 'it', 'is', 'this', 'that', 'now'])
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w && !STOP.has(w))

/** A plan's filename without its date prefix and .md, as words. */
const planWords = (planPath?: string) => words((planPath ? (planPath.split('/').pop() ?? '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') : '').replace(/-/g, ' '))

/** claude/<plan>-<task>, or claude/continue-MMDD when neither is known. */
export function branchFor(planPath?: string, task?: string, now = new Date()): string {
  const all = [...planWords(planPath), ...words(task ?? '')].slice(0, 6)
  if (!all.length) return `claude/continue-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `claude/${all.join('-').slice(0, 40).replace(/-+$/, '')}`
}

/** The window whose folder holds the chat, deepest first: the one that opens the fresh chat. */
export function homeOf(targets: Target[], cwd: string): Target | undefined {
  const c = norm(cwd)
  return targets.filter(t => c === t.workspace || c.startsWith(`${t.workspace}/`)).sort((a, b) => b.workspace.length - a.workspace.length)[0]
}

// Past 90% of the compaction point, a turn's end is the last clean break before it compacts.
export const nearFull = (tokens: number, compactAt?: number) => !!compactAt && tokens >= compactAt * 0.9
// Past this the wrap-up has run long: hand off with whatever still runs listed.
const hardFull = (tokens: number, compactAt?: number) => !!compactAt && tokens >= compactAt * 0.97

const KEEP = 'Keep the handoff below in the summary word for word: it is the plan, the open tasks, the latest decisions and the branch of the work in progress. Never copy keys, tokens or passwords into the summary.'

type Shell = { id: string; command: string; output?: string }
type Result = { id: string; line: string }
// What the feed remembers between hooks; the chat's own part is saved to the store (saveFeed) so a reload keeps it.
const feed: {
  targets: Target[]; foundAt: number; lastLive: number; compactAt?: number; handedOff?: string; prompt?: string; ask?: string; requests: string[]; errors: string[]
  file?: string; plan?: string; brief?: string; tasks: Map<string, Task>; shells: Map<string, Shell>; results: Result[]; summary?: Summary
  // Subagents TaskStop cut off since the last request.
  stopped: string[]
  restored?: string; pausing?: number; freshNote?: string; nudge?: { n: number; tasks: string }
} = { targets: [], foundAt: -Infinity, lastLive: -Infinity, tasks: new Map(), requests: [], errors: [], shells: new Map(), results: [], stopped: [] }

type Kept = { tasks?: Array<[string, Task]>; ask?: string; requests?: string[]; errors?: string[]; shells?: Shell[]; results?: Result[]; stopped?: string[]; summary?: Summary; pausing?: number; at: number }
const FEEDS_KEPT = 20
const REQUESTS_KEPT = 10

/** This session's saved feed, once per session: a reloaded mod picks up where it was. */
export async function restoreFeed($: EngineInterface) {
  const id = await $.session.id()
  if (feed.restored === id) return
  // Another session in this process (a /clear): nothing of the last one carries over.
  const fresh = feed.restored !== undefined
  feed.restored = id
  const k = ((await Promise.resolve().then(() => $.store.get('feeds')).catch(() => undefined)) as Record<string, Kept> | undefined)?.[id]
  if (!k && !fresh) return
  feed.tasks = new Map(k?.tasks ?? [])
  feed.ask = k?.ask
  feed.requests = k?.requests ?? []
  feed.errors = k?.errors ?? []
  feed.shells = new Map((k?.shells ?? []).map(x => [x.id, x]))
  feed.results = k?.results ?? []
  feed.stopped = k?.stopped ?? []
  feed.summary = k?.summary
  feed.pausing = k?.pausing
  feed.freshNote = undefined
  feed.nudge = undefined
  if (fresh) feed.plan = feed.file = feed.prompt = undefined
}

async function saveFeed($: EngineInterface) {
  const id = await $.session.id()
  const all = ((await $.store.get('feeds')) ?? {}) as Record<string, Kept>
  const mine: Kept = {
    tasks: [...feed.tasks], ask: feed.ask, requests: feed.requests.slice(-REQUESTS_KEPT), errors: feed.errors,
    shells: [...feed.shells.values()], results: feed.results, stopped: feed.stopped, summary: feed.summary, pausing: feed.pausing, at: await $.clock.now(),
  }
  await $.store.set('feeds', Object.fromEntries(Object.entries({ ...all, [id]: mine }).sort((a, b) => b[1].at - a[1].at).slice(0, FEEDS_KEPT)))
}

/** Background shells this chat started and has not seen end: Bash run_in_background, ended by TaskStop or its notification. */
export function noteShell(tool: string, e: Record<string, unknown>, result: unknown, text: string) {
  if (tool === 'Bash' && e.run_in_background === true) {
    const r = (result ?? {}) as { backgroundTaskId?: unknown; backgroundOutputPath?: unknown }
    const id = typeof r.backgroundTaskId === 'string' ? r.backgroundTaskId : /background with ID: (\S+?)\.?(?:\s|$)/.exec(text)?.[1]
    if (!id) return
    const output = typeof r.backgroundOutputPath === 'string' ? r.backgroundOutputPath : /Output is being written to: (\S+)/.exec(text)?.[1]
    feed.shells.set(id, { id, command: String(e.command ?? '').slice(0, 200), ...(output ? { output } : {}) })
  } else if (tool === 'TaskStop' || tool === 'KillShell') {
    // Stopped or already gone; either way nothing runs under that id now.
    const id = e.task_id ?? e.shell_id
    const type = (result as { task_type?: unknown } | undefined)?.task_type
    if (typeof id === 'string' && !feed.shells.delete(id) && tool === 'TaskStop' && type !== 'local_bash' && !feed.stopped.includes(id)) feed.stopped.push(id)
  }
}

export function shellsDone(text: string) {
  for (const m of text.matchAll(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>(?:completed|failed|killed|stopped)<\/status>/g)) feed.shells.delete(m[1] ?? '')
}

/** Notices absorbed mid turn never reach prompt.submit; the transcript still has them. */
export function shellsDoneIn(transcript: string) {
  for (const line of transcript.split('\n')) {
    if (!line.includes('absorbed_mid_turn')) continue
    try {
      const q = JSON.parse(line) as { type?: unknown; reason?: unknown; content?: unknown }
      if (q.type === 'queue-operation' && q.reason === 'absorbed_mid_turn' && typeof q.content === 'string') shellsDone(q.content)
    } catch { /* a line mid-write */ }
  }
}

// fs.read refuses files over 4 MiB and a transcript runs to hundreds of MB, so tail seeks to the end.
// The cut first line fails JSON.parse and is skipped.
// ponytail: a notice absorbed more than TAIL_BYTES back is missed; keep a scanned byte offset if that bites.
const TAIL_BYTES = 2_000_000
async function syncShells($: EngineInterface, transcript: string) {
  if (!feed.shells.size) return
  const r = await Promise.resolve().then(() => $.process.run(['tail', '-c', String(TAIL_BYTES), transcript], { timeoutMs: 5_000 })).catch(() => undefined)
  if (r?.exitCode === 0) shellsDoneIn(r.stdout)
}

export const liveShells = () => [...feed.shells.values()]

// After the handoff: running work finishes here, new work starts in the next chat.

export const handoffDenial = (note?: string) => `Context is nearly full: no new tasks here. Running tasks finish, then this work continues in the next chat. ${note ? `Add new tasks to the handoff note instead (${note}).` : 'Add new tasks to the task list instead; they move to the next chat.'}`

/** The denial for new work once this chat wraps up or has handed off. */
async function heldBack($: EngineInterface) {
  const note = await handedOff($).catch(() => undefined)
  if (note) return handoffDenial(note)
  await restoreFeed($).catch(() => undefined)
  return feed.pausing !== undefined ? handoffDenial() : undefined
}
const freshStart = (note: string) => `Read ${note} fully before acting. Recreate each open task in it with the task tools first; in your first reply, restate the goal and tick each open task against the note, then carry on.`
// The hub's first prompt for a fresh chat names its note.
const FRESH = /^Continue from (.+?\.md): read it first/

const ERRORS_KEPT = 3
const ERROR_MAX = 500
export const errorEntry = (tool: string, text: string) => `${tool}: ${redact(text).slice(0, ERROR_MAX)}${text.length > ERROR_MAX ? ' (truncated, see transcript)' : ''}`

// This mod's own prompts start so; they are no requests of Kenneth's.
const OWN = 'Switchboard: '
const PAUSE_MARK = `${OWN}context is nearly full`
const pausePrompt = (shells: Shell[]) => [
  `${PAUSE_MARK} and a fresh chat takes over after a clean pause. Finish the step you are on and start no new tasks or subagents.`,
  'SendMessage each running subagent to stop new edits, leave its files type-clean and report done vs not done; wait for the reports, and TaskStop only one that does not answer.',
  shells.length ? `Stop these background shells with TaskStop before you end: ${shells.map(x => `${x.id} (${x.command})`).join(', ')}.` : 'Stop any background shell you started with TaskStop before you end.',
  'Update the task list so every open task has its real status; mark one completed only if a check proved it.',
  'Then end your reply with these lines and nothing after them:',
  'Goal: <the goal in one line>', 'Tests: <last test command and its result, or not run>', 'Decisions:', '- <pick>: <why>', 'Next: <the next action>',
].join('\n')

const stagesRule = (id: string) => `Advanced mode is on for this project: for a multi-step task, follow the \`stages\` skill and keep each step in its stage folder under .switchboard/stages/; this chat's id is ${id}.`
const ASK_RULE = 'When you need Kenneth to answer or act, ask with the AskUserQuestion tool so it pops up in the terminal and Switchboard. Never end a turn with open tasks you can do yourself.'
// Same rule as Switchboard's progress.ts askedQuestion: the last paragraph, past a trailing fenced block, ends in '?'.
// Both test suites hold the same table of cases (switchboard extension/test/progress.test.ts).
export const endsAsking = (text: string) => (text.replace(/\n*```[^\n]*\n(?:(?!```)[\s\S])*```\s*$/, '').trim().split(/\n\s*\n/).pop() ?? '').trim().endsWith('?')
// Nudges per chat that keeps stopping without touching its tasks; after that it waits for Kenneth.
const NUDGES = 3
// The main chat's last answer, so a later compaction does not push past a question; a reload forgets it.
let lastAnswer = ''

// Run indefinitely: a per-chat switch the hub keeps in ~/.claude/switchboard/indefinite.json as { sessionId: onAt } or { sessionId: { onAt, maxHours?, maxCostUsd?, gate? } }.
const IND_READ_MS = 5_000
const IND_ASK_MS = 15 * 60_000
const IND_DONE = /^Run indefinitely: done\s*$/m
const IND_ROUND = 'Run indefinitely is on. Do another round: audit the project for bugs, errors, user problems and hard-to-use parts; fix them; add components that would help this project; run the checks; dispatch role subagents as needed. Decide everything yourself and note decisions. Never commit. When nothing is left you can improve, end with the line `Run indefinitely: done`.'
const IND_ASK_RULE = 'Run indefinitely is on: ask every question only the user can answer now, in one AskUserQuestion round before you start work; after that, decide yourself and note what you decided. Never end a turn with open tasks you can do yourself.'
const ind: { at: number; flags: Record<string, unknown> } = { at: -Infinity, flags: {} }
// onAt of the rounds already stopped, and of flags this chat ended itself (the file can lag the hub).
const indStopped = new Map<string, number>()
const indDone = new Map<string, number>()

type IndCfg = { onAt: number; maxHours?: number; maxCostUsd?: number; gate?: string }
const IND_GATE_MS = 600_000
const IND_GATE_LINES = 20
const posNum = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)

/** This chat's flag as a config: a plain number is just onAt. Missing, broken or already ended means off. */
async function indefiniteCfg($: EngineInterface): Promise<IndCfg | undefined> {
  const now = await $.clock.now()
  if (now - ind.at >= IND_READ_MS) {
    ind.at = now
    try { ind.flags = JSON.parse(String(await $.fs.read(`${await homeDir($)}/.claude/switchboard/indefinite.json`))) ?? {} } catch { ind.flags = {} }
  }
  const id = await $.session.id()
  const v = ind.flags[id] as Partial<IndCfg> | number | undefined
  const onAt = typeof v === 'object' && v !== null ? v.onAt : v
  if (typeof onAt !== 'number' || indDone.get(id) === onAt) return undefined
  if (typeof v === 'number' || v === undefined) return { onAt }
  return { onAt, maxHours: posNum(v.maxHours), maxCostUsd: posNum(v.maxCostUsd), gate: typeof v.gate === 'string' && v.gate.trim() ? v.gate.trim() : undefined }
}

/** onAt when Run indefinitely is on for this chat, else undefined. */
export async function indefiniteOn($: EngineInterface): Promise<number | undefined> {
  return (await indefiniteCfg($))?.onAt
}

const tailLines = (text: string) => text.trim().split('\n').slice(-IND_GATE_LINES).join('\n')

/** Gate exit 0 passes; anything else, or a gate that cannot run, fails with its output tail. */
async function runGate($: EngineInterface, gate: string, cwd?: string): Promise<{ ok: true } | { ok: false; out: string }> {
  try {
    const r = await $.process.run(['/bin/sh', '-c', gate], { cwd: cwd ?? (await $.session.cwd()), timeoutMs: IND_GATE_MS })
    return r.exitCode === 0 ? { ok: true } : { ok: false, out: tailLines(`${r.stdout}\n${r.stderr}`) }
  } catch (err) {
    return { ok: false, out: `gate did not finish: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// A /goal file at the project root steers its rounds; its Check line is the gate when the hub sets none, and the done line alone cannot pass it.
const goalPath = (root: string, id: string) => `${root}/.switchboard/goals/${id}.md`
const goalRound = (file: string) => `Run indefinitely is on with a goal in ${file}. Do another round toward it: build or fix what is still missing, test every function it names against how it should work, run its check and the project checks, dispatch role subagents as needed. Decide everything yourself and note decisions in the goal file. Never commit. When every point in the goal works with no issues and its check passes, end with the line \`Run indefinitely: done\`.`

/** A fresh chat copies the /goal file of the chat it took over from (the note path ends -<id8>.md); returns the new path. */
export async function carryGoal($: EngineInterface, note: string): Promise<string | undefined> {
  const old = /-([0-9a-f]{8})\.md$/.exec(note)?.[1]
  if (!old) return undefined
  const root = await rootOf($)
  const dir = `${root}/.switchboard/goals`
  const from = (await $.fs.list(dir).catch(() => [])).find(e => e.name.startsWith(old) && e.name.endsWith('.md'))
  if (!from) return undefined
  const to = goalPath(root, await $.session.id())
  if (await $.fs.read(to).then(() => true, () => false)) return to
  await $.fs.write(to, String(await $.fs.read(`${dir}/${from.name}`)))
  return to
}

/** The next-round prompt for a Stop while on; the done line, a passing gate or a spent budget lets the stop through and tells the hub. A usage hold or handoff is never blocked. */
export async function indefiniteStop($: EngineInterface, answer: string): Promise<string | undefined> {
  const cfg = await indefiniteCfg($)
  if (cfg === undefined) return undefined
  const at = cfg.onAt
  const id = await $.session.id()
  const finish = async (reason?: string) => {
    indDone.set(id, at)
    const hours = Math.max(0, (await $.clock.now()) - at) / 3_600_000
    const usd = (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.cost?.usd
    const usage = `used ${typeof usd === 'number' ? `$${usd.toFixed(2)} ` : ''}over ${Math.round(hours * 10) / 10}h`
    await post($, { kind: 'indefinite-done', sessionId: id, usage, ...(reason ? { reason } : {}) }).catch(() => undefined)
  }
  const root = await rootOf($)
  const file = goalPath(root, id)
  const goal = await $.fs.read(file).then(String, () => undefined)
  const check = cfg.gate ? undefined : goal?.match(/^Check: `([^`\n]+)`/m)?.[1].trim()
  if (IND_DONE.test(answer) && !check) { await finish(); return undefined }
  if ((await holding($).catch(() => false)) || feed.pausing !== undefined || feed.handedOff === id || (await handedOff($).catch(() => undefined))) return undefined
  indStopped.set(id, at)
  let failed = ''
  const gate = cfg.gate ?? check
  if (gate) {
    const g = await runGate($, gate, check ? root : undefined)
    if (g.ok) { await finish(`gate passed: ${gate}`); return undefined }
    failed = `\n\nThe gate \`${gate}\` failed. Its last output:\n${redact(g.out)}`
  }
  if (cfg.maxHours !== undefined || cfg.maxCostUsd !== undefined) {
    const hours = ((await $.clock.now()) - at) / 3_600_000
    const usd = (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.cost?.usd
    if ((cfg.maxHours !== undefined && hours >= cfg.maxHours) || (cfg.maxCostUsd !== undefined && typeof usd === 'number' && usd >= cfg.maxCostUsd)) {
      await finish('budget reached (not a success)')
      return undefined
    }
  }
  return (goal === undefined ? IND_ROUND : goalRound(file)) + failed
}

/** Deny text for asking Kenneth while on; AskUserQuestion is open until the first stop or 15 min after on, the up-front round. */
export async function indefiniteDenial($: EngineInterface, tool: string): Promise<string | undefined> {
  if (tool !== 'AskUserQuestion' && tool !== 'mcp__switchboard__ask') return undefined
  const at = await indefiniteOn($)
  if (at === undefined) return undefined
  // A handoff chat carries an old onAt, so the window keeps it from asking again.
  if (tool === 'AskUserQuestion' && indStopped.get(await $.session.id()) !== at && (await $.clock.now()) - at < IND_ASK_MS) return undefined
  return 'Run indefinitely is on: decide yourself and say what you decided.'
}

/** The ask rule to use while on, else undefined. */
export const indefiniteAsk = async ($: EngineInterface) => ((await indefiniteOn($).catch(() => undefined)) === undefined ? undefined : IND_ASK_RULE)

/** A turn that ended with open tasks and nothing running is asked to carry on, unless it asked Kenneth something or wrapped up. */
async function keepGoing($: EngineInterface, answer: string) {
  const tasks = JSON.stringify([...feed.tasks])
  if (feed.nudge?.tasks !== tasks) feed.nudge = undefined
  const open = [...feed.tasks.values()].filter(t => t.status !== 'completed')
  const n = feed.nudge?.n ?? 0
  if (await holding($)) return
  if (await indefiniteOn($).catch(() => undefined) !== undefined) return
  if (!open.length || n >= NUDGES || endsAsking(answer) || /commit message[^\n]*\n+```/i.test(answer) || feed.shells.size || (await liveAgents($)).length) return
  feed.nudge = { n: n + 1, tasks }
  await $.prompt.submit({ text: `${OWN}you ended your turn with open tasks: ${open.slice(0, 10).map(t => t.subject.slice(0, 80)).join('; ')}. Keep working on them. ${ASK_RULE}` })
}

const wrapUp = (note: string) => `Context is nearly full and a fresh chat takes over. Start no new tasks or subagents. Wait for running tasks to finish, then append to ${note}: open tasks, decisions, dead ends (one line each with why), results of finished tasks and next steps. Then stop.`

type Handoffs = Record<string, { note: string; at: number }>
const HANDOFFS_KEPT = 20

/** The note this session handed off to, kept in the store so a reload still holds new work. */
async function handedOff($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  return ((await $.store.get('handoffs')) as Handoffs | undefined)?.[id]?.note
}

async function rememberHandoff($: EngineInterface, id: string, note: string, at: number) {
  const all = { ...((await $.store.get('handoffs')) as Handoffs | undefined), [id]: { note, at } }
  await $.store.set('handoffs', Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, HANDOFFS_KEPT)))
}

/** Tracks the lead's task list from its own tool calls; TodoWrite replaces it whole. */
export function noteTasks(tool: string, e: Record<string, unknown>, result: unknown) {
  if (tool === 'TodoWrite' && Array.isArray(e.todos)) {
    feed.tasks = new Map((e.todos as Array<{ content: string; status: string }>).map((t, i) => [`todo-${i}`, { subject: t.content, status: t.status }]))
  } else if (tool === 'TaskCreate') {
    const t = (result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (t?.id) feed.tasks.set(t.id, { subject: t.subject ?? String(e.subject), status: 'pending' })
  } else if (tool === 'TaskUpdate' && typeof e.taskId === 'string') {
    const t = feed.tasks.get(e.taskId)
    if (!t) return
    if (e.status === 'deleted') feed.tasks.delete(e.taskId)
    else feed.tasks.set(e.taskId, { subject: typeof e.subject === 'string' ? e.subject : t.subject, status: typeof e.status === 'string' ? e.status : t.status })
  }
}

const LIVE = new Set(['pending', 'running', 'waiting'])
const KEPT_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskStop', 'KillShell'])
const RESULTS_KEPT = 8

/** Once, after the fresh chat's first turn: the note's open tasks it has not recreated, by subject. */
async function checkFresh($: EngineInterface) {
  const path = feed.freshNote
  if (!path) return
  feed.freshNote = undefined
  const note = String(await $.fs.read(path).catch(() => ''))
  const at = note.indexOf('## Open tasks')
  const end = note.indexOf('\n## ', at + 1)
  const want = [...note.slice(at, end < 0 ? undefined : end).matchAll(/^- \[ \] (.+) \([a-z ]+\)$/gm)].map(m => m[1] ?? '')
  const have = new Set([...feed.tasks.values()].filter(t => t.status !== 'completed').map(t => t.subject))
  const missing = at < 0 ? [] : want.filter(t => !have.has(t))
  if (!missing.length) return
  await $.ui.toast(`Fresh chat is missing ${missing.length} open task(s) from its note`)
  await $.prompt.submit({ text: `Switchboard: these open tasks from ${path} are not in your task list yet. Recreate each with the task tools now: ${missing.join('; ')}` })
}

const liveAgents = ($: EngineInterface) => Promise.resolve().then(() => $.agent.list()).then(list => list.filter(a => LIVE.has(a.status))).catch(() => [])

/** Subagents and shells still at work, each with where its output is, and the working tree's changes; either may be out of reach (a test, no git). */
async function whatIsLive($: EngineInterface, cwd: string, subagents: string) {
  const running = [
    ...(await liveAgents($)).map(a => `agent ${a.id} (${a.type}: ${a.description}), output ${subagents}/agent-${a.id}.jsonl`),
    ...liveShells().map(x => `shell ${x.id}: ${x.command}${x.output ? `, output ${x.output}` : ''}`),
  ]
  const changed = await Promise.resolve().then(() => $.process.run(['git', 'status', '--short'], { cwd, timeoutMs: 5_000 }))
    .then(r => (r.exitCode === 0 ? r.stdout.split('\n').filter(Boolean) : [])).catch(() => [])
  return { running, changed }
}

/** Remembers a plan this chat read or wrote, so its handoff names that plan and not one another chat touched last. */
export function notePlan(file: unknown) {
  if (typeof file === 'string' && /\/docs\/superpowers\/plans\/[^/]+\.md$/.test(norm(file))) feed.plan = norm(file)
}

const ASK = 'hub_ask'
const RECALL = 'hub_recall'
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])

async function discover($: EngineInterface) {
  const now = await $.clock.now()
  if (now - feed.foundAt < REDISCOVER_MS) return feed.targets
  feed.foundAt = now
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const dir = `${norm(home)}/.claude/switchboard`
  const files: Discovery[] = []
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'workspaces.json') continue
    try { files.push(JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))) } catch { /* a file mid-write */ }
  }
  feed.targets = targetsOf(files)
  return feed.targets
}

// $.http.fetch takes no timeout or signal, so a frozen window would hold the chat: undefined after two seconds.
// A host with no clock.sleep (a test double) just waits on the fetch.
const fetchSoon = ($: EngineInterface, url: string, init?: Parameters<EngineInterface['http']['fetch']>[1]) => Promise.race([
  $.http.fetch(url, init),
  Promise.resolve().then(() => $.clock.sleep(FETCH_MS)).then(() => undefined, () => new Promise<never>(() => {})),
]).catch(() => undefined)

// The window token goes in a header, out of the URL.
const withToken = (t: Target) => ({ headers: { 'X-Switchboard-Token': t.token } })

async function post($: EngineInterface, body: Record<string, unknown>) {
  await Promise.all((await discover($)).map(async t => {
    const sent = await fetchSoon($, `http://127.0.0.1:${t.port}/hub`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token, ...body }),
    })
    // A closed window or a new token: look again next time.
    if (!sent || sent.status === 403) feed.foundAt = -Infinity
  }))
}

async function postLive($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const now = await $.clock.now()
  if (now - feed.lastLive < POST_EVERY_MS) return
  feed.lastLive = now
  await post($, {
    kind: 'live', sessionId: await $.session.id(), cwd: await $.session.cwd(), model: await $.session.model(),
    tokens: usage.context.tokens, compactAt: feed.compactAt, costUsd: usage.cost?.usd, prompt: feed.prompt, file: feed.file,
    limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  })
}

async function count($: EngineInterface, owner: string) {
  const uses = ((await $.store.get('uses')) ?? {}) as Record<string, number>
  await $.store.set('uses', { ...uses, [owner]: (uses[owner] ?? 0) + 1 })
}

// clock.every does not wait on its fn, and a slow window outlasts a period.
let polling = false
export async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    const id = await $.session.id()
    const got = await Promise.all((await discover($)).map(t => fetchSoon($, `http://127.0.0.1:${t.port}/hub/inbox?session=${encodeURIComponent(id)}`, withToken(t))))
    for (const g of got) {
      if (!g?.ok) continue
      try { await deliver($, JSON.parse(g.text) as InboxItem[]) } catch { /* not a list */ }
    }
  } finally { polling = false }
}

/** The window holding this chat's folder, asked for its brief or an answer; this project only. */
async function askHome($: EngineInterface, route: 'brief' | 'ask' | 'recall', q?: string) {
  const cwd = norm(await $.session.cwd())
  const home = homeOf(await discover($), cwd)
  if (!home) return undefined
  const query = `cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(await $.session.id())}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const got = await fetchSoon($, `http://127.0.0.1:${home.port}/hub/${route}?${query}`, withToken(home))
  return got?.ok ? got.text : undefined
}

async function start($: EngineInterface) {
  if ((await $.store.get('since')) === undefined) await $.store.set('since', new Date(await $.clock.now()).toISOString().slice(0, 10))
  const usage = await $.session.usage({ breakdown: 'summary' })
  feed.compactAt = usage.context.breakdown?.autoCompactThreshold
  await postLive($, usage)
  const b = usage.context.breakdown
  if (b) await post($, { kind: 'diet', ...dietOf(b, ((await $.store.get('uses')) ?? {}) as Record<string, number>) })
}

// A chat's subagents sit under <id>/subagents.
async function transcriptOf($: EngineInterface) {
  return `${projectDir(await homeDir($), await rootOf($))}/${await $.session.id()}.jsonl`
}

async function readNote($: EngineInterface) {
  await restoreFeed($)
  const cwd = norm(await $.session.cwd())
  const dir = `${cwd}/docs/superpowers/plans`
  // The plan changed last, as the Hub's Plan card picks it; by name, an undated file outsorts every dated one.
  // The plan this chat opened wins; any other chat may have touched a newer one.
  const plan = feed.plan?.startsWith(`${dir}/`) ? undefined : (await $.fs.list(dir).catch(() => [])).filter(e => e.kind === 'file' && e.name.endsWith('.md')).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  const planPath = feed.plan?.startsWith(`${dir}/`) ? feed.plan : plan ? `${dir}/${plan.name}` : undefined
  const planText = planPath ? String(await $.fs.read(planPath).catch(() => '')) : undefined
  const head = String(await $.fs.read(`${cwd}/.git/HEAD`).catch(() => ''))
  const branch = /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]
  const id = await $.session.id()
  const transcript = await transcriptOf($)
  await syncShells($, transcript)
  const subagents = `${transcript.slice(0, -'.jsonl'.length)}/subagents`
  const { running, changed } = await whatIsLive($, cwd, subagents)
  const tasks = [...feed.tasks.values()]
  const note = ensureOpenTasks(handoffNote({
    project: cwd.split('/').pop() ?? cwd, cwd, branch, planPath, planText, session: id, now: await $.clock.now(),
    tasks, ask: feed.ask, requests: feed.requests, errors: feed.errors, running, changed, transcript,
    summary: feed.summary, results: feed.results.map(r => `${r.line} (${subagents}/agent-${r.id}.jsonl)`),
    stopped: feed.stopped.map(a => `${a}, output ${subagents}/agent-${a}.jsonl`),
  }), tasks)
  return { note, planPath, firstTask: planText ? openTasks(planText)[0]?.title : undefined }
}

/** The window that opens the fresh chat and its keep settings; undefined when none holds this folder. */
async function keepOf($: EngineInterface) {
  const home = homeOf(await discover($), norm(await $.session.cwd()))
  if (!home) return undefined
  const got = await fetchSoon($, `http://127.0.0.1:${home.port}/hub/keep`, withToken(home))
  if (!got?.ok) return undefined
  return { home, keep: JSON.parse(got.text) as { onFull?: string; freshBranch?: boolean } }
}

/**
 * The end of a main turn. Near full in fresh chat mode, the chat is first asked to reach a clean pause;
 * a later turn hands off once no subagent runs and the shells were asked to stop once, or at once past the hard limit.
 */
async function settle($: EngineInterface, answer: string) {
  const id = await $.session.id()
  if (feed.handedOff === id || (await handedOff($).catch(() => undefined))) return
  // Held: no wrap-up, shell or handoff prompt; the first settle after the resume does them.
  if (await holding($).catch(() => false)) return
  await restoreFeed($)
  const usage = await $.session.usage({ breakdown: 'summary' })
  // A reloaded mod missed session.start.
  feed.compactAt ??= usage.context.breakdown?.autoCompactThreshold
  const tokens = usage.context.tokens ?? 0
  const near = nearFull(tokens, feed.compactAt)
  await syncShells($, await transcriptOf($)).catch(() => undefined)
  if (!near && feed.pausing === undefined) await keepGoing($, answer)
  // undefined: no window answered, which says nothing about the mode.
  const kept = near ? await keepOf($) : undefined
  if (feed.pausing === undefined) {
    if (kept?.keep.onFull !== 'fresh') return
    feed.pausing = 0
    await saveFeed($).catch(() => undefined)
    await $.prompt.submit({ text: pausePrompt(liveShells()) })
    return
  }
  // Compact mode, or a compaction freed the context: the pause is off and new work may start.
  if (!near || (kept && kept.keep.onFull !== 'fresh')) {
    feed.pausing = undefined
    await saveFeed($).catch(() => undefined)
    return
  }
  // No answer from the window: hold the pause and look again next turn.
  if (!kept) return
  feed.summary = summaryOf(answer) ?? feed.summary
  const agents = (await liveAgents($)).length
  // Only shells left, which send no turn of their own (a dev server never ends): ask once, then go and list them.
  if (!agents && feed.shells.size && !feed.pausing && !hardFull(tokens, feed.compactAt)) {
    feed.pausing = 1
    await saveFeed($).catch(() => undefined)
    await $.prompt.submit({ text: `${OWN}stop these background shells with TaskStop now, then end your reply: ${liveShells().map(x => `${x.id} (${x.command})`).join(', ')}.` })
    return
  }
  await saveFeed($).catch(() => undefined)
  if (!agents || hardFull(tokens, feed.compactAt)) await maybeHandoff($)
}

// One handoff at a time: the hub's inbox and settle can both ask before the first has written its note.
let handingOff: Promise<void> | undefined
/** Writes the note and has this chat's window open the next one: from settle in fresh chat mode, or whenever the hub asks (force). */
// After a refused handoff, settles wait this long before writing another note; a forced one goes now.
const HANDOFF_RETRY_MS = 5 * 60_000
let handoffFailedAt: number | undefined
export const maybeHandoff = ($: EngineInterface, force = false) => (handingOff ??= handoff($, force).finally(() => { handingOff = undefined }))

async function handoff($: EngineInterface, force: boolean) {
  const id = await $.session.id()
  const cwd = norm(await $.session.cwd())
  // A reload forgets feed; the store still knows.
  const done = await handedOff($).catch(() => undefined)
  if (feed.handedOff === id || done) {
    // Asked again by hand: the window may have lost the first post or still be waiting on subagents.
    const kept = force && done ? await keepOf($) : undefined
    if (kept) await fetchSoon($, `http://127.0.0.1:${kept.home.port}/hub`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: kept.home.token, kind: 'handoff', sessionId: id, cwd, note: done, force: true }),
    })
    return
  }
  const kept = await keepOf($)
  if (!kept || (!force && kept.keep.onFull !== 'fresh')) return
  const { home, keep } = kept
  const now = await $.clock.now()
  if (!force && handoffFailedAt !== undefined && now - handoffFailedAt < HANDOFF_RETRY_MS) return
  feed.handedOff = id
  const { note, planPath, firstTask } = await readNote($)
  const home_ = norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  const iso = new Date(now).toISOString()
  const label = (planWords(planPath).slice(0, 3).join('-') || words(firstTask ?? '').slice(0, 3).join('-') || 'continued').slice(0, 40).replace(/-+$/, '')
  const base = cwd.split('/').pop() ?? ''
  const project = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  // A folder like '/', '..' or 'C:' gets a safe one, so the note stays one level under handoffs/.
  const dir = /^\.{0,2}$|:/.test(base) ? project || 'root' : base
  // Outside every repo, so a note is never committed. The hub matches a note by its -<id8>.md ending.
  const path = `${home_}/.claude/handoffs/${dir}/${[iso.slice(0, 10), iso.slice(11, 16).replace(':', ''), project, label, id.slice(0, 8)].filter(Boolean).join('-')}.md`
  await $.fs.write(path, note)
  const sent = await fetchSoon($, `http://127.0.0.1:${home.port}/hub`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: home.token, kind: 'handoff', sessionId: id, cwd, note: path, plan: planPath, task: firstTask, branch: keep.freshBranch ? branchFor(planPath, firstTask, new Date(now)) : undefined, ...(force ? { force: true } : {}) }),
  })
  // No successor opened: keep working, and the next settle or hub ask tries again.
  if (!sent?.ok) {
    feed.handedOff = undefined
    handoffFailedAt = now
    await $.ui.toast(`Handoff failed: the Switchboard window did not take it; the note is at ${path}`)
    return
  }
  handoffFailedAt = undefined
  await rememberHandoff($, id, path, now).catch(() => undefined)
  await $.ui.toast(`Context nearly full: a fresh chat continues from ${path}`)
}

async function afterTool($: EngineInterface, command: string, output: string) {
  const run = jevRun(command, output)
  const credits = creditsIn(output)
  if (run || credits !== undefined) await post($, { kind: 'jev', ...(run ?? { run: false }), creditsLeftUsd: credits, sessionId: await $.session.id(), cwd: norm(await $.session.cwd()) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await start($)
    feed.brief = (await askHome($, 'brief').catch(() => undefined)) || undefined
    await $.tool.register({
      name: ASK,
      description: "Ask Switchboard's brain about this project's other live chats: who is on what, which files they are editing, what to pick up next. One short paid Haiku call per question; it knows nothing outside this project.",
      inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    })
    await $.tool.register({
      name: RECALL,
      description: 'Search Switchboard memory, the knowledge graph of memory notes and the vault, before researching a topic. Answers the best matching notes and how they relate (supersedes, depends-on, part-of, contradicts, related). Free and local.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    })
    $.clock.every(POLL_MS, () => { void poll($); void holdTick($).catch(() => undefined) })
    return started
  })

  on('session.measure', async ($, e, next) => {
    measured = e.rateLimits
    void postLive($, e).catch(() => undefined)
    return next(e)
  })

  // Answers without next, so the generic hook's pause check below never sees it.
  on('tool.call', { tool: `mcp__usage-meter__${ASK}` }, async ($, e) => {
    const c = await readCompany($).catch(() => company)
    const held = (await heldNow($).catch(() => undefined)) ?? pausedDenial(String(e.tool), c.paused)
    if (held) return { deny: held }
    const q = (e as { question?: unknown }).question
    if (typeof q !== 'string' || !q.trim()) return { deny: 'Give a question.' }
    const answer = await askHome($, 'ask', q.slice(0, 500)).catch(() => undefined)
    return { result: answer ?? 'No Switchboard window holds this folder, so the brain cannot answer.' }
  })

  // No pause check: recall reads local files and spends nothing.
  on('tool.call', { tool: `mcp__usage-meter__${RECALL}` }, async ($, e) => {
    const q = (e as { query?: unknown }).query
    if (typeof q !== 'string' || !q.trim()) return { deny: 'Give a query.' }
    const answer = await askHome($, 'recall', q.slice(0, 500)).catch(() => undefined)
    return { result: answer ?? 'No Switchboard window holds this folder, so memory cannot be searched.' }
  })

  on('prompt.submit', async ($, e, next) => {
    shellsDone(e.text)
    await noteActive($)
    // Notifications and this mod's own wrap-up are no requests of Kenneth's.
    if (e.isMeta || e.command || e.origin?.kind === 'task-notification' || e.text.startsWith(OWN) || e.text.startsWith('<task-notification>')) return next(e)
    await restoreFeed($).catch(() => undefined)
    feed.nudge = undefined
    feed.stopped = []
    feed.prompt = redact(e.text).replace(/\s+/g, ' ').slice(0, 200)
    feed.ask = redact(e.text)
    feed.requests.push(feed.ask)
    const fresh = FRESH.exec(e.text)?.[1]
    if (fresh) { feed.freshNote = fresh; await carryGoal($, fresh).catch(() => undefined) }
    await saveFeed($).catch(() => undefined)
    const note = await handedOff($).catch(() => undefined)
    const told = note ? wrapUp(note) : fresh ? freshStart(fresh) : undefined
    return next(told ? { ...e, context: [...(e.context ?? []), told] } : e)
  })

  // The brief, read once at session start, goes last so the cached prompt before it stays whole.
  // Who to delegate to comes from ~/.claude/CLAUDE.md (kit/rules.md), not from here.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const c = await readCompany($).catch(() => company)
    const advanced = c.advanced[await cwdOf($)] === true ? [{ id: 'usage-meter:stages', text: stagesRule(await $.session.id()), scope: 'session' as const }] : []
    const sections = [...composed.sections, { id: 'usage-meter:asks', text: (await indefiniteAsk($)) ?? ASK_RULE, scope: 'session' as const }, ...advanced]
    return { sections: feed.brief ? [...sections, { id: 'usage-meter:brief', text: feed.brief, scope: 'session' as const }] : sections }
  })

  // Each role runs on its own model, within its daily budget; counts go to the hub.
  // A resumed agent is no new start, and its model is fixed.
  on('agent.spawn', async ($, e, next) => {
    if (e.resume) return next(e)
    const held = await heldBack($)
    if (held) return { deny: held }
    const role = e.subagentType
    const { budgets, smart } = await readCompany($)
    const { day, used } = await startsToday($)
    const denial = budgetDenial(role, used, budgets)
    if (denial) return { deny: denial }
    const base = await agentModel($, role).catch(() => undefined)
    const model = smart ? pickModel(base, role, e.prompt, await readLearn($), await cwdOf($)) : base
    const started = await next(model ? { ...e, model } : e)
    if (started.deny !== undefined) return started
    if (started.agentId) live.set(started.agentId, { role, brief: e.prompt, model: started.model, files: new Set() })
    // Read-modify-write, so parallel spawns can undercount. Switch to an atomic increment if the store gets one.
    const counted = { ...used, [role]: (used[role] ?? 0) + 1 }
    await $.store.set('starts', { day, used: counted })
    void (async () => post($, { kind: 'agent', sessionId: await $.session.id(), day, used: counted }))().catch(() => undefined)
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    await noteActive($)
    const c = await readCompany($).catch(() => company)
    const held = (await heldNow($).catch(() => undefined)) ?? pausedDenial(tool, c.paused)
    if (held) return { deny: held }
    const noAsk = await indefiniteDenial($, tool).catch(() => undefined)
    if (noAsk) return { deny: noAsk }
    if (tool === 'Bash' && (e as { run_in_background?: unknown }).run_in_background === true) {
      const held = await heldBack($)
      if (held) return { deny: held }
    }
    const file = (e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path
    notePlan(file)
    if (tool.startsWith('mcp__')) await count($, ownerOf(tool)).catch(() => undefined)
    await restoreFeed($).catch(() => undefined)
    const ran = await next(e)
    if (ran.deny === undefined) {
      // Only an edit that ran: a denied one would read as this chat editing a file it never wrote.
      if (EDITS.has(tool) && typeof file === 'string') feed.file = norm(file)
      const agentId = (e as { agentId?: string }).agentId
      if (EDITS.has(tool) && typeof file === 'string' && agentId) live.get(agentId)?.files.add(norm(file))
      noteTasks(tool, e as Record<string, unknown>, ran.result)
      noteShell(tool, e as Record<string, unknown>, ran.result, ran.text ?? '')
    }
    if (ran.isError && ran.text) feed.errors = [...feed.errors, errorEntry(tool, ran.text)].slice(-ERRORS_KEPT)
    if (KEPT_TOOLS.has(tool) || (tool === 'Bash' && (e as { run_in_background?: unknown }).run_in_background === true) || ran.isError) await saveFeed($).catch(() => undefined)
    const command = (e as { command?: unknown }).command
    if (tool === 'Bash' && typeof command === 'string' && command.includes('jev.py') && ran.deny === undefined) {
      await afterTool($, command, ran.text ?? '')
    }
    if (tool === 'mcp__openrouter__get-credits' && ran.deny === undefined) await afterTool($, '', ran.text ?? '')
    return ran
  })

  // Every compaction of the main chat keeps the handoff, whatever started it.
  on('session.compact', async ($, e, next) => {
    if (e.agentId) return next(e)
    const handoff = await readNote($).catch(() => undefined)
    if (!handoff) return next(e)
    return next({ ...e, instructions: [e.instructions, `${KEEP}\n\n${handoff.note}`].filter(Boolean).join('\n\n') })
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await noteActive($)
    if (e.agentId) {
      // A subagent's report, one line; its whole transcript stays on disk.
      const line = redact(e.answer.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 160)
      if (line) feed.results = [...feed.results.filter(r => r.id !== e.agentId), { id: e.agentId, line }].slice(-RESULTS_KEPT)
      if (company.smart) await endRun($, e.agentId, e.answer).catch(() => undefined)
    } else if (e.reason === 'answer') {
      lastAnswer = e.answer
      await checkFresh($).catch(() => undefined)
      await settle($, e.answer).catch(() => undefined)
    }
    return done
  })

  on('classic.Stop', async ($, e, next) => {
    const block = await indefiniteStop($, (e as { last_assistant_message?: string }).last_assistant_message ?? lastAnswer)
    return block ? { block } : next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await count($, e.pluginName ?? e.skill).catch(() => undefined)
    return next(e)
  })
}
