import type { EngineInterface } from 'claude-code'

// Smart select: a rule pick per task, nudged by what past picks taught (smart-learned.json).
// Ledger and learned table shapes are the Switchboard contract; usage-meter/hooks/smart.ts keeps its own copy of the pick rule.

export const TASKS = ['tiny', 'fix', 'feature', 'ui', 'research', 'review', 'audit', 'other'] as const
export type Task = (typeof TASKS)[number]
export const LEVELS = ['off', 'lite', 'full', 'ultra']

const RE = {
  review: /\b(review|code review|look over)\b/i,
  audit: /\b(audit|sweep|whole (repo|codebase)|codebase-wide|repo-wide|every (file|caller))\b/i,
  tiny: /\b(typo|rename|bump|wording|one[- ]line|tiny|trivial|tweak|comment|readme)\b/i,
  research: /\b(research|investigate|find out|look into|compare|survey|explain|how does|what is|what are)\b/i,
  ui: /\b(ui|ux|css|layout|design|screen|page|button|style|styling|component|animation|dark mode|responsive|mockup)\b/i,
  fix: /\b(fix|bug|broken|fails?|failing|error|crash\w*|regression|stuck|not working)\b/i,
  feature: /\b(add|build|implement|create|make|support|new|wire|hook up)\b/i,
}

/** Task class from the prompt text; first match wins, so "fix a typo" is tiny and "fix the layout" is ui. */
export function classify(text: string): Task {
  for (const t of ['review', 'audit', 'tiny', 'research', 'ui', 'fix', 'feature'] as const) if (RE[t].test(text)) return t
  return 'other'
}

export const RULE: Record<Task, { level: string; why: string }> = {
  tiny: { level: 'ultra', why: 'tiny change: smallest diff wins' },
  fix: { level: 'full', why: 'bug fix: root cause, short diff' },
  feature: { level: 'full', why: 'new code: reuse before writing' },
  ui: { level: 'lite', why: 'UI work needs room to design' },
  research: { level: 'off', why: 'reading, nothing to build' },
  review: { level: 'lite', why: 'review judges code, it does not shrink it' },
  audit: { level: 'lite', why: 'audit reads wide and reports' },
  other: { level: 'full', why: 'no clear task type: the default level' },
}

export type Stat = { n: number; useful: number }
export type Learned = { updatedAt?: number; stats?: Record<string, Record<string, Record<string, Stat>>> }
const MIN_N = 5
const MARGIN = 0.15
/** Laplace rate: an unseen pick sits at one half. */
export const rate = (s?: Stat) => ((s?.useful ?? 0) + 1) / ((s?.n ?? 0) + 2)

/** The rule pick, unless another option of the same kind and task has 5+ rows and a rate 0.15 higher. */
export function smartPick(kind: string, task: string, rulePick: string, why: string, options: readonly string[], learned?: Learned) {
  const seen = learned?.stats?.[kind]?.[task] ?? {}
  const base = rate(seen[rulePick])
  let best: { o: string; r: number; s: Stat } | undefined
  for (const o of options) {
    const s = seen[o]
    if (o === rulePick || !s || s.n < MIN_N) continue
    const r = rate(s)
    if (r - base >= MARGIN - 1e-9 && (!best || r > best.r)) best = { o, r, s }
  }
  if (!best) return { pick: rulePick, why }
  return { pick: best.o, why: `learned: ${best.o} kept ${Math.round((best.s.useful / best.s.n) * 100)}% of ${best.s.n}` }
}

export type Row = Record<string, unknown>
export const pickRow = (r: { at: number; session: string; cwd: string; kind: string; task: string; pick: string; why: string; options: readonly string[] }): Row =>
  ({ t: 'pick', at: r.at, session: r.session, cwd: r.cwd, kind: r.kind, task: r.task, pick: r.pick, why: r.why, options: r.options, key: `${r.kind}:${r.at}` })
export const finalRow = (r: { at: number; session: string; kind: string; key: string; final: string }): Row =>
  ({ t: 'final', at: r.at, session: r.session, kind: r.kind, key: r.key, final: r.final })

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')

export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Where ponytail keeps its level: the per-project file (sha256 of the project dir) and the shared flag. */
export async function modeFiles(claudeDir: string, project: string) {
  const dir = norm(claudeDir)
  return { project: project ? `${dir}/ponytail-modes/${await sha256Hex(norm(project))}` : undefined, shared: `${dir}/.ponytail-active` }
}

