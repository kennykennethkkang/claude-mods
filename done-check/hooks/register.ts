// Holds a chat from ending as done while its checks or task list say otherwise,
// and leaves a status file the hub reads to show Verified or Unverified.
import type { EngineInterface, Register } from 'claude-code'

type Task = { subject: string; status: string }
type Turn = { key: string; edited: boolean; lastEdit: number; lastCheck: number; checkFailed: boolean; asked: boolean; held?: boolean; bg?: boolean }

const TAIL_BYTES = 512 * 1024
export const MAX_BLOCKS = 2
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// A hook refusal: the engine wrapper, or a mod's own prefix.
const DENIED = /^(<tool_use_error>\s*)?(repo-rules|bash-approve|paid-guard|usage-meter|chat-wait|tab-close|phone-mode|done-check|git-guard|account-guard):/
const OUTSIDE = /(^|\/)\.switchboard\//
const FINISH = 'run the aar skill, print the standup (done, for you, left, risks), then ask "Approve this chat as finished?"'

// Windows paths: forward slashes, drive letter as a lowercase first segment.
const slashes = (p: string) => p.replace(/\\/g, '/')
export const isAbsolute = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p.replace(/\\/g, '/'))
export const shellFor = (command: string, windows: boolean) => windows ? ['cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-c', command]

/** Whether cwd is ~/Documents/Research or inside it: those chats end on a finding, so no check or finish steps are asked of them. */
export function inResearch(cwd: string, home: string): boolean {
  if (!cwd || !home) return false
  const root = `${slashes(home).replace(/\/+$/, '')}/documents/research`.toLowerCase()
  const c = slashes(cwd).replace(/\/+$/, '').toLowerCase()
  return c === root || c.startsWith(`${root}/`)
}

