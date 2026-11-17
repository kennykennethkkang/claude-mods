import type { EngineInterface } from 'claude-code'
import { creditsIn, jevRun, keepOf, readNote, settle, start } from './feed'
import { decisions } from './handoff-note'
import type { Summary, Task } from './handoff-note'
import { branchFor, planWords, words } from './branch-name'
import { fetchSoon, norm, post } from './hub'
import { indefiniteOn } from './indefinite'
import { holding } from './limits'
import { level } from './model'
import { redact } from './redact'
import { liveShells } from './shells'
import { feed, runs, st } from './state'

// Past 90% of the compaction point, a turn's end is the last clean break before it compacts.
export const nearFull = (tokens: number, compactAt?: number) => !!compactAt && tokens >= compactAt * 0.9
// Past this the wrap-up has run long: hand off with whatever still runs listed.
export const hardFull = (tokens: number, compactAt?: number) => !!compactAt && tokens >= compactAt * 0.97
export const KEEP = 'Keep the handoff below in the summary word for word: it is the plan, the open tasks, the latest decisions and the branch of the work in progress. Never copy keys, tokens or passwords into the summary.'
export type Shell = { id: string; command: string; output?: string }
export type Result = { id: string; line: string }
// What the feed remembers between hooks; the chat's own part is saved to the store (saveFeed) so a reload keeps it.
export type Kept = { tasks?: Array<[string, Task]>; ask?: string; requests?: string[]; errors?: string[]; shells?: Shell[]; results?: Result[]; stopped?: string[]; summary?: Summary; pausing?: number; at: number }
export const FEEDS_KEPT = 20
export const REQUESTS_KEPT = 10
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
export async function saveFeed($: EngineInterface) {
  const id = await $.session.id()
  const all = ((await $.store.get('feeds')) ?? {}) as Record<string, Kept>
  const mine: Kept = {
    tasks: [...feed.tasks], ask: feed.ask, requests: feed.requests.slice(-REQUESTS_KEPT), errors: feed.errors,
    shells: [...feed.shells.values()], results: feed.results, stopped: feed.stopped, summary: feed.summary, pausing: feed.pausing, at: await $.clock.now(),
  }
  await $.store.set('feeds', Object.fromEntries(Object.entries({ ...all, [id]: mine }).sort((a, b) => b[1].at - a[1].at).slice(0, FEEDS_KEPT)))
}
// After the handoff: running work finishes here, new work starts in the next chat.

