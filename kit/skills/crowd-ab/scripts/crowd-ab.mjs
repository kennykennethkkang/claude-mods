#!/usr/bin/env node
// crowd-ab: synthetic user panel votes between 2-4 options via Jev (fallback: claude -p haiku panel).
// node crowd-ab.mjs --goal "..." --option "text" --option @file.html [--n 1000] [--cap 1] [--seed 1] [--out dir] [--panel] [--dry-run]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SLOTS = ['first', 'second', 'third', 'fourth']
export const REASONS = {
  clearer: 'Easier to understand at a glance.',
  faster: 'Gets the goal done quicker or with fewer steps.',
  trust: 'Feels more trustworthy, honest or safe.',
  looks: 'Looks better or more polished.',
  accessible: 'Easier for this persona to read, see or operate.',
  familiar: 'Matches what this persona already knows from other products.',
  none: 'No real reason or no preference.',
}
const DIMS = {
  age: [['18-24', 15], ['25-34', 22], ['35-49', 25], ['50-64', 22], ['65+', 16]],
  tech: [['low', 30], ['medium', 45], ['high', 25]],
  device: [['phone', 55], ['desktop', 35], ['tablet', 10]],
  access: [['none', 70], ['low vision', 8], ['screen reader', 4], ['motor', 5], ['dyslexia', 7], ['colour blind', 6]],
  intent: [['first visit', 30], ['returning', 25], ['comparing options', 20], ['in a hurry', 25]],
  patience: [['patient', 30], ['average', 40], ['impatient', 30]],
}
// 2026-11 pilot: about $0.00005 per call; the real run measures a pilot first.
const GUESS_PER_CALL = 0.0001

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pickW = (r, list) => {
  let x = r() * list.reduce((s, [, w]) => s + w, 0)
  for (const [v, w] of list) if ((x -= w) < 0) return v
  return list.at(-1)[0]
}

export function personas(n, seed, k) {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => {
    const seg = Object.fromEntries(Object.entries(DIMS).map(([d, l]) => [d, pickW(r, l)]))
    const order = Array.from({ length: k }, (_, j) => j)
    for (let j = k - 1; j > 0; j--) { const s = Math.floor(r() * (j + 1)); [order[j], order[s]] = [order[s], order[j]] }
    const text = `Age ${seg.age}, ${seg.tech} tech skill, on a ${seg.device}, accessibility needs: ${seg.access}, ${seg.intent}, ${seg.patience}.`
    return { id: i, seg, order, text }
  })
}

// slot answer -> option index, using that persona's shuffled order
export function decode(slot, order) {
  const i = SLOTS.indexOf(slot)
  return i < 0 || i >= order.length ? 'none' : order[i]
}

export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

// votes: [{pick: optionIndex|'none', reason, seg}]
export function aggregate(votes, labels) {
  const count = vs => {
    const c = Object.fromEntries([...labels.map((_, i) => [i, 0]), ['none', 0]])
    for (const v of vs) c[v.pick] = (c[v.pick] ?? 0) + 1
    return c
  }
  const counts = count(votes)
  const ranked = labels.map((_, i) => i).sort((a, b) => counts[b] - counts[a])
  const [lead, second] = ranked
  const k = counts[lead], m = counts[second], [lo, hi] = wilson(k, k + m)
  const share = Object.fromEntries(Object.entries(counts).map(([o, c]) => [o, votes.length ? c / votes.length : 0]))
  const segments = {}
  for (const d of Object.keys(DIMS)) {
    segments[d] = {}
    for (const val of [...new Set(votes.map(v => v.seg?.[d]).filter(Boolean))]) {
      const vs = votes.filter(v => v.seg[d] === val), c = count(vs)
      const a = c[lead], b = c[second]
      segments[d][val] = { n: vs.length, counts: c, leadRate: a + b ? a / (a + b) : null }
    }
  }
  const reasons = {}
  for (const v of votes) {
    const r = (reasons[v.pick] ??= {})
    r[v.reason] = (r[v.reason] ?? 0) + 1
  }
  for (const o of Object.keys(reasons)) reasons[o] = Object.entries(reasons[o]).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const decisive = votes.filter(v => v.pick !== 'none' && v.slot)
  return {
    n: votes.length, counts, share,
    firstSlot: decisive.length ? decisive.filter(v => v.slot === 'first').length / decisive.length : null,
    headToHead: { leader: lead, runnerUp: second, rate: k + m ? k / (k + m) : null, ci: [lo, hi] },
    winner: k + m && lo > 0.5 ? lead : null,
    segments, reasons,
  }
}