/** Normalised absolute path, or undefined when it has a shell variable or no cwd to resolve against. */
function resolvePath(raw: string, cwd: string): string | undefined {
  let p = slashes(raw.replace(/^["']|["']$/g, ''))
  const home = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HOME ?? ''
  const tmp = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TMPDIR || '/tmp'
  p = p.replace(/^(\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/, tmp.replace(/\/+$/, ''))
  if (/^(~|\$HOME|\$\{HOME\})(\/|$)/.test(p)) p = p.replace(/^(~|\$HOME|\$\{HOME\})/, home || '/~')
  if (p.includes('$') || p.includes('`')) return undefined
  if (!isAbsolute(p)) { if (!cwd) return p; p = `${cwd}/${p}` }
  const out: string[] = []
  for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg) }
  return /^[a-z]:$/i.test(out[0] ?? '') ? `${out.shift()}/${out.join('/')}` : `/${out.join('/')}`
}

/** Whether a write to this path is repo work: inside the cwd, not under .switchboard. Unresolvable counts. */
export function repoPath(raw: string, cwd: string): boolean {
  if (!raw || raw === '/dev/null') return false
  raw = slashes(raw)
  if (OUTSIDE.test(raw)) return false
  const p = resolvePath(raw, slashes(cwd))
  if (p === undefined) return true
  if (OUTSIDE.test(p)) return false
  const base = slashes(cwd).replace(/\/+$/, '')
  const win = /^[a-z]:\//i.test(base)
  const target = win ? p.toLowerCase() : p, root = win ? base.toLowerCase() : base
  return !root || target === root || target.startsWith(`${root}/`)
}

// argv[1] of `node -e code a b` and `python3 -c code a b` is a; unknown when the line has no such args.
function trailingArgs(cmd: string): string[] {
  const w = [...cmd.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([;|&]+)|([^\s;|&'"]+)/g)].map(m => m[3] ? ';' : (m[1] ?? m[2] ?? m[4]))
  const i = w.findIndex((x, j) => /^(-e|--eval|-p|--print|-c)$/.test(x) && /(^|\/)(node|python3?)$/.test(w[j - 1] ?? ''))
  if (i < 0) return []
  const end = w.indexOf(';', i + 2)
  return w.slice(i + 2, end < 0 ? undefined : end)
}

/** Targets of a shell command that writes files; an empty string marks a write whose target is unknown. */
export function bashWrites(cmd: string): string[] {
  const t: string[] = []
  const whole = cmd
  // Heredoc bodies and quoted strings hold text, not redirects; a quoted redirect target survives.
  cmd = cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '$3')
    .replace(/(>>?[ \t]*)?("[^"]*"|'[^']*')/g, (m, pre) => pre ? m : '""')
  for (const m of cmd.matchAll(/(?:^|[^\d&>=<-])(?:\d?>>?|&>>?)[ \t]*(?!&)(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))/g)) t.push(m[1] ?? m[2] ?? m[3] ?? '')
  for (const m of cmd.matchAll(/\btee\s+(?:-\w+\s+)*([^\s;|&]+)/g)) t.push(m[1])
  for (const m of whole.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/gm)) t.push(m[1].trim())
  if (/\bapply_patch\b/.test(whole) && !/^\*\*\* \w+ File:/m.test(whole)) t.push('')
  // Interpreter one-liners and heredocs: each write call gives its literal target, else unknown (counts).
  if (/\b(python3?|node)\b/.test(whole)) {
    const Q = `(?:"([^"]*)"|'([^']*)'|(?:process|sys)\\.argv\\[(\\d+)\\])`
    const args = trailingArgs(whole)
    const calls = [
      `\\bopen\\(\\s*${Q}?[^,)]*,\\s*(?:mode\\s*=\\s*)?['"][rwxab+]*[wxa+][rwxab+]*['"]`,
      `(?:\\bPath\\(\\s*${Q}\\s*\\))?\\.write_(?:text|bytes)\\(`,
      `\\bshutil\\.(?:copy\\w*|move)\\(\\s*[^,)]*(?:,\\s*${Q})?`,
      `\\b(?:writeFile|appendFile)(?:Sync)?\\(\\s*${Q}?`,
      `\\bcreateWriteStream\\(\\s*${Q}?`,
    ]
    for (const re of calls) for (const m of whole.matchAll(new RegExp(re, 'g'))) t.push(m[1] || m[2] || (m[3] ? args[Number(m[3]) - 1] : '') || '')
  }
  for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
    const w = seg.trim().split(/\s+/)
    const i = w.findIndex(x => /^(cp|mv|sed|perl)$/.test(x))
    if (i < 0) continue
    const inplace = /^(sed|perl)$/.test(w[i]) ? w.slice(i + 1).some(x => /^-[a-zA-Z]*i/.test(x) || x.startsWith('--in-place')) : true
    if (inplace && w.length > i + 2) t.push(w[w.length - 1])
  }
  return t.filter(x => x !== '/dev/null')
}

const isEdit = (name: string, input: Record<string, unknown> | undefined, cwd: string) => {
  if (EDITS.has(name)) return repoPath(String(input?.file_path ?? input?.notebook_path ?? input?.path ?? ''), cwd) || !(input?.file_path ?? input?.notebook_path ?? input?.path)
  if (name === 'Bash') return bashWrites(String(input?.command ?? '')).some(x => x === '' || repoPath(x, cwd))
  return false
}
// ponytail: word match on the command, so `cat test.txt` counts as a check. Tighten if it lets real misses through.
const CHECK = /\b(test|tests|spec|vitest|jest|pytest|mocha|tsc|eslint|lint|typecheck|type-check|clippy|ruff|mypy|playwright|validate|build|vet)\b/
const CLAIM = /\b(done|fixed|works|working|complete[d]?|finished|all (tests |checks )?pass(ing|ed|es)?|passing|green|verified)\b/i
const LIMIT = /usage limit|hit your (usage |session )?limit|rate limit|limit reached|resets (at )?\d/i
// usage-meter's denial while it holds a chat (holdDenial).
const HELD = 'Paused by usage-meter'
const HANDOFF = /\bhand(ing|ed)? ?off\b|\bhandoff\b|next chat/i
const APPROVAL = /\b(approve|approval|sign off|look good|ok to ship|ready to commit)\b/i
const CLOSING = 'Approve this chat as finished'
const EM = String.fromCharCode(0x2014)
const TRAILER = /^\s*(co-authored-by:|(\p{Extended_Pictographic}\s*)?generated with \[?claude code)/imu

/** The reply rules a hook can read off the lead's last message. */
export const replyTell = (last: string) => last.includes(EM) ? 'The reply has an em dash: use a comma, a colon, or "to", and send it again.'
  : TRAILER.test(last) ? 'The commit message has an attribution trailer (Co-Authored-By or Generated with): drop it and send it again.' : undefined

/** The last turn from a transcript tail: from the last prompt Kenneth (or the lead) typed. */
export function lastTurn(tail: string, cwd = ''): Turn {
  const rows: unknown[] = []
  for (const l of tail.split('\n')) {
    try { rows.push(JSON.parse(l)) } catch { /* the cut first line, or a line mid-write */ }
  }
  let start = 0
  let key = ''
  rows.forEach((r, i) => {
    const o = r as { type?: string; isMeta?: boolean; uuid?: string; message?: { content?: unknown } }
    if (o.type !== 'user' || o.isMeta) return
    const c = o.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => String(b.text)).join('\n') : ''
    // A Stop block comes back as a user row; it continues the turn, it does not start one.
    if (!text || /Stop hook feedback|done-check:/.test(text)) return
    start = i
    key = o.uuid ?? String(i)
  })
  const t: Turn = { key, edited: false, lastEdit: -1, lastCheck: -1, checkFailed: false, asked: false }
  const checks = new Map<string, number>()
  const denied = new Set<string>()
  const pendingEdits = new Map<string, number>()
  const turnRows = rows.slice(start)
  // A row's own cwd stands in when the caller has none.
  if (!cwd) cwd = String((turnRows.find(r => (r as { cwd?: unknown }).cwd) as { cwd?: string } | undefined)?.cwd ?? '')
  turnRows.forEach((r, i) => {
    const c = (r as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(c)) return
    for (const b of c) {
      if (b?.type === 'tool_use') {
        if (isEdit(b.name, b.input, cwd)) pendingEdits.set(b.id, i)
        if ((b.name === 'Agent' || b.name === 'Task') && b.input?.run_in_background === true) t.bg = true
        if (b.name === 'AskUserQuestion' || b.name === 'mcp__switchboard__ask') t.asked = true
        if (b.name === 'Bash' && CHECK.test(String(b.input?.command ?? ''))) checks.set(b.id, i)
      } else if (b?.type === 'tool_result') {
        // Only a denied call that opens with the denial: a grep or diff can show the same text.
        const said = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? String(b.content.find((x: { type?: string }) => x?.type === 'text')?.text ?? '') : ''
        // Code Mode leaves an inner call's result block empty; the launch sits in toolUseResult.
        if (/Async agent launched/.test(said) || (r as { toolUseResult?: { status?: unknown } }).toolUseResult?.status === 'async_launched') t.bg = true
        const refused = b.is_error === true && DENIED.test(said.trimStart())
        if (refused) denied.add(b.tool_use_id)
        else if (checks.has(b.tool_use_id)) t.checkFailed = b.is_error === true
        // The engine wraps a hook deny in <tool_use_error>.
        if (b.is_error === true && said.trimStart().replace(/^<tool_use_error>\s*/, '').startsWith(HELD)) t.held = true
      }
    }
  })
  for (const [id, i] of pendingEdits) if (!denied.has(id)) { t.edited = true; t.lastEdit = Math.max(t.lastEdit, i) }
  for (const [id, i] of checks) if (!denied.has(id)) t.lastCheck = Math.max(t.lastCheck, i)
  return t
}

/** Whether to hold the stop, and what is missing either way. */
export function judge(t: Turn, last: string, tasks: Task[], main = true, research = false) {
  const missing: string[] = []
  const open = tasks.filter(x => x.status !== 'completed' && x.status !== 'deleted')
  if (open.length) missing.push(`open tasks: ${open.map(x => x.subject).join('; ')}`)
  if (!research && t.edited && t.lastEdit > t.lastCheck) missing.push('files were edited after the last test, lint or typecheck run')
  if (t.edited && t.lastCheck >= 0 && t.checkFailed && CLAIM.test(last)) missing.push('the message claims success but the last check failed')
  const question = /\?\s*$/.test(last.trim()) && !APPROVAL.test(last)
  // No ask tool in the session (it never loads): the closing question asked as text counts.
  // ponytail: the tool list sits outside the tail, so text alone counts; check it if chats start skipping the tool.
  const waiting = t.asked || last.includes(CLOSING) || t.bg === true || t.held === true || question || LIMIT.test(last) || HANDOFF.test(last)
  // Edited, checked, but never asked the closing question: hold once for the finish steps.
  const unclosed = main && !research && t.edited && !waiting && missing.length === 0
  const base = missing.length ? `${missing.join('. ')}. Finish it and run the checks, or say what is blocking.` : `${FINISH}.`
  const held = t.edited && !waiting && (missing.length > 0 || unclosed)
  const tell = main ? replyTell(last) : undefined
  const reason = held ? `${base}${tell ? ` ${tell}` : ''}` : tell ?? base
  return { block: held || Boolean(tell), verified: missing.length === 0, waiting, missing, reason }
}

/** Keeps a task list current from its own tool calls; TodoWrite replaces it whole. */
export function noteTask(tasks: Map<string, Task>, tool: string, e: Record<string, unknown>, result: unknown) {
  if (tool === 'TodoWrite' && Array.isArray(e.todos)) {
    tasks.clear()
    ;(e.todos as Array<{ content: string; status: string }>).forEach((t, i) => tasks.set(`todo-${i}`, { subject: t.content, status: t.status }))
  } else if (tool === 'TaskCreate') {
    const t = (result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (t?.id) tasks.set(t.id, { subject: t.subject ?? String(e.subject), status: 'pending' })
  } else if (tool === 'TaskUpdate' && typeof e.taskId === 'string') {
    const t = tasks.get(e.taskId)
    if (!t) return
    if (e.status === 'deleted') tasks.delete(e.taskId)
    else tasks.set(e.taskId, { subject: typeof e.subject === 'string' ? e.subject : t.subject, status: typeof e.status === 'string' ? e.status : t.status })
  }
}

const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
// Per turn, in $.store: a fresh process (a reload mid-turn) must still stop at MAX_BLOCKS. mem covers a store that fails.
let mem: Record<string, number> = {}
async function blockCount($: EngineInterface, turn: string, add: (n: number) => boolean): Promise<number> {
  const all = { ...(((await $.store.get('blocks').catch(() => undefined)) ?? mem) as Record<string, number>) }
  const n = typeof all[turn] === 'number' ? all[turn] : 0
  if (add(n)) all[turn] = n + 1
  else return n
  // ponytail: the 200 newest turns kept, by insertion.
  mem = Object.fromEntries(Object.entries(all).slice(-200))
  await $.store.set('blocks', mem).catch(() => undefined)
  return n
}

async function taskList($: EngineInterface, owner: string) {
  const all = ((await $.store.get('tasks').catch(() => undefined)) ?? {}) as Record<string, Array<[string, Task]>>
  return { all, mine: new Map(all[owner] ?? []) }
}

async function goalCheck($: EngineInterface, cwd: string, edit: string): Promise<{ command: string; output: string } | undefined> {
  const id = await $.session.id()
  const cacheKey = `goal-check-passed:${id}`
  if (await $.store.get(cacheKey).catch(() => undefined) === edit) return
  const root = await Promise.resolve().then(() => $.session.root()).catch(() => cwd)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  let indefinite: Record<string, unknown> = {}
  try { indefinite = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/indefinite.json`))) ?? {} } catch { /* missing switch means off */ }
  if (Object.hasOwn(indefinite, id)) return
  const goal = await $.fs.read(`${root}/.switchboard/goals/${id}.md`).then(String, () => undefined)
  const command = goal?.match(/^Check: `([^`\n]+)`/m)?.[1].trim()
  if (!command) return
  try {
    const r = await $.process.run(shellFor(command, (await $.env.get('OS')) === 'Windows_NT'), { cwd: root, timeoutMs: 600_000 })
    if (r.exitCode === 0) {
      await $.store.set(cacheKey, edit).catch(() => undefined)
      return
    }
    return { command, output: `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-20).join('\n') }
  } catch (err) {
    return { command, output: `check did not finish: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function tail($: EngineInterface, path: string) {
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), path]).catch(() => undefined)
  if (r?.exitCode === 0) return r.stdout
  const text = String(await $.fs.read(path).catch(() => ''))
  return text.slice(-TAIL_BYTES)
}

type Status = { session: string; agent?: string; verified: boolean; state: string; missing: string[]; edited: boolean; blocks: number; at: number }
async function verdict($: EngineInterface, transcript: string, owner: string, last: string, cwd = '', main = true) {
  const t = lastTurn(await tail($, transcript), cwd)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return { t, v: judge(t, last, [...(await taskList($, owner)).mine.values()], main, inResearch(cwd, home)) }
}

async function writeStatus($: EngineInterface, s: Status) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  await $.fs.write(`${home}/.claude/switchboard/done-check/${s.agent ? `${s.session}-${s.agent}` : s.session}.json`, JSON.stringify(s, null, 2)).catch(() => undefined)
}

async function onStop($: EngineInterface, e: { session_id: string; cwd?: string; transcript_path: string; stop_hook_active: boolean; last_assistant_message?: string }, agent?: string) {
  const owner = agent ? `${e.session_id}:${agent}` : e.session_id
  const { t, v } = await verdict($, e.transcript_path, owner, e.last_assistant_message ?? '', e.cwd, !agent)
  const failedGoal = agent || !t.edited
    ? undefined
    : await goalCheck($, e.cwd ?? '', `${t.key}:${t.lastEdit}`).catch(() => undefined)
  const turn = `${owner}:${t.key}`
  const shouldBlock = v.block || Boolean(failedGoal)
  const n = await blockCount($, turn, n => shouldBlock && n < MAX_BLOCKS)
  const block = shouldBlock && n < MAX_BLOCKS
  const missing = failedGoal ? [...v.missing, `goal Check failed: ${failedGoal.command}`] : v.missing
  await writeStatus($, { session: e.session_id, agent, verified: v.verified && !failedGoal, state: failedGoal ? 'unverified' : v.verified ? 'verified' : v.waiting ? 'waiting' : 'unverified', missing, edited: t.edited, blocks: n + (block ? 1 : 0), at: Date.now() })
  const reason = failedGoal ? `goal Check failed: ${failedGoal.command}. Last output:\n${failedGoal.output}` : v.reason
  return block ? `done-check: not finished yet. ${reason}` : undefined
}

const closing = (e: Record<string, unknown>) => e.tool === 'AskUserQuestion' && !e.agentId
  && Array.isArray(e.questions) && e.questions.some(q => String((q as { question?: unknown })?.question ?? '').includes(CLOSING))

// tool.call carries no transcript_path; Claude Code's layout, as usage-meter's transcriptOf.
async function transcriptOf($: EngineInterface) {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const home = norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  const root = norm(await Promise.resolve().then(() => $.session.root()).catch(() => $.session.cwd()))
  return `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${await $.session.id()}.jsonl`
}

// The closing question blocks until Kenneth answers, so stamp first. Its own call set t.asked; the state ignores it.
async function stampClosing($: EngineInterface) {
  const sid = await $.session.id()
  const { t, v } = await verdict($, await transcriptOf($), sid, '', await Promise.resolve().then(() => $.session.cwd()).catch(() => ''))
  // No prompt found means the derived path missed; an empty turn would read as Verified.
  if (!t.key) return
  await writeStatus($, { session: sid, verified: v.verified, state: v.verified ? 'verified' : 'unverified', missing: v.missing, edited: t.edited, blocks: 0, at: Date.now() })
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (closing(e as Record<string, unknown>)) await stampClosing($).catch(() => undefined)
    const ran = await next(e)
    if (!TASK_TOOLS.has(e.tool) || ran.deny !== undefined) return ran
    const sid = await $.session.id()
    const agent = (e as { agentId?: string }).agentId
    const owner = agent ? `${sid}:${agent}` : sid
    const { all, mine } = await taskList($, owner)
    noteTask(mine, e.tool, e as Record<string, unknown>, ran.result)
    // ponytail: every owner's list kept forever-ish; trim to 200 owners, by insertion.
    const kept = Object.entries({ ...all, [owner]: [...mine] }).slice(-200)
    await $.store.set('tasks', Object.fromEntries(kept)).catch(() => undefined)
    return ran
  })

  on('classic.Stop', async ($, e, next) => {
    const reason = await onStop($, e)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const reason = await onStop($, { ...e, transcript_path: e.agent_transcript_path || e.transcript_path }, e.agent_id)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))
}