export const handoffDenial = (note?: string) => `Context is nearly full: no new tasks here. Running tasks finish, then this work continues in the next chat. ${note ? `Add new tasks to the handoff note instead (${note}).` : 'Add new tasks to the task list instead; they move to the next chat.'}`
/** The denial for new work once this chat wraps up or has handed off. */
export async function heldBack($: EngineInterface) {
  const note = await handedOff($).catch(() => undefined)
  if (note) return handoffDenial(note)
  await restoreFeed($).catch(() => undefined)
  return feed.pausing !== undefined ? handoffDenial() : undefined
}
export const freshStart = (note: string) => `Read ${note} fully before acting. Recreate each open task in it with the task tools first; in your first reply, restate the goal and tick each open task against the note, then carry on.`
// The hub's first prompt for a fresh chat names its note.
export const FRESH = /^Continue from (.+?\.md): read it first/
export const ERRORS_KEPT = 3
export const ERROR_MAX = 500
export const errorEntry = (tool: string, text: string) => `${tool}: ${redact(text).slice(0, ERROR_MAX)}${text.length > ERROR_MAX ? ' (truncated, see transcript)' : ''}`
// This mod's own prompts start so; they are no requests of Kenneth's.
export const OWN = 'Switchboard: '
export const PAUSE_MARK = `${OWN}context is nearly full`
export const pausePrompt = (shells: Shell[]) => [
  `${PAUSE_MARK} and a fresh chat takes over after a clean pause. Finish the step you are on and start no new tasks or subagents.`,
  'SendMessage each running subagent to stop new edits, leave its files type-clean and report done vs not done; wait for the reports, and TaskStop only one that does not answer.',
  shells.length ? `Stop these background shells with TaskStop before you end: ${shells.map(x => `${x.id} (${x.command})`).join(', ')}.` : 'Stop any background shell you started with TaskStop before you end.',
  'Update the task list so every open task has its real status; mark one completed only if a check proved it.',
  'Then end your reply with these lines and nothing after them:',
  'Goal: <the goal in one line>', 'Tests: <last test command and its result, or not run>', 'Decisions:', '- <pick>: <why>', 'Next: <the next action>',
].join('\n')
export const stagesRule = (id: string) => `Advanced mode is on for this project: for a multi-step task, follow the \`stages\` skill and keep each step in its stage folder under .switchboard/stages/; this chat's id is ${id}.`
export const ASK_RULE = 'When you need Kenneth to answer or act, ask with the AskUserQuestion tool so it pops up in the terminal and Switchboard. Never end a turn with open tasks you can do yourself.'
// Same rule as Switchboard's progress.ts askedQuestion: the last paragraph, past a trailing fenced block, ends in '?'.
// Both test suites hold the same table of cases (switchboard extension/test/progress.test.ts).
export const endsAsking = (text: string) => (text.replace(/\n*```[^\n]*\n(?:(?!```)[\s\S])*```\s*$/, '').trim().split(/\n\s*\n/).pop() ?? '').trim().endsWith('?')
// Nudges per chat that keeps stopping without touching its tasks; after that it waits for Kenneth.
export const NUDGES = 3
// The main chat's last answer, so a later compaction does not push past a question; a reload forgets it.
/** A turn that ended with open tasks and nothing running is asked to carry on, unless it asked Kenneth something or wrapped up. */
export async function keepGoing($: EngineInterface, answer: string) {
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
export const wrapUp = (note: string) => `Context is nearly full and a fresh chat takes over. Start no new tasks or subagents. Wait for running tasks to finish, then append to ${note}: open tasks, decisions, dead ends (one line each with why), results of finished tasks and next steps. Then stop.`
export type Handoffs = Record<string, { note: string; at: number }>
export const HANDOFFS_KEPT = 20
/** The note this session handed off to, kept in the store so a reload still holds new work. */
export async function handedOff($: EngineInterface): Promise<string | undefined> {
  const id = await $.session.id()
  return ((await $.store.get('handoffs')) as Handoffs | undefined)?.[id]?.note
}
export async function rememberHandoff($: EngineInterface, id: string, note: string, at: number) {
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
export const LIVE = new Set(['pending', 'running', 'waiting'])
export const KEPT_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskStop', 'KillShell'])
export const RESULTS_KEPT = 8
/** Once, after the fresh chat's first turn: the note's open tasks it has not recreated, by subject. */
export async function checkFresh($: EngineInterface) {
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
export function liveAgents($: EngineInterface) { return Promise.resolve().then(() => $.agent.list()).then(list => list.filter(a => LIVE.has(a.status))).catch(() => []) }
/** Subagents and shells still at work, each with where its output is, and the working tree's changes; either may be out of reach (a test, no git). */
export async function whatIsLive($: EngineInterface, cwd: string, subagents: string) {
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
export const ASK = 'hub_ask'
export const RECALL = 'hub_recall'
export const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])
export const HANDOFF_RETRY_MS = 5 * 60_000
export function maybeHandoff($: EngineInterface, force = false) { return (st.handingOff ??= handoff($, force).finally(() => { st.handingOff = undefined })) }
export async function handoff($: EngineInterface, force: boolean) {
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
  if (!force && st.handoffFailedAt !== undefined && now - st.handoffFailedAt < HANDOFF_RETRY_MS) return
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
    st.handoffFailedAt = now
    await $.ui.toast(`Handoff failed: the Switchboard window did not take it; the note is at ${path}`)
    return
  }
  st.handoffFailedAt = undefined
  await rememberHandoff($, id, path, now).catch(() => undefined)
  await $.ui.toast(`Context nearly full: a fresh chat continues from ${path}`)
}
export async function afterTool($: EngineInterface, command: string, output: string) {
  const run = jevRun(command, output)
  const credits = creditsIn(output)
  if (run || credits !== undefined) await post($, { kind: 'jev', ...(run ?? { run: false }), creditsLeftUsd: credits, sessionId: await $.session.id(), cwd: norm(await $.session.cwd()) })
}