export async function homeDir($: EngineInterface) { return norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '') }
export async function claudeDir($: EngineInterface) { return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await homeDir($)}/.claude` }
export async function projectDir($: EngineInterface) {
  return (await $.env.get('CLAUDE_PROJECT_DIR')) ?? (await Promise.resolve().then(() => $.session.root()).catch(() => $.session.cwd()))
}

/** What ponytail's readMode returns: the project file first, else the shared flag; null when neither exists. */
export async function readLevel($: EngineInterface) {
  const f = await modeFiles(await claudeDir($), await projectDir($))
  for (const p of [f.project, f.shared]) {
    if (!p) continue
    const v = String(await $.fs.read(p).catch(() => '')).trim()
    if (v) return v
  }
  return null
}

const FRESH_MS = 10 * 60_000
export type Stamp = { session: string; at: number }

/** The owner stamp next to a mode file: which chat wrote it last, and when. */
export async function readStamp($: EngineInterface): Promise<Stamp | undefined> {
  const f = await modeFiles(await claudeDir($), await projectDir($))
  try { const t = JSON.parse(String(await $.fs.read(`${f.project ?? f.shared}.smart`))); return typeof t?.session === 'string' && typeof t.at === 'number' ? t : undefined } catch { return undefined }
}

/** Another live chat wrote this project's level within the last 10 minutes. */
export async function otherOwns($: EngineInterface) {
  const st = await readStamp($)
  return !!st && st.session !== (await $.session.id()) && (await $.clock.now()) - st.at < FRESH_MS
}

/**
 * ponytail-runtime.js setMode: per-project file and shared flag, so SubagentStart picks it up.
 * Writes only when no other live chat owns the file and it still holds what this chat last wrote
 * (or nothing); `force` is Kenneth's own /smart. Returns false when it left the files alone.
 */
export async function writeLevel($: EngineInterface, level: string, wrote?: string, force = false) {
  const f = await modeFiles(await claudeDir($), await projectDir($))
  if (!force) {
    if (await otherOwns($)) return false
    const now = String(await $.fs.read(f.project ?? f.shared).catch(() => '')).trim()
    if (wrote !== undefined && now && now !== wrote) return false
  }
  for (const p of [f.project, f.shared]) if (p) await $.fs.write(p, level)
  await $.fs.write(`${f.project ?? f.shared}.smart`, JSON.stringify({ session: await $.session.id(), at: await $.clock.now() }))
  return true
}

export async function learnedPath($: EngineInterface) { return `${await homeDir($)}/.claude/switchboard/smart-learned.json` }

export async function readLearned($: EngineInterface): Promise<Learned> {
  try { const l = JSON.parse(String(await $.fs.read(await learnedPath($)))); return l && typeof l === 'object' ? l : {} } catch { return {} }
}

async function ledgerDir($: EngineInterface) { return `${await homeDir($)}/.claude/switchboard` }
const safe = (id: string) => id.replace(/[^\w.-]/g, '_')

/** This chat's own file for this mod: one writer per file, so rewrite-and-verify cannot erase anyone else's rows. */
export async function appendRows($: EngineInterface, rows: Row[], mod = 'select') {
  if (!rows.length) return
  const path = `${await ledgerDir($)}/smart-picks.d/${safe(await $.session.id())}-${mod}.jsonl`
  const add = rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  for (let i = 0; i < 4; i++) {
    const old = String(await $.fs.read(path).catch(() => ''))
    await $.fs.write(path, old + (old && !old.endsWith('\n') ? '\n' : '') + add)
    if (String(await $.fs.read(path).catch(() => '')).includes(add)) return
  }
}

/** The shared ledger plus every per-chat file of this session, as one text. */
export async function readSession($: EngineInterface) {
  const dir = await ledgerDir($)
  const id = safe(await $.session.id())
  let text = String(await $.fs.read(`${dir}/smart-picks.jsonl`).catch(() => ''))
  for (const f of await $.fs.list(`${dir}/smart-picks.d`).catch(() => [])) {
    if (f.kind === 'file' && f.name.startsWith(`${id}-`) && f.name.endsWith('.jsonl')) text += `\n${String(await $.fs.read(`${dir}/smart-picks.d/${f.name}`).catch(() => ''))}`
  }
  return text
}

/** This session's last rows of a kind, newest wins per key; used by the band. */
export function tail(text: string, session: string, kinds: readonly string[], max = 400) {
  const out = new Map<string, Row>()
  for (const line of text.split('\n').slice(-max)) {
    let r: Row
    try { r = JSON.parse(line) } catch { continue }
    if (r.session !== session || !kinds.includes(String(r.kind))) continue
    const prev = out.get(String(r.key))
    out.set(String(r.key), r.t === 'final' ? { ...(prev ?? r), final: r.final, t: 'pick' } : { ...r, ...(prev?.final !== undefined ? { final: prev.final } : {}) })
  }
  return [...out.values()]
}

// Copied from Switchboard extension/src/hub/smart-select.ts: keep in step.
export const RECOMMENDED = /\s*\(Recommended\)\s*$/i
export const stripRecommended = (s: string) => s.replace(RECOMMENDED, '').trim()
export const bare = stripRecommended
export const QUESTION_BUCKETS = ['finish', 'design', 'scope', 'approach', 'setup', 'naming', 'priority', 'other'] as const
// First match wins. Question rows use the bucket as their task so rates pool across free-text headers.
const BUCKETS: Array<[string, RegExp]> = [
  ['finish', /\b(approve|finished?|send back|sign.?off|on close|on finish|ship it|commit|done)\b/],
  ['naming', /\b(names?|rename|titles?|label|wording|copy|words|stamp|codes?)\b/],
  ['priority', /\b(next|first|order|priority|now|later|meanwhile|phase|timing|start|v1)\b/],
  ['setup', /\b(setup|set up|install|keys?|tokens?|accounts?|aws|auth0?|sign.?in|log.?in|deploy|hosts?|hosting|cloudflare|cf|domain|vsix|reload|quit|access|env|plugins?|servers?|database|rds|ses|s3|https|network|tailscale|release|updates?|migration|provider|firewall|credit|spend|quota|paid|ebay|gemini|perplexity|resend|expo|admins?|owners?|retention|telemetry|backups?|sync|export|download|save|upload|worktree|repos?|git|branches|cloudtrail|analytics|ecc|codex|stack)\b/],
  ['design', /\b(design|ui|ux|look|layout|hero|panel|page|pages|screen|view|colors?|theme|icons?|logo|style|styles|board|cards?|map|mocks?|visual|visuals|animation|anim|button|btn|font|header|picker|strip|pause|rope|realm|realms|frost|sprite|reel|photos?|videos?|phone|size|title bar|depth|borders|disclosure|placement|location|spot|shows?|click|characters|outfits|dresses|404)\b/],
  ['scope', /\b(scope|include|includes|what ships|only|rules?|limits?|cap|policy|filters?|rows|items|tasks|allow|allowlist|enforce|guard|checks?|gate|visibility|defaults?|who|where|which|features|everything|sources|suggestions|removals|duplicates|dead code|old|overhaul|revamp|rework)\b/],
  ['approach', /\b(approach|how|path|method|strategy|direction|model|models|fix|fixes|build|plan|flow|route|routing|implement|test|testing|merge|rollout|structure|architecture|arch|split|execute|intake|learning|auto|smart|pick|effort|kit|edit|edits|engineer|designer|qa|review|audit|research|growth|discussion|downgrade|mode|redeploy|regen)\b/],
]
/** A question's bucket from its header and text; 'other' when no keyword fits. Copy this function into the claude-mods mod. */
export function questionBucket(header: string | undefined, question = ''): string {
  const h = (header ?? '').toLowerCase().trim(), q = question.toLowerCase()
  if ((QUESTION_BUCKETS as readonly string[]).includes(h)) return h
  return (BUCKETS.find(([, re]) => re.test(h)) ?? BUCKETS.find(([, re]) => re.test(q)) ?? ['other'])[0]
}

export type Q = { question?: string; header?: string; options?: Array<{ label?: string; description?: string }> }
/** The "(Recommended)" option, else the first; undefined for a question with no options (text, number). */
export function questionPick(q: Q) {
  const labels = (q.options ?? []).map(o => String(o.label ?? '')).filter(Boolean)
  if (!labels.length) return undefined
  const rec = labels.find(l => RECOMMENDED.test(l))
  return { pick: bare(rec ?? labels[0]), options: labels.map(bare), recommended: !!rec }
}