export function report(agg, labels) {
  const L = i => (i === 'none' ? 'no preference' : labels[i])
  const pct = x => (x == null ? 'n/a' : (100 * x).toFixed(1) + '%')
  const h = agg.headToHead
  const out = [`${agg.n} votes`]
  for (const [o, c] of Object.entries(agg.counts)) out.push(`  ${L(o)}: ${c} (${pct(agg.share[o])})`)
  out.push(`${L(h.leader)} vs ${L(h.runnerUp)}: ${pct(h.rate)} of decisive votes, 95% CI ${pct(h.ci[0])} to ${pct(h.ci[1])}`)
  if (agg.firstSlot != null) out.push(`Picked whatever was shown first: ${pct(agg.firstSlot)} of decisive votes (${pct(1 / Object.keys(agg.counts).slice(0, -1).length)} = no position bias)`)
  out.push(agg.winner == null ? 'Verdict: no winner, interval includes a tie.' : `Verdict: ${L(agg.winner)} wins.`)
  out.push(`Segments (share of ${L(h.leader)} vs ${L(h.runnerUp)}):`)
  for (const [d, vals] of Object.entries(agg.segments))
    out.push(`  ${d}: ` + Object.entries(vals).map(([v, s]) => `${v} ${pct(s.leadRate)} (n=${s.n})`).join(', '))
  out.push('Top reasons:')
  for (const [o, rs] of Object.entries(agg.reasons)) out.push(`  ${L(o)}: ` + rs.map(([r, c]) => `${r} ${c}`).join(', '))
  return out.join('\n')
}

function args(argv) {
  const a = { option: [], n: null, cap: 1, seed: 1, out: null, panel: false, dryRun: false, label: [] }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i], v = () => argv[++i]
    if (f === '--goal') a.goal = v()
    else if (f === '--option') a.option.push(v())
    else if (f === '--label') a.label.push(v())
    else if (f === '--n') a.n = +v()
    else if (f === '--cap') a.cap = +v()
    else if (f === '--seed') a.seed = +v()
    else if (f === '--out') a.out = v()
    else if (f === '--panel') a.panel = true
    else if (f === '--dry-run') a.dryRun = true
    else throw new Error('unknown flag ' + f)
  }
  if (!a.goal || a.option.length < 2 || a.option.length > 4) throw new Error('need --goal and 2-4 --option')
  return a
}

const optText = o => {
  if (!o.startsWith('@')) return o
  const t = fs.readFileSync(o.slice(1), 'utf8')
  return /\.html?$/i.test(o) ? t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : t
}

const JEV = path.join(os.homedir(), '.claude/skills/claude-x-jev/scripts/jev.py')
const jevUp = () => fs.existsSync(JEV) && spawnSync('python3', [JEV, 'status'], { encoding: 'utf8', timeout: 30000 }).status === 0

// Jev's choice over shown options is ~99% "first" (2026-11 run), so each option is rated alone:
// one item per persona per option, no position to be biased by.
const TIE = 0.15

function preset() {
  return {
    name: 'crowd-ab', description: 'One synthetic user rates one option.', model: 'typesafe/jev-1.13',
    state_fields: ['persona', 'goal', 'option'],
    display_fields: ['p', 'o', ...Object.keys(DIMS)],
    questions: {
      appeal: {
        type: 'score',
        instructions: 'You are the user described in `persona`. You want to: `goal`. How likely is this user to choose `option`, from lowest to highest?',
        criteria: ['Would avoid it.', 'Unlikely to choose it.', 'Might choose it.', 'Likely to choose it.', 'Would choose it right away.'],
      },
      reason: {
        type: 'choice',
        instructions: 'What is the main thing this user would say about `option`, from where this user sits?',
        criteria: REASONS,
      },
    },
    thresholds: { appeal: 0, reason: 0 },
  }
}

// rows: one per persona per option -> votes; scores within TIE count as no preference
export function votesFromRatings(rows, k) {
  const by = {}
  for (const r of rows) if (!r._error && typeof r.appeal === 'number') (by[r.p] ??= {})[r.o] = r
  return Object.values(by).filter(o => Object.keys(o).length === k).map(o => {
    const rs = Object.values(o).sort((a, b) => b.appeal - a.appeal)
    const tie = rs[0].appeal - rs[1].appeal < TIE
    const seg = Object.fromEntries(Object.keys(DIMS).map(d => [d, rs[0][d]]))
    return { pick: tie ? 'none' : +rs[0].o, reason: tie ? 'none' : rs[0].reason, seg }
  })
}

