import type { EngineInterface } from 'claude-code'
import { add, start } from './feed'
import { handedOff, handoff } from './handoff'
import { decisions } from './handoff-note'
import { homeDir, post, rootOf } from './hub'
import { holding } from './limits'
import type { Run } from './model'
import { redact } from './redact'
import { feed, ind, indDone, indStopped } from './state'

// Run indefinitely: a per-chat switch the hub keeps in ~/.claude/switchboard/indefinite.json as { sessionId: onAt } or { sessionId: { onAt, maxHours?, maxCostUsd?, gate? } }.
export const IND_READ_MS = 5_000
export const IND_ASK_MS = 15 * 60_000
export const IND_DONE = /^Run indefinitely: done\s*$/m
// Kept word for word with Switchboard's extension/src/hub/indefinite.ts.
export const IND_DESIGN = 'If the round changes UI or UX, build two versions on localhost behind a toggle: Safe (proven patterns from the project and the design library) and Explore (a bolder take from ~/.claude/switchboard/design-md/SOURCES.md); have a qa agent that built neither run crowd-ab and a MiroFish sim on both, keep the winner, log both results in .switchboard/design-rounds.md, and start the next UI round from the winner with a fresh Safe and Explore pair.'
export const IND_ROUND = `Run indefinitely is on. Do another round: audit the project for bugs, errors, user problems and hard-to-use parts; fix them; add components that would help this project; run the checks; dispatch role subagents as needed. ${IND_DESIGN} Decide everything yourself and note decisions. Never commit. When nothing is left you can improve, end with the line \`Run indefinitely: done\`.`
export const IND_ASK_RULE = 'Run indefinitely is on: ask every question only the user can answer now, in one AskUserQuestion round before you start work; after that, decide yourself and note what you decided. Never end a turn with open tasks you can do yourself.'
export type IndCfg = { onAt: number; maxHours?: number; maxCostUsd?: number; gate?: string }
export const IND_GATE_MS = 600_000
export const IND_GATE_LINES = 20
export const gateShell = (gate: string, windows: boolean) => windows ? ['cmd.exe', '/d', '/s', '/c', gate] : ['/bin/sh', '-c', gate]
export const posNum = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)
/** This chat's flag as a config: a plain number is just onAt. Missing, broken or already ended means off. */
export async function indefiniteCfg($: EngineInterface): Promise<IndCfg | undefined> {
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
export const tailLines = (text: string) => text.trim().split('\n').slice(-IND_GATE_LINES).join('\n')
/** Gate exit 0 passes; anything else, or a gate that cannot run, fails with its output tail. */
export async function runGate($: EngineInterface, gate: string, cwd?: string): Promise<{ ok: true } | { ok: false; out: string }> {
  try {
    const r = await $.process.run(gateShell(gate, (await $.env.get('OS')) === 'Windows_NT'), { cwd: cwd ?? (await $.session.cwd()), timeoutMs: IND_GATE_MS })
    return r.exitCode === 0 ? { ok: true } : { ok: false, out: tailLines(`${r.stdout}\n${r.stderr}`) }
  } catch (err) {
    return { ok: false, out: `gate did not finish: ${err instanceof Error ? err.message : String(err)}` }
  }
}
// A /goal file at the project root steers its rounds; its Check line is the gate when the hub sets none, and the done line alone cannot pass it.
export const goalPath = (root: string, id: string) => `${root}/.switchboard/goals/${id}.md`
export const goalRound = (file: string) => `Run indefinitely is on with a goal in ${file}. Do another round toward it: build or fix what is still missing, test every function it names against how it should work, run its check and the project checks, dispatch role subagents as needed. ${IND_DESIGN} Decide everything yourself and note decisions in the goal file. Never commit. When every point in the goal works with no issues and its check passes, end with the line \`Run indefinitely: done\`.`
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
export async function indefiniteAsk($: EngineInterface) { return ((await indefiniteOn($).catch(() => undefined)) === undefined ? undefined : IND_ASK_RULE) }
