#!/usr/bin/env node
// self-improve: propose a capped edit to one kit file, A/B it headless on held-out evals, judge blind, verdict.
// node self-improve.mjs --target <kit file> --lessons <file> [--candidate <file>] [--budget 3] [--margin 0.1] [--dry-run]
// Never writes the target. Output goes to ~/.claude/self-improve/runs/<stamp>/.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.dirname(HERE)
const EVALS = path.join(SKILL, 'evals')
export const KILL = path.join(os.homedir(), '.claude', 'self-improve.off')
export const MAX_DIFF = 30

// Only kit agents, kit skills and rules.md. Never itself, settings, hooks, CLAUDE.md or permissions.
export function guardTarget(p) {
  const abs = path.resolve(p)
  if (abs.startsWith(SKILL + path.sep)) return 'refusing to edit self-improve itself (judge and evals are frozen)'
  if (/settings|hooks?[\/.]|CLAUDE\.md|AGENTS\.md|permission|\.json$/i.test(abs)) return 'settings, hooks, permissions and CLAUDE.md are off limits'
  if (!/\/kit\/(agents\/[\w-]+\.md|skills\/[\w-]+\/SKILL\.md|rules\.md)$/.test(abs)) return 'target must be kit/agents/<role>.md, kit/skills/<name>/SKILL.md or kit/rules.md'
  return null
}

const front = t => (t.match(/^---\n[\s\S]*?\n---\n/) || [''])[0]

// Frontmatter holds tools, model and permission fields: it must not change.
export function guardCandidate(base, cand) {
  if (front(base) !== front(cand)) return 'frontmatter changed (tools, model, permissions are frozen)'
  const n = diffLines(base, cand)
  if (n === 0) return 'candidate is identical to baseline'
  if (n > MAX_DIFF) return `diff is ${n} lines, cap is ${MAX_DIFF}`
  return null
}

// changed lines: +/- lines of a line LCS diff
export function diffLines(a, b) {
  const x = a.split('\n'), y = b.split('\n')
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  return x.length + y.length - 2 * dp[0][0]
}

// side: { [taskId]: { pass: [bool], turns, cost } }
export function decide(base, cand, margin = 0.1) {
  const rate = s => { const all = Object.values(s).flatMap(t => t.pass); return all.length ? all.filter(Boolean).length / all.length : 0 }
  const sum = (s, k) => Object.values(s).reduce((a, t) => a + (t[k] || 0), 0)
  const rb = rate(base), rc = rate(cand)
  const regressed = Object.keys(base).filter(id => cand[id] && base[id].pass.some((p, i) => p && !cand[id].pass[i]))
  const out = { baseline: rb, candidate: rc, regressed, baseCost: sum(base, 'cost'), candCost: sum(cand, 'cost'), baseTurns: sum(base, 'turns'), candTurns: sum(cand, 'turns') }
  if (Object.keys(cand).length < Object.keys(base).length) return { ...out, accept: false, why: 'candidate runs incomplete' }
  if (regressed.length) return { ...out, accept: false, why: `regressed on ${regressed.join(', ')}` }
  if (rc >= rb + margin) return { ...out, accept: true, why: `pass rate ${pc(rb)} -> ${pc(rc)}` }
  if (rc === rb && out.candCost <= 0.85 * out.baseCost && out.candTurns <= out.baseTurns)
    return { ...out, accept: true, why: `same pass rate, cost ${out.baseCost.toFixed(3)} -> ${out.candCost.toFixed(3)}` }
  return { ...out, accept: false, why: `no margin: ${pc(rb)} -> ${pc(rc)} (need +${pc(margin)})` }
}
const pc = x => (100 * x).toFixed(0) + '%'

export function loadTasks(target) {
  const role = path.basename(target).replace(/\.md$/, '') === 'SKILL' ? path.basename(path.dirname(target)) : path.basename(target, '.md')
  return JSON.parse(fs.readFileSync(path.join(EVALS, 'tasks.json'), 'utf8')).filter(t => t.target === role)
}

let spent = 0
// prompt goes on stdin: variadic flags like --disallowedTools would swallow a trailing arg
function claude(args, cwd, budget, prompt) {
  if (fs.existsSync(KILL)) throw new Error(`kill switch ${KILL} is set`)
  if (spent >= budget) throw new Error(`budget $${budget} used`)
  return new Promise((res, rej) => {
    const c = spawn('claude', ['-p', '--output-format', 'json', '--setting-sources', 'project', ...args], { cwd })
    let s = ''
    c.stdout.on('data', d => (s += d)); c.stderr.on('data', d => (s += d))
    c.stdin.end(prompt)
    c.on('close', () => {
      if (/hit your/i.test(s)) return rej(new Error('usage limit hit, stopping'))
      try { const j = JSON.parse(s.slice(s.indexOf('{'))); spent += j.total_cost_usd || 0; res(j) } catch { rej(new Error('bad claude output: ' + s.slice(0, 300))) }
    })
  })
}

// Workspace with the variant installed where Claude Code looks for it.
function workspace(dir, target, text) {
  fs.mkdirSync(dir, { recursive: true })
  const extra = []
  if (/\/agents\//.test(target)) {
    fs.mkdirSync(path.join(dir, '.claude/agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude/agents', path.basename(target)), text)
    // run the session as the role, on the role's own model; a main agent would skip the subagent
    extra.push('--agent', path.basename(target, '.md'))
  } else if (/SKILL\.md$/.test(target)) {
    const pd = path.join(dir, '..', path.basename(dir) + '-plugin'), name = path.basename(path.dirname(target))
    fs.mkdirSync(path.join(pd, '.claude-plugin'), { recursive: true })
    fs.mkdirSync(path.join(pd, 'skills', name), { recursive: true })
    fs.writeFileSync(path.join(pd, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'si-variant', version: '0.0.0' }))
    fs.writeFileSync(path.join(pd, 'skills', name, 'SKILL.md'), text)
    extra.push('--plugin-dir', pd)
  } else fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text)
  return extra
}

