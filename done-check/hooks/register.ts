// Holds a chat from ending as done while its checks or task list say otherwise,
// and leaves a status file the hub reads to show Verified or Unverified.
import type { EngineInterface, Register } from 'claude-code'

type Task = { subject: string; status: string }
type Turn = { key: string; edited: boolean; lastEdit: number; lastCheck: number; checkFailed: boolean; asked: boolean }

const TAIL_BYTES = 512 * 1024
const MAX_BLOCKS = 2
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// ponytail: word match on the command, so `cat test.txt` counts as a check. Tighten if it lets real misses through.
const CHECK = /\b(test|tests|spec|vitest|jest|pytest|mocha|tsc|eslint|lint|typecheck|type-check|clippy|ruff|mypy|playwright|validate|build|vet)\b/
const CLAIM = /\b(done|fixed|works|working|complete[d]?|finished|all (tests |checks )?pass(ing|ed|es)?|passing|green|verified)\b/i
const LIMIT = /usage limit|hit your (usage |session )?limit|rate limit|limit reached|resets (at )?\d/i
const HANDOFF = /\bhand(ing|ed)? ?off\b|\bhandoff\b|next chat/i
const APPROVAL = /\b(approve|approval|sign off|look good|ok to ship|ready to commit)\b/i

/** The last turn from a transcript tail: from the last prompt Kenneth (or the lead) typed. */
export function lastTurn(tail: string): Turn {
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
  const checks = new Set<string>()
  rows.slice(start).forEach((r, i) => {
    const c = (r as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(c)) return
    for (const b of c) {
      if (b?.type === 'tool_use') {
        if (EDITS.has(b.name)) { t.edited = true; t.lastEdit = i }
        if (b.name === 'AskUserQuestion' || b.name === 'mcp__switchboard__ask') t.asked = true
        if (b.name === 'Bash' && CHECK.test(String(b.input?.command ?? ''))) { t.lastCheck = i; checks.add(b.id) }
      } else if (b?.type === 'tool_result' && checks.has(b.tool_use_id)) {
        t.checkFailed = b.is_error === true
      }
    }
  })
  return t
}

/** Whether to hold the stop, and what is missing either way. */
export function judge(t: Turn, last: string, tasks: Task[]) {
  const missing: string[] = []
  const open = tasks.filter(x => x.status !== 'completed' && x.status !== 'deleted')
  if (open.length) missing.push(`open tasks: ${open.map(x => x.subject).join('; ')}`)
  if (t.edited && t.lastEdit > t.lastCheck) missing.push('files were edited after the last test, lint or typecheck run')
  if (t.edited && t.lastCheck >= 0 && t.checkFailed && CLAIM.test(last)) missing.push('the message claims success but the last check failed')
  const question = /\?\s*$/.test(last.trim()) && !APPROVAL.test(last)
  const waiting = t.asked || question || LIMIT.test(last) || HANDOFF.test(last)
  return { block: t.edited && !waiting && missing.length > 0, verified: missing.length === 0, waiting, missing }
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
async function blockCount($: EngineInterface, turn: string, active: boolean, add: (n: number) => boolean): Promise<number> {
  const all = { ...(((await $.store.get('blocks').catch(() => undefined)) ?? mem) as Record<string, number>) }
  if (!active) delete all[turn]
  const n = typeof all[turn] === 'number' ? all[turn] : 0
  if (add(n)) all[turn] = n + 1
  else if (active) return n
  // ponytail: the 200 newest turns kept, by insertion.
  mem = Object.fromEntries(Object.entries(all).slice(-200))
  await $.store.set('blocks', mem).catch(() => undefined)
  return n
}

async function taskList($: EngineInterface, owner: string) {
  const all = ((await $.store.get('tasks').catch(() => undefined)) ?? {}) as Record<string, Array<[string, Task]>>
  return { all, mine: new Map(all[owner] ?? []) }
}

async function tail($: EngineInterface, path: string) {
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), path]).catch(() => undefined)
  if (r?.exitCode === 0) return r.stdout
  const text = String(await $.fs.read(path).catch(() => ''))
  return text.slice(-TAIL_BYTES)
}

async function onStop($: EngineInterface, e: { session_id: string; transcript_path: string; stop_hook_active: boolean; last_assistant_message?: string }, agent?: string) {
  const owner = agent ? `${e.session_id}:${agent}` : e.session_id
  const t = lastTurn(await tail($, e.transcript_path))
  const v = judge(t, e.last_assistant_message ?? '', [...(await taskList($, owner)).mine.values()])
  const turn = `${owner}:${t.key}`
  const n = await blockCount($, turn, e.stop_hook_active, n => v.block && n < MAX_BLOCKS)
  const block = v.block && n < MAX_BLOCKS
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const status = { session: e.session_id, agent, verified: v.verified, state: v.verified ? 'verified' : v.waiting ? 'waiting' : 'unverified', missing: v.missing, edited: t.edited, blocks: n + (block ? 1 : 0), at: Date.now() }
  await $.fs.write(`${home}/.claude/switchboard/done-check/${agent ? `${e.session_id}-${agent}` : e.session_id}.json`, JSON.stringify(status, null, 2)).catch(() => undefined)
  return block ? `done-check: not finished yet. ${v.missing.join('. ')}. Finish it and run the checks, or say what is blocking.` : undefined
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
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
