#!/usr/bin/env node
// Runs each role agent headless on each model over tasks with hidden scoring, then prints a table and a pick per role.
// --codex gpt-6-luna@high,gpt-5.6-terra@medium runs engineer and qa through codex exec instead (arms show as codex:model@effort)
// usage: bench.mjs [--models fable,opus,sonnet,haiku] [--efforts medium,xhigh] [--tasks t12,q3] [--roles engineer,qa,researcher] [--reps 1] [--jobs 2] [--out dir] [--report]
import { CLAUDE_SANDBOX, codexArgs } from './sandbox.mjs'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const TASKS = path.join(HERE, '..', 'tasks')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
// an arm is model or model@effort; --efforts crosses every model with each level
const EFFORTS = arg('efforts', '').split(',').filter(Boolean)
const CODEX = arg('codex', '').split(',').filter(Boolean).map(a => `codex:${a}`)
const MODELS = CODEX.length ? CODEX : arg('models', 'fable,opus,sonnet,haiku').split(',').flatMap(m => EFFORTS.length ? EFFORTS.map(e => `${m}@${e}`) : [m])
const ONLY = arg('tasks', '').split(',').filter(Boolean)
const tasksOf = role => ROLES[role].filter(t => (!ONLY.length || ONLY.includes(t)) && fs.existsSync(path.join(TASKS, t)))
const ROLES = {
  engineer: ['t8', 't9', 't10', 't11', 't12', 't13', 'p1', 'p2'], qa: ['q1', 'q2', 'q3'], researcher: ['r1', 'r2'], Explore: ['r1', 'r2'],
  designer: ['d1'], ops: ['o1'], growth: ['g1'],
}
const roles = arg('roles', (CODEX.length ? ['engineer', 'qa'] : Object.keys(ROLES)).join(',')).split(',').filter(r => ROLES[r])
const REPS = +arg('reps', 1), JOBS = +arg('jobs', 2)
function pythonRun(args, options) {
  if (process.platform !== 'win32') return spawnSync('python3', args, options)
  const result = spawnSync('py', ['-3', ...args], options)
  return result.error?.code === 'ENOENT' ? spawnSync('python', args, options) : result
}
const OUT = path.resolve(arg('out', path.join(os.homedir(), '.claude', 'model-bench')))
const AGENTS = path.join(os.homedir(), '.claude', 'agents')
const RESULTS = path.join(OUT, 'results.json')
const TOT = { t8: 8, t9: 7, t10: 7, t11: 8, t12: 23, t13: 17, p1: 80, p2: 55 }
// project tasks run long: bigger budget and timeout
const big = task => task.startsWith('p')
const total = task => TOT[task] ?? fs.readdirSync(path.join(TASKS, task, 'hidden')).map(f => fs.readFileSync(path.join(TASKS, task, 'hidden', f), 'utf8'))
  .reduce((n, s) => n + (s.match(/^\s*(?:def test_|(?:test|it)\()/gm) || []).length, 0)
const UNATTENDED = '\n\nYou are running unattended: nobody will answer questions, so decide and proceed. Work only inside the current directory. When finished, reply with a short summary.'

fs.mkdirSync(path.join(OUT, 'runs'), { recursive: true })
const results = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : []
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1))

// input goes over stdin so big judge prompts never hit the argv limit
// judge calls get their own process group so a timeout kills the whole claude tree;
// agent runs stay in ours so Ctrl-C stops them too
// runs skip prompts, so they get no secrets beyond the Claude and Codex sign-in
export const runEnv = (extra = {}, from = process.env) => ({ ...Object.fromEntries(Object.entries(from).filter(([k]) =>
  /^(ANTHROPIC|CLAUDE|OPENAI|CODEX)_/.test(k) || !/(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|_KEY$|^AWS_)/i.test(k))), ...extra })

function claude(args, cwd, ms = 20 * 60e3, input, env) {
  return new Promise(res => {
    const p = spawn('claude', args, { cwd, detached: !!input, env: runEnv(env), stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    if (input) p.stdin.end(input)
    let out = '', err = '', timedOut = false
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err = (err + d).slice(-2000) })
    const t = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, 'SIGKILL') } catch {} }, ms)
    p.on('close', () => {
      clearTimeout(t)
      try { res(JSON.parse(out)) } catch { res({ is_error: true, result: (timedOut ? `timed out after ${ms / 1000}s. ` : '') + (out || err).slice(-400) }) }
    })
  })
}