const pairs = async (jobs, f) => { const out = []; for (let i = 0; i < jobs.length; i += 2) out.push(...await Promise.all(jobs.slice(i, i + 2).map(f))); return out }

async function main() {
  const a = { budget: 3, margin: 0.1 }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) a[argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1]?.startsWith('--') || i + 1 >= argv.length ? true : argv[++i]
  a.budget = +a.budget; a.margin = +a.margin
  if (!a.target || !a.lessons) throw new Error('need --target and --lessons')
  if (fs.existsSync(KILL)) throw new Error(`kill switch ${KILL} is set; remove it to run`)
  const bad = guardTarget(a.target)
  if (bad) throw new Error(bad)
  const base = fs.readFileSync(a.target, 'utf8')
  const tasks = loadTasks(a.target), dev = tasks.filter(t => t.split === 'dev'), held = tasks.filter(t => t.split === 'heldout')
  if (!held.length) throw new Error('no held-out eval tasks for this target in evals/tasks.json')
  const run = path.join(os.homedir(), '.claude/self-improve/runs', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(run, { recursive: true })
  fs.writeFileSync(path.join(run, 'baseline.md'), base)
  console.log(`run dir ${run}\nheld-out: ${held.map(t => t.id).join(', ')}; budget $${a.budget}`)
  if (a.dryRun) return

  let cand
  if (a.candidate) cand = fs.readFileSync(a.candidate, 'utf8')
  else {
    // reflection: author sees target, lessons and dev tasks only, never held-out
    const prompt = `You improve one instruction file for a Claude Code agent. Apply only lessons that fit this file.\n\nFILE (${path.basename(a.target)}):\n<file>\n${base}</file>\n\nLESSONS:\n${fs.readFileSync(a.lessons, 'utf8')}\n\nEXAMPLE TASKS (dev):\n${dev.map(t => '- ' + t.prompt).join('\n')}\n\nRules: change at most ${MAX_DIFF} lines; keep the --- frontmatter byte for byte; terse dev-note prose; no em dashes. Reply with the full revised file inside <file></file> and nothing else.`
    const j = await claude(['--model', a.authorModel || 'opus', '--max-turns', '1'], fs.mkdtempSync(path.join(os.tmpdir(), 'si-author-')), a.budget, prompt)
    const m = (j.result || '').match(/<file>\n?([\s\S]*?)<\/file>/)
    if (!m) throw new Error('reflection gave no <file> block')
    cand = m[1]
  }
  if (!cand.endsWith('\n')) cand += '\n'
  fs.writeFileSync(path.join(run, 'candidate.md'), cand)
  fs.writeFileSync(path.join(run, 'candidate.diff'), spawnSync('diff', ['-u', path.join(run, 'baseline.md'), path.join(run, 'candidate.md')], { encoding: 'utf8' }).stdout)
  const reject = guardCandidate(base, cand)
  if (reject) { console.log('REJECT before bench: ' + reject); return }

  const jobs = held.flatMap(t => [['baseline', base], ['candidate', cand]].map(([side, text]) => ({ t, side, text })))
  const outs = await pairs(jobs, async ({ t, side, text }) => {
    const ws = path.join(run, 'ws', `${t.id}-${side}`)
    const extra = workspace(ws, a.target, text)
    const model = extra.includes('--agent') ? [] : ['--model', 'sonnet']
    const j = await claude([...model, '--max-turns', '20', '--disallowedTools', 'Bash,Write,Edit,WebFetch,WebSearch', ...extra], ws, a.budget, t.prompt)
    return { t, side, result: j.result || '', turns: j.num_turns, cost: j.total_cost_usd }
  })
  const judgeTpl = fs.readFileSync(path.join(EVALS, 'judge.md'), 'utf8')
  const judged = await pairs(outs, async o => {
    const prompt = judgeTpl.replace('{{task}}', o.t.prompt).replace('{{output}}', o.result).replace('{{checklist}}', o.t.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n'))
    const j = await claude(['--model', 'sonnet', '--max-turns', '1'], fs.mkdtempSync(path.join(os.tmpdir(), 'si-judge-')), a.budget, prompt)
    const m = (j.result || '').match(/\{[\s\S]*\}/)
    const pass = m ? JSON.parse(m[0]).pass.map(Boolean) : o.t.checklist.map(() => false)
    return { ...o, pass }
  })
  const side = s => Object.fromEntries(judged.filter(o => o.side === s).map(o => [o.t.id, { pass: o.pass, turns: o.turns, cost: o.cost }]))
  const verdict = { ...decide(side('baseline'), side('candidate'), a.margin), spent }
  fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify({ target: path.resolve(a.target), judged: judged.map(({ t, text, ...o }) => ({ id: t.id, ...o })), verdict }, null, 1))
  console.log(JSON.stringify(verdict, null, 1))
  console.log(verdict.accept ? `ACCEPT: file ${path.join(run, 'candidate.diff')} with todo_add for Kenneth to merge` : 'REJECT: ' + verdict.why)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1) })
