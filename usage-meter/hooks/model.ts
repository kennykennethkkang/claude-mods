import type { EngineInterface } from 'claude-code'
import { words } from './branch-name'
import { cwdOf, homeDir, rootOf } from './hub'
import { appendRows, finalRow } from './smart'
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
// Auto pick: C (does it need a stronger model) and T (does it need more thoroughness) from the task text.
// Same rule as extension/src/hub/picker.ts pickRun; tests/pick-cases.json is shared by both, keep them in step.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const ROLES: Record<string, { base: string; floor: string; ceil: string; eMin: string; eMax: string }> = {
  lead: { base: 'opus', floor: 'sonnet', ceil: 'fable', eMin: 'medium', eMax: 'max' },
  engineer: { base: 'sonnet', floor: 'haiku', ceil: 'fable', eMin: 'low', eMax: 'max' },
  qa: { base: 'sonnet', floor: 'haiku', ceil: 'opus', eMin: 'medium', eMax: 'xhigh' },
  researcher: { base: 'haiku', floor: 'haiku', ceil: 'opus', eMin: 'medium', eMax: 'high' },
  Explore: { base: 'haiku', floor: 'haiku', ceil: 'sonnet', eMin: 'medium', eMax: 'medium' },
  designer: { base: 'opus', floor: 'sonnet', ceil: 'fable', eMin: 'medium', eMax: 'xhigh' },
  ops: { base: 'haiku', floor: 'haiku', ceil: 'sonnet', eMin: 'low', eMax: 'high' },
  growth: { base: 'opus', floor: 'sonnet', ceil: 'opus', eMin: 'medium', eMax: 'high' },
}
export const pickable = (role: string) => role in ROLES
const HARD = [
  /\b(architect\w*|algorith\w*|state machine|protocol|design (a|an|the) (system|schema|api))\b/i,
  /\b(race|races|concurren\w*|deadlock\w*|atomic\w*)\b/i,
  /\b(root cause|intermittent\w*|flak\w*|why does|why do|why is|non-?determinis\w*|leak\w*)\b/i,
  /\b(migrat\w*|rewrite|port (it |this )?to)\b/i,
  /\b(security|vulnerab\w*|exploit\w*|threat model)\b/i,
]
const EASY = /\b(rename|typo|wording|bump|comment|readme|format|lint|one[- ]line|tiny|trivial|tweak)\b/gi
const VERIFY = /\b(bug|fix|fixes|regression|edge cases?|broken|failing|fails)\b/i
const RISK = /\b(auth\w*|secrets?|api keys?|passwords?|payments?|billing|data loss|database|deploy\w*|permissions?|shell|network|keychain|security|vulnerab\w*)\b/i
const BROAD = /\b(every|all (the )?(files|callers|routes|screens|pages|tests)|whole|entire|(deep|full) sweep|across|codebase-wide|repo-wide|audit)\b/i
// A lookup or a dismissal is not work: "pull up the page", "never mind".
const LOOKUP = /^\s*(can you )?(pull( me)?( up| to)|show me|where|which|what|is |are |does |did |have |has |when |how )/i
const NOOP = /\b(ignore it|never ?mind|forget it)\b/i
// A build ask this long that names no file is a feature, not a tweak: it counts as scope 2 (3 from 1000 chars).
const BUILD = /\b(implement|build|create|creating|add|revamp|redesign|integrate|make (me )?an? )/i
const SHARED = /\b(shared state|state|store|cache|database|data)\b/i
const FILE = /(?:[\w.-]+\/)+[\w.*-]+\.\w+|\b[\w-]+\.(?:tsx?|m?js|json|md|py|css|swift|go|rs)\b/g
const DIFFICULTY: Record<string, number> = { trivial: -2, routine: 0, hard: 3, frontier: 6 }
export type PickInput = {
  text: string
  role?: string
  ai: 'claude' | 'codex'
  /** Files the task touches; counted from the text when absent. */
  files?: number
  /** Parts of the task; counted from bullets and "also" when absent. */
  parts?: number
  unattended?: boolean
  /** The 5h window's percent for this AI. */
  usage5h?: number
  jevDifficulty?: { label: string; conf: number }
  /** What the user or the Agent call set; wins and is never gated. */
  explicit?: { model?: string; effort?: string }
  /** Role model from its agent file, in place of the table's. */
  base?: string
  /** Escalation steps this project learned for these files, and times Kenneth sent the chain back. */
  learned?: number
  sentBack?: number
}
export type RunPick = { model: string; effort: string; ultracode: boolean; ultrathink: boolean; reason: string }
const at = (l: string[], v: string) => l.indexOf(v)
const clampTo = (i: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, i))
function features(text: string, files?: number, parts?: number) {
  const bullets = text.split('\n').filter(l => /^\s*([-*]|\d+[.)])\s/.test(l)).length
  const lookup = LOOKUP.test(text), short = lookup && text.length < 100
  const nfiles = files ?? new Set(text.match(FILE) ?? []).size
  const easy = new Set((text.match(EASY) ?? []).map(s => s.toLowerCase())).size
  return {
    files: nfiles,
    broad: BROAD.test(text) && !lookup,
    hard: HARD.filter(r => r.test(text)).length,
    easy,
    verify: VERIFY.test(text) && !short && !NOOP.test(text),
    risk: RISK.test(text) && !short,
    shared: SHARED.test(text),
    size: BUILD.test(text) && !nfiles && !easy ? (text.length >= 1000 ? 3 : text.length >= 300 ? 2 : 0) : 0,
    parts: parts ?? Math.max(bullets, 1 + (text.match(/\b(also|and then|plus)\b/gi) ?? []).length),
  }
}
const scopeOf = (f: { broad: boolean; files: number }) => (f.broad || f.files >= 10 ? 3 : f.files >= 4 ? 2 : f.files >= 2 ? 1 : 0)
function codexPick(t: PickInput): RunPick {
  const f = features(t.text, t.files, t.parts)
  const T = scopeOf(f) + (f.verify ? 2 : 0) + (f.risk ? 2 : 0) + 3 * Math.min(2, f.hard)
  const [model, effort] = t.role === 'qa-codex' ? ['gpt-5.6-luna', 'high']
    : T >= 5 && (t.usage5h ?? 0) < 60 ? ['gpt-6-luna', 'xhigh'] : T >= 2 ? ['gpt-5.6-terra', 'high'] : ['gpt-5.6-terra', 'medium']
  const held = T >= 5 && (t.usage5h ?? 0) >= 60 && t.role !== 'qa-codex' ? `, 5h at ${t.usage5h}%: held xhigh` : ''
  return { model: t.explicit?.model ?? model, effort: t.explicit?.effort ?? effort, ultracode: false, ultrathink: false, reason: `Auto: ${model} · ${effort}, because codex task score ${T}${held}` }
}
export function pickRun(t: PickInput): RunPick {
  if (t.ai === 'codex') return codexPick(t)
  const role = ROLES[t.role ?? 'lead'] ?? ROLES.lead
  const base = at(LADDER, alias(t.base ?? '')) >= 0 ? alias(t.base!) : role.base
  const f = features(t.text, t.files, t.parts)
  const why: string[] = []
  const sure = t.jevDifficulty && t.jevDifficulty.conf >= 0.7 && t.jevDifficulty.label in DIFFICULTY ? DIFFICULTY[t.jevDifficulty.label] : undefined
  const C = (sure ?? Math.min(6, 3 * f.hard) - Math.min(4, 2 * f.easy)) + 3 * (t.learned ?? 0) + Math.min(2, t.sentBack ?? 0)
  const scope = scopeOf(f)
  const T = Math.max(scope, f.size) + (f.verify && !f.easy ? 2 : 0) + (f.risk ? 2 : 0) + (f.parts >= 3 ? 2 : 0) + (t.unattended ? 1 : 0) + Math.min(2, t.sentBack ?? 0) - (f.easy ? 1 : 0)
  const step = C <= -2 ? -1 : C <= 2 ? 0 : C <= 5 ? 1 : 2
  let m = clampTo(at(LADDER, base) + step, at(LADDER, role.floor), at(LADDER, role.ceil))
  if (t.role === 'qa') m = f.risk || f.shared || f.files >= 10 ? 2 : T <= 1 ? 0 : 1
  if (m === 3 && C < 6) m = 2
  let e = T <= 0 ? 0 : T === 1 ? 1 : T <= 4 ? 2 : 3
  if (C >= 3) e = Math.max(e, 1)
  if (C >= 6) e = Math.max(e, 2)
  if (T >= 6 && t.unattended && C >= 6) e = 4
  e = clampTo(e, at(EFFORTS, role.eMin), at(EFFORTS, role.eMax))
  if (m === 0 && e >= 3) { m = 1; e = 2 }
  const lead = (t.role ?? 'lead') === 'lead'
  let ultracode = lead && f.parts >= 3 && scope >= 2 && T >= 5
  let ultrathink = lead && !ultracode && f.parts < 3 && C >= 3 && T <= 2
  if (sure !== undefined) why.push(`${t.jevDifficulty!.label} task`)
  else if (f.hard) why.push(`${f.hard} hard signal${f.hard > 1 ? 's' : ''}`)
  if (f.easy) why.push('small change')
  if (scope) why.push(f.broad ? 'repo-wide' : `${f.files} files`)
  if (f.verify && !f.easy) why.push('bug fix')
  if (f.risk) why.push('risky area')
  if (t.learned) why.push('escalated before on these files')
  if (t.sentBack) why.push(`sent back ${t.sentBack}x`)
  if (t.unattended) why.push('runs unattended')
  // 5h at 60% or over holds ultracode, ultrathink, xhigh, max and fable.
  const u = t.usage5h ?? 0
  if (u >= 60) {
    const held: string[] = []
    if (ultracode) { ultracode = false; held.push('ultracode') }
    if (ultrathink) { ultrathink = false; held.push('ultrathink') }
    if (e >= 3) { held.push(EFFORTS[e]); e = 2 }
    if (m === 3) { held.push('fable'); m = 2 }
    if (held.length) why.push(`5h at ${u}%: held ${held.join(', ')}`)
  }
  const model = t.explicit?.model ?? LADDER[m]
  const effort = t.explicit?.effort ?? EFFORTS[e]
  const flags = `${ultracode ? ' +ultracode' : ''}${ultrathink ? ' +ultrathink' : ''}`
  return { model, effort, ultracode, ultrathink, reason: `Auto: ${model} · ${effort}${flags}, because ${why.join(', ') || 'routine task'}` }
}
// Project-relative path only: a bare basename (index.ts, page.tsx) names too many files.
export const named = (brief: string, f: string) => brief.includes(f)
/** The spawn's model: its agent file's, or higher when this project learned that role needs more for the files the brief names. */
export function pickModel(base: string | undefined, role: string, brief: string, learned: Learned[], project: string) {
  const want = Math.max(-1, ...learned.filter(l => l.project === project && l.role === role && l.files.some(f => named(brief, f))).map(l => level(l.resolvedBy ?? l.to)))
  return want > level(base) ? LADDER[want] : base
}
/** The role's last round when it came back on files this brief names: not clean, the last qa since found problems, or, with no qa yet, the brief carries a failure (the gate's log). qa reruns never count. */
export function sentBackRun(done: Run[], role: string, brief: string, project: string) {
  if (role.startsWith('qa')) return undefined
  const i = done.map(x => x.role).lastIndexOf(role), prev = done[i]
  if (!prev || !prev.files.some(f => named(brief, rel(project, f)))) return undefined
  const qa = done.slice(i + 1).filter(x => x.role.startsWith('qa')).at(-1)
  return !prev.clean || (qa ? !qa.clean : debugBrief(brief)) ? prev : undefined
}
/** A spawn's model: pickModel's, then the auto pick moves it for roles that have a file model and a table row; a sent-back round reruns one step above the pick. */
export function spawnModel(base: string | undefined, role: string, brief: string, learned: Learned[], project: string, usage5h?: number, done: Run[] = []) {
  const raised = pickModel(base, role, brief, learned, project)
  if (!base || level(base) < 0 || !pickable(role)) return raised
  const picked = pickRun({ text: brief, role, ai: 'claude', base, usage5h, learned: Math.max(0, level(raised) - level(base)) }).model
  const back = sentBackRun(done, role, brief, project)
  if (!back) return picked
  // Fable stays with the hardest picks and the three-round escalation; a rerun tops out at opus.
  return LADDER[Math.max(level(picked), Math.min(level(picked) + 1, at(LADDER, ROLES[role].ceil), 2))]
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
  // Smart select: the escalation is the final for this spawn's model pick.
  const raised = out.learned.find(l => l.project === project && l.role === r.role && l.at === now && !l.resolvedBy)
  if (raised && a.smartKey) await appendRows($, [finalRow({ at: now, session: await $.session.id(), kind: 'model', key: a.smartKey, final: raised.to })]).catch(() => undefined)
  const dir = memoryDir(await homeDir($), await rootOf($).catch(() => project))
  await $.fs.write(`${dir}/model-escalations.md`, escalationNote(out.learned.filter(l => l.project === project)))
  const index = String(await $.fs.read(`${dir}/MEMORY.md`).catch(() => ''))
  if (!index.includes('(model-escalations.md)')) await $.fs.write(`${dir}/MEMORY.md`, `${index}${index && !index.endsWith('\n') ? '\n' : ''}${MEMORY_LINE}\n`)
}
