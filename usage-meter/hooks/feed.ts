import type { EngineInterface, SessionContextBreakdown, SessionUsage } from 'claude-code'
import { OWN, handedOff, handoff, hardFull, keepGoing, liveAgents, maybeHandoff, nearFull, pausePrompt, restoreFeed, saveFeed, whatIsLive } from './handoff'
import { ensureOpenTasks, handoffNote, openTasks, summaryOf } from './handoff-note'
import { POST_EVERY_MS, discover, fetchSoon, homeDir, homeOf, norm, post, rootOf, withToken } from './hub'
import { HUB_RESUME, RESUME_DEDUP_MS, holding, liftHold, loadHold } from './limits'
import { projectDir } from './model'
import { liveShells, syncShells } from './shells'
import { feed, held, live, runs, st } from './state'

export type InboxItem = { id: string; kind: 'prompt'; text: string } | { id: string; kind: 'rc' } | { id: string; kind: 'compact' } | { id: string; kind: 'close' } | { id: string; kind: 'handoff' }
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
export const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n)
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
      await keepGoing($, st.lastAnswer)
    }
  }
}
export async function postLive($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const now = await $.clock.now()
  if (now - feed.lastLive < POST_EVERY_MS) return
  feed.lastLive = now
  await post($, {
    kind: 'live', sessionId: await $.session.id(), cwd: await $.session.cwd(), model: await $.session.model(),
    tokens: usage.context.tokens, compactAt: feed.compactAt, costUsd: usage.cost?.usd, prompt: feed.prompt, file: feed.file,
    limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  })
}
export async function count($: EngineInterface, owner: string) {
  const uses = ((await $.store.get('uses')) ?? {}) as Record<string, number>
  await $.store.set('uses', { ...uses, [owner]: (uses[owner] ?? 0) + 1 })
}
export async function poll($: EngineInterface) {
  if (st.polling) return
  st.polling = true
  try {
    const id = await $.session.id()
    const got = await Promise.all((await discover($)).map(t => fetchSoon($, `http://127.0.0.1:${t.port}/hub/inbox?session=${encodeURIComponent(id)}`, withToken(t))))
    for (const g of got) {
      if (!g?.ok) continue
      try { await deliver($, JSON.parse(g.text) as InboxItem[]) } catch { /* not a list */ }
    }
  } finally { st.polling = false }
}
/** The window holding this chat's folder, asked for its brief or an answer; this project only. */
export async function askHome($: EngineInterface, route: 'brief' | 'ask' | 'recall', q?: string) {
  const cwd = norm(await $.session.cwd())
  const home = homeOf(await discover($), cwd)
  if (!home) return undefined
  const query = `cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(await $.session.id())}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const got = await fetchSoon($, `http://127.0.0.1:${home.port}/hub/${route}?${query}`, withToken(home))
  return got?.ok ? got.text : undefined
}
export async function start($: EngineInterface) {
  if ((await $.store.get('since')) === undefined) await $.store.set('since', new Date(await $.clock.now()).toISOString().slice(0, 10))
  const usage = await $.session.usage({ breakdown: 'summary' })
  feed.compactAt = usage.context.breakdown?.autoCompactThreshold
  await postLive($, usage)
  const b = usage.context.breakdown
  if (b) await post($, { kind: 'diet', ...dietOf(b, ((await $.store.get('uses')) ?? {}) as Record<string, number>) })
}
// A chat's subagents sit under <id>/subagents.
export async function transcriptOf($: EngineInterface) {
  return `${projectDir(await homeDir($), await rootOf($))}/${await $.session.id()}.jsonl`
}
export async function readNote($: EngineInterface) {
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
export async function keepOf($: EngineInterface) {
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
export async function settle($: EngineInterface, answer: string) {
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
