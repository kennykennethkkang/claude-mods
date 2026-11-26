// Usage feed for Switchboard: posts this chat's context, limits, token diet and Jev runs
// to every open Switchboard window, and carries back what was typed in any of them (a
// message, Remote Control, a compaction). Draws nothing in the terminal.
import type { EngineInterface, Register } from 'claude-code'
import { budgetDenial, pausedDenial, readCompany, startsToday } from './company'
import { askHome, count, ownerOf, poll, postLive, readNote, settle, start } from './feed'
import { ASK, ASK_RULE, EDITS, ERRORS_KEPT, FRESH, KEEP, KEPT_TOOLS, OWN, RECALL, RESULTS_KEPT, afterTool, checkFresh, errorEntry, freshStart, handedOff, handoff, heldBack, notePlan, noteTasks, restoreFeed, saveFeed, stagesRule, wrapUp } from './handoff'
import { POLL_MS, cwdOf, homeDir, norm, post } from './hub'
import { carryGoal, indefiniteAsk, indefiniteDenial, indefiniteStop } from './indefinite'
import { fiveHour, heldNow, holdTick, noteActive } from './limits'
import { LADDER, agentModel, alias, endRun, level, pickRun, pickable, readLearn, spawnModel } from './model'
import { redact } from './redact'
import { ROLE_OPTIONS, appendRows, classify, finalRow, pickRow, readSmart, smartPick } from './smart'
import { offerResearch } from './research'
import { noteShell, shellsDone } from './shells'
import { company, feed, held, live, runs, st } from './state'
import { codexDenial } from './codex-first'

const codexFirstSeen = new Set<string>()
const SLOW = 'Switchboard did not answer in time. Ask once more.'
export function timerWork(ticks: number, isHeld: boolean) {
  const quiet = ticks >= 30
  return { poll: !quiet || ticks % 3 === 0, hold: isHeld || !quiet || ticks % 5 === 0 }
}

type SmartModel = { task: string; pick: string; why: string; model?: string }

/** Smart select for a spawn: the model pick with its reason, moved by smart-learned.json under the same rule as the picker. An explicit model stays. */
async function smartModel($: EngineInterface, e: { prompt: string; model?: string }, role: string, base: string | undefined, chosen: string | undefined, smart: boolean): Promise<SmartModel | undefined> {
  const task = classify(e.prompt)
  if (e.model) return { task, pick: alias(e.model), why: 'set by the Agent call' }
  const now = chosen ?? base
  if (!now) return undefined
  if (!smart || !base || level(base) < 0 || !pickable(role)) return { task, pick: alias(now), why: 'model from the agent file' }
  const why = pickRun({ text: e.prompt, role, ai: 'claude', base }).reason
  const p = smartPick('model', task, alias(now), why, LADDER, await readSmart($))
  return { task, pick: p.pick, why: p.why, model: p.pick !== alias(now) ? p.pick : undefined }
}

/** Role and model rows for a started spawn; a model the platform swapped in is the model's final. Returns the model row's key. */
async function logSpawn($: EngineInterface, brief: string, role: string, sm: SmartModel | undefined, got: string | undefined) {
  if (!sm) return undefined
  const at = await $.clock.now()
  const session = await $.session.id()
  const cwd = await cwdOf($)
  const rows = [
    pickRow({ at, session, cwd, kind: 'role', task: sm.task, pick: role, why: `${role} for a ${sm.task} task`, options: ROLE_OPTIONS }),
    pickRow({ at, session, cwd, kind: 'model', task: sm.task, pick: sm.pick, why: sm.why, options: LADDER }),
  ]
  const key = String(rows[1].key)
  if (got && level(got) >= 0 && alias(got) !== sm.pick) rows.push(finalRow({ at, session, kind: 'model', key, final: alias(got) }))
  await appendRows($, rows)
  return key
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    st.quietTicks = 0
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
      description: 'Search Switchboard memory, the knowledge graph of memory notes and the vault, before researching a topic. Answers the best matching notes and how they relate (supersedes, depends-on, part-of, contradicts, related). Free and local. Scope research searches the research notes only.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['all', 'research'] } }, required: ['query'] },
    })
    $.clock.every(POLL_MS, () => {
      const work = timerWork(++st.quietTicks, Boolean(held.hold))
      if (work.poll) void poll($).then(delivered => { if (delivered) st.quietTicks = 0 }).catch(() => undefined)
      if (work.hold) void holdTick($).catch(() => undefined)
    })
    return started
  })

  on('session.measure', async ($, e, next) => {
    st.measured = e.rateLimits
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
    return { result: answer ?? (answer === null ? SLOW : 'No Switchboard window holds this folder, so the brain cannot answer.') }
  })

  // No pause check: recall reads local files and spends nothing.
  on('tool.call', { tool: `mcp__usage-meter__${RECALL}` }, async ($, e) => {
    const q = (e as { query?: unknown }).query
    if (typeof q !== 'string' || !q.trim()) return { deny: 'Give a query.' }
    const scope = (e as { scope?: unknown }).scope
    const answer = await askHome($, 'recall', q.slice(0, 500), scope === 'all' || scope === 'research' ? scope : undefined).catch(() => undefined)
    return { result: answer ?? (answer === null ? SLOW : 'No Switchboard window is open, so memory cannot be searched.') }
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
    if (feed.requests.length === 1) void offerResearch($, e.text).catch(() => undefined)
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
    st.quietTicks = 0
    if (e.resume) return next(e)
    const held = await heldBack($)
    if (held) return { deny: held }
    const role = e.subagentType
    const { budgets, smart, windows } = await readCompany($)
    const { day, used } = await startsToday($)
    const denial = budgetDenial(role, used, budgets)
    if (denial) return { deny: denial }
    if (role === 'engineer' || role === 'qa') {
      const home = await homeDir($)
      const roleFile = await $.fs.read(`${home}/.claude/agents/${role}-codex.md`).then(() => true, () => false)
      const codex = codexDenial({ role, prompt: e.prompt, session: await $.session.id(), enabled: company.codexFirst, roleFile, codex: company.codexWindows, claude: windows, now: await $.clock.now(), seen: codexFirstSeen })
      if (codex) return { deny: codex }
    }
    const base = await agentModel($, role).catch(() => undefined)
    // A model the Agent call set is an explicit pick: kept, never gated.
    const chosen = e.model ? undefined : smart ? spawnModel(base, role, e.prompt, await readLearn($), await cwdOf($), fiveHour(windows, await $.clock.now()), runs) : base
    const sm = await smartModel($, e, role, base, chosen, smart).catch(() => undefined)
    const model = sm?.model ?? chosen
    const started = await next(model ? { ...e, model } : e)
    if (started.deny !== undefined) return started
    const smartKey = await logSpawn($, e.prompt, role, sm, started.model).catch(() => undefined)
    if (started.agentId) live.set(started.agentId, { role, brief: e.prompt, model: started.model, files: new Set(), smartKey })
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
      st.lastAnswer = e.answer
      await checkFresh($).catch(() => undefined)
      await settle($, e.answer).catch(() => undefined)
    }
    return done
  })

  on('classic.Stop', async ($, e, next) => {
    const block = await indefiniteStop($, (e as { last_assistant_message?: string }).last_assistant_message ?? st.lastAnswer)
    return block ? { block } : next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await count($, e.pluginName ?? e.skill).catch(() => undefined)
    return next(e)
  })
}
