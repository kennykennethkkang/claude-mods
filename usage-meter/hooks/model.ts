import type { EngineInterface } from 'claude-code'
import { words } from './branch-name'
import { cwdOf, homeDir, rootOf } from './hub'
import { agentCache, live, runs, st } from './state'

// Roles: model from ~/.claude/agents/<role>.md, raised by the smart switch; daily budget per role.

/** `model:` in an agent file's frontmatter; inherit or none leaves the spawn alone. */
export function agentFileModel(text: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const m = /^model:\s*["']?([^\s"'#]+)/m.exec(front)?.[1]
  return m && m !== 'inherit' ? m : undefined
}
export async function agentModel($: EngineInterface, role: string) {
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
export const level = (model?: string) => LADDER.findIndex(n => (model ?? '').toLowerCase().includes(n))
export const alias = (model: string) => LADDER[level(model)] ?? model
export const cleanReport = (answer: string) => /^[\s*#_-]*status[\s*_]*:[\s*_]*done[\s.*_]*$/im.test(answer)
// "debug" always reads as debugging; the other words lose to a design word ("redesign the error banner").
export const debugBrief = (brief: string) => /\bdebug\w*/i.test(brief) ||
  (/\b(bugs?|errors?|crash\w*|fail\w*|stack ?traces?)\b/i.test(brief) && !/\b(re)?design\w*|\b(layout|restyle|rebuild|rework|look)\w*/i.test(brief))
export const ROUNDS = 3
export const COOL_AFTER = 5
export type Run = { role: string; brief: string; model: string; files: string[]; clean: boolean; round: number }
export type Learned = { project: string; role: string; files: string[]; from: string; to: string; reason: string; at: number; resolvedBy?: string; clean?: number }
export const rel = (project: string, f: string) => (f.startsWith(`${project}/`) ? f.slice(project.length + 1) : f)
export const overlaps = (a: string[], b: string[]) => a.some(f => b.includes(f))
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
export const named = (brief: string, f: string) => brief.includes(f)
/** The spawn's model: its agent file's, or higher when this project learned that role needs more for the files the brief names. */
export function pickModel(base: string | undefined, role: string, brief: string, learned: Learned[], project: string) {
  const want = Math.max(-1, ...learned.filter(l => l.project === project && l.role === role && l.files.some(f => named(brief, f))).map(l => level(l.resolvedBy ?? l.to)))
  return want > level(base) ? LADDER[want] : base
}
// Claude Code's own layout: the project root with every non-alphanumeric as '-'.
export const projectDir = (home: string, root: string) => `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`
export const memoryDir = (home: string, root: string) => `${projectDir(home, root)}/memory`
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const escalationNote = (learned: Learned[]) => [
  '---', 'name: Model escalations', 'description: Roles the smart switch raised a model step after three redesign rounds, and which model fixed them', 'metadata:', '  type: project', '---', '',
  ...learned.map(l => `- ${l.files.join(', ')}: ${l.role}, ${l.from} failed ${ROUNDS} redesign rounds, ${l.resolvedBy ? `${l.resolvedBy} fixed it` : `raised to ${l.to}, not fixed yet`} (${dayOf(l.at)})`),
  '',
].join('\n')
export const MEMORY_LINE = '- [Model escalations](model-escalations.md): roles raised a model step after three redesign rounds; which model fixed what'
export async function learnPath($: EngineInterface) { return `${await homeDir($)}/.claude/switchboard/model-learn.json` }
export async function readLearn($: EngineInterface): Promise<Learned[]> {
  try { const l = JSON.parse(String(await $.fs.read(await learnPath($)))); return Array.isArray(l) ? l : [] } catch { return [] }
}
export async function endRun($: EngineInterface, agentId: string, answer: string) {
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