// same role headers as kit/agents/engineer-codex.md and qa-codex.md
const HEADER = {
  engineer: `You are the engineer. Read the code the task touches before changing it, write a failing test first when the repo has tests, make the smallest change that passes, and run the checks the repo's CLAUDE.md or AGENTS.md names.
Rules: never commit or push. No em dashes anywhere. Comments are terse dev notes, no stock phrases. Do not add agent artifacts (.claude/, CLAUDE.md, AGENTS.md, planning docs). Never touch port 3000 or processes you did not start.
End with a Report: Status (done, done with concerns, blocked), Changed (paths and lines), Checked (commands and results), Open.

`,
  qa: `You are qa. Run the tests and review the change the brief names. Change no files: no fixes, no new tests left behind, no formatting. Report only problems you verified by running or reading the code, each with path, line and how you confirmed it. Say plainly what you could not run.
Rules: never commit or push. No em dashes. Never touch port 3000 or processes you did not start; stop any server you start.
End with a Report: Status (done, done with concerns, blocked), Found (verified problems, paths and lines, or none), Checked (commands and results), Open.

`,
}
// codex prints "tokens used" then the count (with commas) at the end of its log
export const codexTokens = log => +(log.match(/tokens used\D*([\d,]+)/i)?.[1].replace(/,/g, '') ?? 0)

function codex(arm, role, prompt, cwd, ms) {
  const [m, e] = arm.slice(6).split('@')
  const last = path.join(os.tmpdir(), `mb-codex-${process.pid}-${Math.random().toString(36).slice(2)}`)
  return new Promise(res => {
    const p = spawn('codex', codexArgs(m, e, last), { cwd, detached: true, env: runEnv({ SWITCHBOARD_ROLE_RUN: `${role}-codex` }), stdio: ['pipe', 'pipe', 'pipe'] })
    p.stdin.end(HEADER[role] + prompt)
    let log = '', timedOut = false
    const add = d => { log = (log + d).slice(-20000) }
    p.stdout.on('data', add); p.stderr.on('data', add)
    const t = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, 'SIGKILL') } catch {} }, ms)
    p.on('close', code => {
      clearTimeout(t)
      const text = fs.existsSync(last) ? fs.readFileSync(last, 'utf8') : ''
      fs.rmSync(last, { force: true })
      const bad = timedOut ? `timed out after ${ms / 1000}s` : code !== 0 || !text ? `codex exit ${code}: ${log.slice(-300)}` : ''
      res({ is_error: !!bad, result: bad && !text ? bad : text, tokens: codexTokens(log), limit: /usage limit|hit your/i.test(log) })
    })
  })
}

const tap = s => +(s.match(/^# pass (\d+)/m)?.[1] ?? 0)

function scoreEngineer(task, dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'))
  fs.cpSync(dir, tmp, { recursive: true, filter: s => !/(node_modules|\.venv|__pycache__|\.claude)$/.test(s) })
  const hidden = path.join(TASKS, task, 'hidden')
  for (const f of fs.readdirSync(hidden)) fs.copyFileSync(path.join(hidden, f), path.join(tmp, f))
  let ok
  if (fs.existsSync(path.join(hidden, 'hidden.test.ts'))) {
    ok = tap(spawnSync('node', ['--test', '--test-reporter=tap', 'hidden.test.ts'], { cwd: tmp, encoding: 'utf8', timeout: 300e3 }).stdout)
  } else {
    const r = pythonRun(['-W', 'ignore', '-m', 'unittest', 'test_hidden'], { cwd: tmp, encoding: 'utf8', timeout: 600e3 })
    const ran = +(r.stderr.match(/Ran (\d+) test/)?.[1] ?? 0)
    const bad = [...r.stderr.matchAll(/(?:failures|errors)=(\d+)/g)].reduce((a, m) => a + +m[1], 0)
    ok = Math.max(ran - bad, 0)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  return Math.min(ok, total(task)) / total(task)
}

// files the run created or changed, for judging work that lives in files; all = every file (the task's inputs)
function changedFiles(task, dir, cap = 60e3, all = false) {
  const ws = path.join(TASKS, task, 'ws'), out = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.claude|node_modules|__pycache__|\.git)$/.test(e.name)) walk(p); return }
    if (!/\.(html?|css|m?[jt]sx?|md|txt|json|ya?ml|py|csv)$/i.test(e.name)) return // screenshots and other binaries
    const rel = path.relative(dir, p), orig = path.join(ws, rel), now = fs.readFileSync(p, 'utf8')
    if (all || !fs.existsSync(orig) || fs.readFileSync(orig, 'utf8') !== now) out.push(`--- ${rel}\n${now.slice(0, 20e3)}`)
  })
  walk(dir)
  return out.join('\n\n').slice(0, cap)
}

