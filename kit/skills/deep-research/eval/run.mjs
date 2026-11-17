#!/usr/bin/env node
// A/B: plain researcher prompt vs the deep-research skill, both on sonnet, each answer graded by every judge.
// node run.mjs [--n 5] [--from 0] [--jobs 2] [--ids q01,q05] [--level quick] [--judges haiku,sonnet] [--claims 3|all] [--out results.json]
import { execFile } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldMatch, mergeJudges, parseJudge, perJudge, summarize } from './score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = join(HERE, '..', '..', '..')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
if (process.argv.includes('--help')) { console.log('node run.mjs [--n 5] [--from 0] [--jobs 2] [--ids q01,q05] [--level quick] [--judges haiku,sonnet] [--claims 3|all] [--out results.json]'); process.exit(0) }
const N = +arg('n', 5), FROM = +arg('from', 0), JOBS = +arg('jobs', 2), OUT = join(HERE, arg('out', 'results.json')), IDS = arg('ids')?.split(',')
const LEVEL = arg('level', 'quick'), JUDGES = arg('judges', 'haiku,sonnet').split(','), TURNS = LEVEL === 'quick' ? 40 : 80
// Round 2 judges checked 3 claims each, too few to split the arms under sonnet. 'all' checks every cited claim.
const CLAIMS = arg('claims', '3'), JUDGE_TURNS = CLAIMS === 'all' ? 40 : 12

const questions = JSON.parse(readFileSync(join(HERE, 'questions.json'), 'utf8')).filter(q => !IDS || IDS.includes(q.id)).slice(FROM, FROM + N)
const researcher = readFileSync(join(KIT, 'agents', 'researcher.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '').replace(/^Voice:.*$/m, '').trim()
const TAIL = 'Give the direct answer first, then cite each claim with a URL and a short quote from that page.'
// The new arm reads the skill file directly: in the first run sonnet never called the Skill tool.
const prompts = {
  baseline: q => `${researcher}\n\nQuestion: ${q}\n\n${TAIL}`,
  new: q => `Read .claude/skills/deep-research/SKILL.md and follow it at ${LEVEL} level. Do not write to the vault.\n\nQuestion: ${q}\n\n${TAIL}`,
}
const TOOLS = 'WebSearch,WebFetch,Read,Glob,Grep,Skill'

// No user config, rules or plugins: only what the workspace .claude/ holds.
function claude(cwd, model, prompt, tools, turns) {
  const env = { ...process.env }; delete env.CLAUDECODE
  const args = ['-p', prompt, '--model', model, '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--allowedTools', tools, '--max-turns', String(turns)]
  return new Promise(res => execFile('claude', args, { cwd, env, maxBuffer: 64 << 20, timeout: 900_000 }, (err, stdout) => {
    const events = String(stdout).split('\n').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
    const used = events.flatMap(e => e.type === 'assistant' ? e.message.content.filter(c => c.type === 'tool_use').map(c => c.name) : [])
    const j = events.findLast(e => e.type === 'result')
    if (j) res({ text: j.result ?? '', cost: j.total_cost_usd ?? 0, error: j.is_error, tools: used })
    else res({ text: String(stdout || err?.message || ''), cost: 0, error: true, tools: used })
  }))
}

const judgePrompt = (q, gold, answer) => `You grade a research answer. Question: ${q}
Gold answer: ${gold}
Candidate answer:
<<<
${answer}
>>>
1. correct: 1 if the candidate's direct answer matches the gold answer in substance, else 0.
2. ${CLAIMS === 'all' ? 'List every cited claim in the answer' : `Pick up to ${CLAIMS} cited claims the answer depends on`} (claim plus its URL). WebFetch each URL and set supported: 1 only if the page states that claim. A claim with no URL, or a page that fails to load, is 0. No citations means claims is [].
Reply with only JSON: {"correct":0,"claims":[{"claim":"","url":"","supported":0}]}`

async function one(q, arm) {
  const cwd = mkdtempSync(join(tmpdir(), `dr-${arm}-`))
  try {
    // mkdirSync recursive returns the top dir it made, not the leaf, so build the path first.
    const skillDir = join(cwd, '.claude', 'skills', 'deep-research')
    if (arm === 'new') { mkdirSync(skillDir, { recursive: true }); cpSync(join(HERE, '..', 'SKILL.md'), join(skillDir, 'SKILL.md')) }
    const run = await claude(cwd, 'sonnet', prompts[arm](q.q), TOOLS, TURNS)
    const limited = /hit your/i.test(run.text)
    const graded = limited ? [] : await Promise.all(JUDGES.map(m => claude(cwd, m, judgePrompt(q.q, q.gold, run.text), 'WebFetch', JUDGE_TURNS).then(j => ({ model: m, ...parseJudge(j.text), cost: j.cost, tools: j.tools.length }))))
    if (graded.some(j => j.error)) console.log(`${q.id} ${arm}: judge gave no json`)
    const judgeCost = graded.reduce((n, j) => n + j.cost, 0)
    const row = { id: q.id, arm, limited, ...mergeJudges(graded), judges: graded, gold: goldMatch(run.text, q.aliases), cost: run.cost + judgeCost, runCost: run.cost, judgeCost, tools: run.tools, answer: run.text }
    console.log(`${q.id} ${arm}: correct ${row.correct} gold ${row.gold} cites ${row.supported}/${row.cited} $${row.cost.toFixed(3)}`)
    return row
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}

// Each question gets both arms before the next one starts. A usage limit ends the queue.
const queue = questions.flatMap(q => ['baseline', 'new'].map(arm => () => one(q, arm)))
const rows = []
let stop = false
// Saved after every row: a killed run used to lose every answer.
function save() {
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.arm.localeCompare(b.arm))
  const summary = summarize(rows), byJudge = summarize(perJudge(rows))
  writeFileSync(OUT, `${JSON.stringify({ date: new Date().toISOString(), level: LEVEL, models: { arms: 'sonnet', judges: JUDGES }, claims: CLAIMS, summary, byJudge, rows }, null, 2)}\n`)
  return { summary, byJudge }
}
await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length && !stop) { const r = await queue.shift()(); rows.push(r); save(); if (r.limited) stop = true } }))
const { summary, byJudge } = save()
console.table(summary)
console.table(byJudge)
