import type { EngineInterface } from 'claude-code'
import { homeDir } from './hub'

// Smart select ledger rows for subagent spawns. Same rule and row shapes as smart-select/hooks/smart.ts
// (mods cannot share a module), so keep smartPick, classify and the rows in step with it.

type Stat = { n: number; useful: number }
export type Learned = { stats?: Record<string, Record<string, Record<string, Stat>>> }
export type Row = Record<string, unknown>

const TASK_RE: Array<[string, RegExp]> = [
  ['review', /\b(review|code review|look over)\b/i],
  ['audit', /\b(audit|sweep|whole (repo|codebase)|codebase-wide|repo-wide|every (file|caller))\b/i],
  ['tiny', /\b(typo|rename|bump|wording|one[- ]line|tiny|trivial|tweak|comment|readme)\b/i],
  ['research', /\b(research|investigate|find out|look into|compare|survey|explain|how does|what is|what are)\b/i],
  ['ui', /\b(ui|ux|css|layout|design|screen|page|button|style|styling|component|animation|dark mode|responsive|mockup)\b/i],
  ['fix', /\b(fix|bug|broken|fails?|failing|error|crash\w*|regression|stuck|not working)\b/i],
  ['feature', /\b(add|build|implement|create|make|support|new|wire|hook up)\b/i],
]
export const classify = (text: string) => TASK_RE.find(([, re]) => re.test(text))?.[0] ?? 'other'

const rate = (s?: Stat) => ((s?.useful ?? 0) + 1) / ((s?.n ?? 0) + 2)
/** The rule pick, unless another option of the same kind and task has 5+ rows and a rate 0.15 higher. */
export function smartPick(kind: string, task: string, rulePick: string, why: string, options: readonly string[], learned?: Learned) {
  const seen = learned?.stats?.[kind]?.[task] ?? {}
  const base = rate(seen[rulePick])
  let best: { o: string; r: number; s: Stat } | undefined
  for (const o of options) {
    const s = seen[o]
    if (o === rulePick || !s || s.n < 5) continue
    const r = rate(s)
    if (r - base >= 0.15 - 1e-9 && (!best || r > best.r)) best = { o, r, s }
  }
  return best ? { pick: best.o, why: `learned: ${best.o} kept ${Math.round((best.s.useful / best.s.n) * 100)}% of ${best.s.n}` } : { pick: rulePick, why }
}

export const pickRow = (r: { at: number; session: string; cwd: string; kind: string; task: string; pick: string; why: string; options: readonly string[] }): Row =>
  ({ t: 'pick', at: r.at, session: r.session, cwd: r.cwd, kind: r.kind, task: r.task, pick: r.pick, why: r.why, options: r.options, key: `${r.kind}:${r.at}` })
export const finalRow = (r: { at: number; session: string; kind: string; key: string; final: string }): Row =>
  ({ t: 'final', at: r.at, session: r.session, kind: r.kind, key: r.key, final: r.final })

export async function readSmart($: EngineInterface): Promise<Learned> {
  try { const l = JSON.parse(String(await $.fs.read(`${await homeDir($)}/.claude/switchboard/smart-learned.json`))); return l && typeof l === 'object' ? l : {} } catch { return {} }
}

/** Append rows to this chat's own file (one writer, so rewrite-and-verify cannot erase anyone else's rows). */
export async function appendRows($: EngineInterface, rows: Row[]) {
  if (!rows.length) return
  const path = `${await homeDir($)}/.claude/switchboard/smart-picks.d/${(await $.session.id()).replace(/[^\w.-]/g, '_')}-meter.jsonl`
  const add = rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  for (let i = 0; i < 4; i++) {
    const old = String(await $.fs.read(path).catch(() => ''))
    await $.fs.write(path, old + (old && !old.endsWith('\n') ? '\n' : '') + add)
    if (String(await $.fs.read(path).catch(() => '')).includes(add)) return
  }
}

// The roles pick-run.ts knows, for the role row's options.
export const ROLE_OPTIONS = ['lead', 'engineer', 'qa', 'researcher', 'Explore', 'designer', 'ops', 'growth']