// q* tasks are reviews graded by Sonnet with a false-positive penalty; other rubric tasks are work graded by Opus
async function scoreQa(task, text, runDir) {
  const rubric = fs.readFileSync(path.join(TASKS, task, 'rubric.md'), 'utf8')
  const max = rubric.match(/^\d+\./gm).length
  const review = task.startsWith('q')
  const prompt = review
    ? `You grade a code review against a fixed rubric. Rubric:\n\n${rubric}\n\nReview to grade:\n\n<review>\n${text}\n</review>\n\nReply with only JSON: {"found": [rubric numbers the review names with the right cause], "false_positives": <count>}`
    // the judge has no tools: without the inputs inline it wrote fake tool calls to read BRIEF.md and looped to the timeout
    : `You grade finished work against a fixed rubric. Be strict: an item counts only when the work clearly meets it. You have no tools: everything you need is below, so count lengths yourself and answer in this one reply. Rubric:\n\n${rubric}\n\nTask given:\n\n${fs.readFileSync(path.join(TASKS, task, 'TASK.md'), 'utf8')}\n\nInput files as given to the worker:\n<inputs>\n${changedFiles(task, path.join(TASKS, task, 'ws'), 40e3, true)}\n</inputs>\n\nFinal reply:\n<reply>\n${text}\n</reply>\n\nFiles created or changed:\n<files>\n${changedFiles(task, runDir)}\n</files>\n\nReply with only JSON: {"found": [rubric numbers the work meets], "false_positives": 0}`
  let judgeCost = 0, last = ''
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-judge-'))
    const d = await claude(['-p', '--setting-sources', 'project', '--model', review ? 'sonnet' : 'opus', '--effort', 'low', '--output-format', 'json', '--tools', ''], dir, 150e3, prompt,
      // default effort let Opus think 4+ min counting words on d1/g1 (silent socket); low answers in ~6s, same verdicts
      { CLAUDE_CODE_MAX_RETRIES: '2' })
    fs.rmSync(dir, { recursive: true, force: true })
    judgeCost += d.total_cost_usd || 0
    last = String(d.result).slice(0, 200)
    try {
      const j = JSON.parse(String(d.result).match(/\{\s*"found"[\s\S]*?\}/)[0])
      const found = new Set(j.found.map(Number).filter(n => n >= 1 && n <= max)).size
      return { score: Math.max(0, found - 0.5 * (+j.false_positives || 0)) / max, judgeCost }
    } catch { /* judge reply not parseable, try once more */ }
  }
  return { score: 0, judgeCost, error: `judge reply not parseable: ${last}` }
}

function scoreResearcher(task, text) {
  const keys = JSON.parse(fs.readFileSync(path.join(TASKS, task, 'answers.json'), 'utf8'))
  const line = n => text.match(new RegExp(`A${n}\\s*:(.*)`, 'i'))?.[1] ?? ''
  return keys.filter((res, i) => res.every(r => new RegExp(r, 'i').test(line(i + 1)))).length / keys.length
}

let stopped = false
async function run({ role, model, task, rep }) {
  const id = `${role}-${model}-${task}-${rep}`
  if (stopped || results.some(r => r.id === id && !r.error)) return
  const dir = path.join(OUT, 'runs', id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.cpSync(path.join(TASKS, task, 'ws'), dir, { recursive: true })
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true })
  const isCodex = model.startsWith('codex:')
  const roleFile = isCodex ? '' : fs.readFileSync(path.join(AGENTS, `${role}.md`), 'utf8').replace(/^effort:.*\n/gm, "").replace(/^model:.*$/m, model.includes("@") ? `model: ${model.split("@")[0]}\neffort: ${model.split("@")[1]}` : `model: ${model}`)
  if (!isCodex) fs.writeFileSync(path.join(dir, '.claude', 'agents', `${role}.md`), roleFile)
  const rules = path.join(os.homedir(), '.claude', 'CLAUDE.md')
  if (!isCodex && fs.existsSync(rules)) fs.copyFileSync(rules, path.join(dir, '.claude', 'CLAUDE.md'))
  const prompt = fs.readFileSync(path.join(TASKS, task, 'TASK.md'), 'utf8') + UNATTENDED
  const t0 = Date.now()
  const d = isCodex ? await codex(model, role, prompt, dir, (big(task) ? 90 : 20) * 60e3) : await claude(['-p', prompt, '--agent', role, '--setting-sources', 'project', '--model', model.split('@')[0], ...(model.includes('@') ? ['--effort', model.split('@')[1]] : []),
    ...CLAUDE_SANDBOX, '--output-format', 'json', '--max-budget-usd', big(task) ? '25' : '6'], dir, (big(task) ? 90 : 20) * 60e3)
  const text = String(d.result ?? '')
  if (d.limit || /hit your|usage limit/i.test(text)) { stopped = true; console.log(`${id}: usage limit, stopping the queue`); return }
  const u = d.usage || {}
  const row = {
    id, role, model, task, rep, used: Object.keys(d.modelUsage || {}).join(','),
    cost: d.total_cost_usd || 0, wall: Math.round((Date.now() - t0) / 1000), turns: d.num_turns || 0,
    out: u.output_tokens || 0, tokens: d.tokens ?? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0),
    error: d.is_error ? text.slice(0, 200) : undefined, text: text.slice(0, 4000),
  }
  const has = f => fs.existsSync(path.join(TASKS, task, f))
  try {
    if (has('hidden')) row.score = scoreEngineer(task, dir)
    else if (has('rubric.md')) Object.assign(row, await scoreQa(task, text, dir))
    else row.score = scoreResearcher(task, text)
  } catch (err) { row.score = 0; row.error = `scoring failed: ${err.message}` }
  const i = results.findIndex(r => r.id === id)
  if (i >= 0) results[i] = row; else results.push(row)
  save()
  console.log(`${id}: score ${(row.score * 100).toFixed(0)}% cost $${row.cost.toFixed(2)} ${row.wall}s${row.error ? ' ERROR ' + row.error : ''}`)
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const sd = xs => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)))