function runJev(ps, texts, goal, dir, tag) {
  const items = ps.flatMap(p => texts.map((t, o) => ({ _id: `${p.id}:${o}`, p: p.id, o, persona: p.text, goal, option: t, ...p.seg })))
  const inp = path.join(dir, `items-${tag}.jsonl`), out = path.join(dir, `jev-${tag}.jsonl`)
  fs.writeFileSync(inp, items.map(x => JSON.stringify(x)).join('\n'))
  const r = spawnSync('python3', [JEV, 'ask', '--preset', path.join(dir, 'preset.json'), '--input', inp, '--out', out], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error('jev.py failed')
  const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const cost = rows.reduce((s, x) => s + (x._cost || 0), 0)
  return { votes: votesFromRatings(rows, texts.length), cost, errors: rows.filter(x => x._error).length }
}

async function runPanel(ps, texts, labels, goal) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-ab-'))
  const one = p => new Promise(res => {
    const shown = p.order.map((o, j) => `${SLOTS[j]}: ${texts[o]}`).join('\n\n')
    const prompt = `Role-play this user: ${p.text}\nGoal: ${goal}\n\nOptions:\n${shown}\n\nReply with only JSON: {"pick":"${SLOTS.slice(0, texts.length).join('|')}|none","reason":"one of ${Object.keys(REASONS).join('|')}","why":"one short line"}`
    const c = spawn('claude', ['-p', '--model', 'haiku', '--setting-sources', 'project', prompt], { cwd })
    let s = ''
    c.stdout.on('data', d => (s += d)); c.stderr.on('data', d => (s += d))
    c.on('close', () => res(s))
  })
  const votes = []
  for (let i = 0; i < ps.length; i += 4) {
    const outs = await Promise.all(ps.slice(i, i + 4).map(one))
    if (outs.some(o => /hit your/i.test(o))) { console.error('usage limit hit, stopping panel'); break }
    outs.forEach((o, j) => {
      const m = o.match(/\{[\s\S]*\}/)
      try { const v = JSON.parse(m[0]); const p = ps[i + j]; votes.push({ pick: decode(v.pick, p.order), slot: v.pick, reason: REASONS[v.reason] ? v.reason : 'none', why: v.why, seg: p.seg }) } catch {}
    })
  }
  fs.rmSync(cwd, { recursive: true, force: true })
  return votes
}

async function main() {
  const a = args(process.argv.slice(2))
  const texts = a.option.map(optText)
  const labels = a.option.map((o, i) => a.label[i] || String.fromCharCode(65 + i))
  const dir = a.out || fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-ab-run-'))
  fs.mkdirSync(dir, { recursive: true })
  const usePanel = a.panel || !jevUp()
  const n = a.n ?? (usePanel ? 30 : 1000)
  const ps = personas(n, a.seed, texts.length)
  if (usePanel) {
    console.log(`Jev ${a.panel ? 'skipped' : 'unavailable'}: haiku panel of ${n} via claude -p (subscription usage, no $ cost).`)
    if (a.dryRun) return
    const votes = await runPanel(ps, texts, labels, a.goal)
    fs.writeFileSync(path.join(dir, 'votes.json'), JSON.stringify(votes, null, 1))
    console.log(report(aggregate(votes, labels), labels))
    for (const v of votes.slice(0, 5)) if (v.why) console.log(`  "${v.why}"`)
    return
  }
  fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify(preset(), null, 1))
  console.log(`Estimate before pilot: ${n * texts.length} calls x ~$${GUESS_PER_CALL} = ~$${(n * texts.length * GUESS_PER_CALL).toFixed(3)} (cap $${a.cap})`)
  if (a.dryRun) return
  const pilotN = Math.min(10, n)
  const pilot = runJev(ps.slice(0, pilotN), texts, a.goal, dir, 'pilot')
  const est = pilot.cost / pilotN * n
  console.log(`Pilot: ${pilotN} personas cost $${pilot.cost.toFixed(5)}; full run estimate $${est.toFixed(3)}`)
  if (est > a.cap) { console.log(`Over cap $${a.cap}; stopping. Lower --n or raise --cap.`); process.exit(2) }
  const rest = n > pilotN ? runJev(ps.slice(pilotN), texts, a.goal, dir, 'main') : { votes: [], cost: 0, errors: 0 }
  const votes = [...pilot.votes, ...rest.votes]
  fs.writeFileSync(path.join(dir, 'votes.json'), JSON.stringify(votes))
  console.log(`Spent $${(pilot.cost + rest.cost).toFixed(4)}, ${pilot.errors + rest.errors} errors. Files in ${dir}`)
  console.log(report(aggregate(votes, labels), labels))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1) })