function report() {
  const lines = []
  for (const role of roles) {
    const rows = MODELS.map(model => {
      const xs = results.filter(r => r.role === role && r.model === model && tasksOf(role).includes(r.task) && !r.error)
      return { model, n: xs.length, score: mean(xs.map(x => x.score)), sd: sd(xs.map(x => x.score)), cost: mean(xs.map(x => x.cost)), wall: mean(xs.map(x => x.wall)), out: mean(xs.map(x => x.out)), tok: mean(xs.map(x => x.tokens || 0)) }
    }).filter(r => r.n)
    if (!rows.length) continue
    const best = Math.max(...rows.map(r => r.score))
    // ponytail: 5 point tolerance with small n; widen or add reps when two models sit near the line
    const pick = rows.filter(r => r.score >= best - 0.05).sort((a, b) => a.cost - b.cost)[0]
    lines.push(`\n${role}`, `${'model'.padEnd(26)}${'n'.padStart(3)}${'score'.padStart(8)}${'sd'.padStart(6)}${'cost'.padStart(8)}${'wall'.padStart(7)}${'out tok'.padStart(9)}${'tokens'.padStart(10)}`)
    for (const r of rows) lines.push(`${r.model.padEnd(26)}${String(r.n).padStart(3)}${(r.score * 100).toFixed(0).padStart(7)}%${(r.sd * 100).toFixed(0).padStart(6)}${('$' + r.cost.toFixed(2)).padStart(8)}${(r.wall.toFixed(0) + 's').padStart(7)}${r.out.toFixed(0).padStart(9)}${r.tok.toFixed(0).padStart(10)}${r === pick ? '  <- pick' : ''}`)
    const top = rows.find(r => r.score === best)
    if (top.score > pick.score) lines.push(`  ${top.model} scores ${((best - pick.score) * 100).toFixed(0)} points higher at ${(top.cost / pick.cost).toFixed(1)}x the cost`)
  }
  const text = lines.join('\n')
  fs.writeFileSync(path.join(OUT, 'report.txt'), text + '\n')
  console.log(text)
}

// --rescore re-judges finished rubric runs from their kept run dirs, no new sessions
if (process.argv.includes('--rescore')) {
  for (const r of results.filter(r => roles.includes(r.role) && tasksOf(r.role).includes(r.task) && fs.existsSync(path.join(TASKS, r.task, 'rubric.md')))) {
    // rows from before replies were kept have nothing to judge; keep their old score
    // agent-run errors stay for the next bench run to redo; a failed rejudge keeps the old score
    if (r.text === undefined) { console.log(`${r.id}: no saved reply, kept ${(r.score * 100).toFixed(0)}%`); continue }
    if (r.error && !r.error.startsWith('judge')) { console.log(`${r.id}: run failed, left for a rerun`); continue }
    const s = await scoreQa(r.task, r.text, path.join(OUT, 'runs', r.id))
    if (s.error && !r.error) { console.log(`${r.id}: ${s.error}, kept ${(r.score * 100).toFixed(0)}%`); continue }
    Object.assign(r, s); if (!s.error) delete r.error
    save(); console.log(`${r.id}: rescored ${(r.score * 100).toFixed(0)}%`)
  }
} else if (!process.argv.includes('--report')) {
  const queue = roles.flatMap(role => tasksOf(role).flatMap(task => MODELS.flatMap(model => Array.from({ length: REPS }, (_, i) => ({ role, model, task, rep: i + 1 })))))
  await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length) await run(queue.shift()) }))
}
report()
