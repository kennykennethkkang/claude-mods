#!/usr/bin/env node
// Per-project Jev jobs: a Bash gate (PreToolUse), an AI-tell check on the diff (Stop), and the setup that
// drafts <project>-<job>.json presets and turns the hooks on for one repo only. Node 20+, no deps.
//
//   node jev-project.mjs guard            PreToolUse hook, reads the tool call on stdin
//   node jev-project.mjs tells            Stop hook, reads the stop event on stdin
//   node jev-project.mjs setup --folder D [--jobs done,gate,tells,route] [--force]
//   node jev-project.mjs status --folder D
//   node jev-project.mjs draft --folder D  the presets setup would write, printed
//
// A hook never auto-approves. On any error it prints nothing, which leaves Claude Code's own prompt in place.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const EM = String.fromCharCode(0x2014)
const API = 'https://openrouter.ai/api/alpha/decisions'
const MODEL = 'typesafe/jev-1.13'
const HOME = os.homedir()
const PRESETS = path.join(HOME, '.claude', 'jev-presets')
const LIVE = path.join(HOME, '.claude', 'switchboard', 'jev')
const ME = '"$HOME/.claude/skills/claude-x-jev/scripts/jev-project.mjs"'
export const JOBS = ['done', 'gate', 'tells', 'route']
const PRESETS_OF = { done: ['done'], gate: ['gate'], tells: ['tells'], route: ['route', 'findings'] }
const GATE_MS = 2000
const TELLS_MS = 4000
const TELLS_MAX = 40

export const slug = name => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

/** The nearest folder holding .git, as Switchboard's repoTop does; home never counts. */
export function repoTop(dir) {
  for (let d = path.resolve(dir); d !== HOME; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) break
  }
  return undefined
}
const projectOf = dir => slug(path.basename(repoTop(dir) ?? dir))

function loadPreset(name, cwd) {
  const dirs = [process.env.JEV_PRESET_DIR, cwd && path.join(cwd, '.claude', 'jev-presets'), PRESETS].filter(Boolean)
  for (const d of dirs) {
    try { return { ...JSON.parse(fs.readFileSync(path.join(d, `${name}.json`), 'utf8')), name } } catch { /* next */ }
  }
  return null
}

/** The key as jev.py finds it: env, then Switchboard's Keychain entry, then its saved file. Never printed. */
export function apiKey({ env = process.env, keysDir = path.join(HOME, '.claude', 'switchboard', 'keys') } = {}) {
  const name = 'OPENROUTER_API_KEY'
  if ((env[name] ?? '').trim()) return env[name].trim()
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', 'switchboard', '-a', name, '-w'], { encoding: 'utf8', env, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (out) return out
  } catch { /* not a Mac, or no entry */ }
  try { return fs.readFileSync(path.join(keysDir, name), 'utf8').trim() } catch { return '' }
}

/** One Decisions call, no retries: a hook has no time for them. */
export async function decide(state, questions, model, ms) {
  const key = apiKey()
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')
  const t0 = Date.now()
  const res = await fetch(API, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model ?? MODEL, state, questions }), signal: AbortSignal.timeout(ms),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { ...(await res.json()), _latency_s: (Date.now() - t0) / 1000 }
}

const nouls = (out, questions) => Object.fromEntries(Object.keys(questions).map(q => [q, out?.answers?.[q]?.noul]))
const barOf = (preset, q, fallback) => Number(preset.thresholds?.[q]?.high ?? fallback)

// Run records in the shape jev.py writes, so Switchboard reads hook runs beside chat runs.
function live(file, rows) {
  if (!fs.existsSync(path.dirname(LIVE))) return
  try {
    fs.mkdirSync(LIVE, { recursive: true })
    fs.appendFileSync(path.join(LIVE, file), rows.map(r => JSON.stringify(r) + '\n').join(''))
  } catch { /* the run still counts */ }
}
const defaultLog = (kind, r) => kind === 'gate'
  ? live('gate.jsonl', [{ t: 'gate', at: Date.now(), ...r }])
  : live(`${Date.now()}-${process.pid}.jsonl`, [
    { t: 'start', run: `${Date.now()}-${process.pid}`, cmd: kind, preset: r.preset, items: r.items, model: MODEL, questions: {}, display: [], at: Date.now() },
    { t: 'end', at: Date.now(), cost: r.cost, errors: r.errors, flagged: r.flagged },
  ])

// Commands that only print, with no flag that writes or runs something. Anything else goes to Jev.
const SAFE = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'pwd', 'echo', 'which', 'stat', 'du', 'df', 'whoami', 'cut', 'tr', 'jq', 'diff', 'cd', 'true', 'basename', 'dirname', 'realpath'])
const GIT_SAFE = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'shortlog', 'describe'])
const QUIET = new Set(['2>&1', '>&2', '2>/dev/null', '>/dev/null'])

/** True only when every part of the command plainly reads. Redirects, subshells, env prefixes and unknown flags go to Jev. */
export function readOnly(cmd) {
  const s = cmd.split(/[ \t]+/).filter(t => !QUIET.has(t)).join(' ')
  if (/[<>`]|\$\(/.test(s)) return false
  return s.split(/&&|\|\||[|;&\n]/).every(seg => {
    const [c, ...rest] = seg.trim().split(/\s+/)
    if (!c) return true
    // Global flags (-c, -C) come before the subcommand, so git with any of them goes to Jev.
    if (c === 'git') return GIT_SAFE.has(rest[0]) && !rest.some(a => /^(--output|--ext-diff|-O|--open-files)/.test(a))
    if (c === 'find') return !rest.some(a => /^-(exec|ok|delete|f)/.test(a))
    if (c === 'date') return rest.every(a => a.startsWith('+'))
    return SAFE.has(c)
  })
}

/** paid-guard's own spendOf, when that mod is on: it asks about those calls, so Jev stays out. */
export async function paidCovers(cmd) {
  try {
    const on = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')).enabledPlugins?.['paid-guard@kenneth-mods']
    if (!on) return false
    const where = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'))['kenneth-mods']?.installLocation
    const mod = await import(pathToFileURL(path.join(where, 'paid-guard', 'hooks', 'register.ts')).href)
    return Boolean(mod.spendOf('Bash', { command: cmd }))
  } catch { return false }
}

// Chats run in bypass mode, where "no decision" means no prompt, so a dead Jev still asks about these.
// ponytail: a short list of plain risks, not a parser; Jev is the real check.
const RISKY = /\bgit\s+(push|reset\s+--hard|clean\s+-\w*f\w*|branch\s+-D|stash\s+drop)\b|\brm\s+-\w*[rf]\w*\s+(?!-)(?!(\.\/)?(dist|out|build|\.next|node_modules|extension\/out|web\/\.next|web\/out)\/?(\s|$))|\b(kill|pkill|killall)\b|\b(vsce|ovsx|npm|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bclaude\s+-p\b|\bcodex\s+exec\b/

function fallback(cmd) {
  if (!RISKY.test(cmd)) return null
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Jev unavailable; this command looks risky' } }
}

/** PreToolUse: ask Kenneth when Jev rates a Bash command destructive, paid or prod over the bar; else no decision. */
export async function guard(input, deps = {}) {
  if (input?.tool_name !== 'Bash') return null
  const cmd = String(input.tool_input?.command ?? '')
  if (!cmd.trim() || readOnly(cmd)) return null
  if (await (deps.paid ?? paidCovers)(cmd)) return null
  const cwd = String(input.cwd ?? process.cwd())
  const preset = 'preset' in deps ? deps.preset : loadPreset(`${projectOf(cwd)}-gate`, cwd)
  if (!preset?.questions) return null
  let out
  try { out = await (deps.decide ?? decide)({ command: cmd.slice(0, 4000), cwd }, preset.questions, preset.model, GATE_MS) } catch { return fallback(cmd) }
  const checks = nouls(out, preset.questions)
  if (Object.values(checks).some(v => typeof v !== 'number')) return fallback(cmd)
  const risky = Object.entries(checks).filter(([q, v]) => v >= barOf(preset, q, 0.5))
  ;(deps.log ?? defaultLog)('gate', { preset: preset.name, tool: 'Bash', cwd: path.basename(cwd), decision: risky.length ? 'ask' : 'pass', checks, cost: out.usage?.cost, _latency_s: out._latency_s })
  if (!risky.length) return null
  const reason = `Jev rates this ${risky.map(([q, v]) => `${q} ${v.toFixed(2)}`).join(', ')}`
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }
}

/** Added lines of a unified diff: file, new line number, text. */
export function addedLines(diff) {
  const out = []
  let file, n = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
    if (h) { n = Number(h[1]); continue }
    if (!file) continue
    if (l.startsWith('+')) out.push({ file, line: n++, text: l.slice(1) })
    else if (l.startsWith(' ')) n++
  }
  return out
}

export const emDashes = diff => addedLines(diff).filter(l => l.text.includes(EM))

const words = s => (s.match(/[A-Za-z]{2,}/g) ?? []).length
const DOC = /\.(md|mdx|txt|rst)$/i

/** The added lines a person reads as prose: comments, quoted UI copy, doc text. */
export function proseLines(diff) {
  const out = []
  for (const l of addedLines(diff)) {
    const t = l.text.trim()
    if (DOC.test(l.file)) { if (words(t) >= 4) out.push({ ...l, kind: 'doc' }); continue }
    const c = /^(?:\/\/|#|\/\*+|\*|<!--|--)\s*(.*)/.exec(t) ?? /\s\/\/\s+(.*)$/.exec(t)
    if (c && words(c[1]) >= 4) { out.push({ ...l, kind: 'comment', text: c[1] }); continue }
    const s = [...t.matchAll(/(['"`])((?:(?!\1).){8,}?)\1|>([^<>{}]{8,})</g)].map(m => m[2] ?? m[3]).find(x => words(x) >= 4)
    if (s) out.push({ ...l, kind: 'copy', text: s.trim() })
  }
  return out
}

/** The fenced block after "Commit message:" in the chat's final answer. */
export const commitOf = text => /Commit message:\s*```[^\n]*\n([\s\S]*?)```/.exec(text ?? '')?.[1].trim() ?? ''

function lastAnswer(transcript) {
  try {
    const lines = fs.readFileSync(transcript, 'utf8').trim().split('\n').reverse()
    for (const l of lines) {
      const e = JSON.parse(l)
      if (e.type !== 'assistant') continue
      const text = (e.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (text) return text
    }
  } catch { /* no transcript */ }
  return ''
}

const SKIP = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(min\.js|map|vsix|lock|svg)$/
/** What this repo would commit: tracked changes against HEAD, plus untracked files git does not ignore. */
export function repoDiff(top) {
  const git = args => { try { return execFileSync('git', ['-C', top, ...args], { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }
  let diff = git(['diff', 'HEAD', '--no-color', '-U0'])
  for (const f of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(f => f && !SKIP.test(f))) {
    try {
      const body = fs.readFileSync(path.join(top, f), 'utf8')
      if (body.length > 100_000 || body.includes('\0')) continue
      const ls = body.split('\n')
      diff += `\ndiff --git a/${f} b/${f}\n+++ b/${f}\n@@ -0,0 +1,${ls.length} @@\n${ls.map(x => '+' + x).join('\n')}\n`
    } catch { /* unreadable */ }
  }
  // Only files that would be committed; lock files and maps are noise.
  return diff.split(/(?=^diff --git )/m).filter(part => !SKIP.test(/^\+\+\+ b\/(.*)$/m.exec(part)?.[1] ?? '')).join('')
}

/** Repo-relative paths this chat wrote, from the Edit, Write and MultiEdit calls in its transcript. */
export function editedFiles(transcript, top) {
  const out = new Set()
  let text = ''
  try { text = fs.readFileSync(transcript, 'utf8') } catch { return out }
  for (const l of text.split('\n')) {
    let e
    try { e = JSON.parse(l) } catch { continue }
    for (const b of Array.isArray(e?.message?.content) ? e.message.content : []) {
      const f = b?.type === 'tool_use' && ['Edit', 'Write', 'MultiEdit'].includes(b.name) ? b.input?.file_path : undefined
      if (typeof f === 'string') out.add(path.relative(top, path.resolve(top, f)))
    }
  }
  return out
}

const cacheFile = cwd => path.join(os.tmpdir(), `jev-tells-${createHash('sha1').update(cwd).digest('hex').slice(0, 12)}`)

/** Stop: block once with the lines to fix when the diff or commit message has em dashes or machine prose. */
export async function tells(input, deps = {}) {
  if (input?.stop_hook_active) return null
  const cwd = String(input?.cwd ?? process.cwd())
  const top = repoTop(cwd) ?? cwd
  const preset = 'preset' in deps ? deps.preset : loadPreset(`${projectOf(cwd)}-tells`, cwd)
  if (!preset) return null
  const diff = deps.diff ?? repoDiff(top)
  const commit = commitOf(input.last_assistant_message ?? (input.transcript_path ? lastAnswer(input.transcript_path) : ''))
  const commitLines = commit.split('\n').map((text, i) => ({ file: 'commit message', line: i + 1, text, kind: 'commit' })).filter(l => l.text.trim())
  // This chat's own files when its transcript names any in the diff, else the whole repo diff.
  const edited = input.transcript_path ? editedFiles(input.transcript_path, top) : new Set()
  const mine = addedLines(diff).some(l => edited.has(l.file)) ? l => edited.has(l.file) : () => true
  const dashes = [...emDashes(diff).filter(mine), ...commitLines.filter(l => l.text.includes(EM))]
  const seen = new Set()
  const prose = [...commitLines.filter(l => words(l.text) >= 2), ...proseLines(diff).filter(mine)].filter(l => !seen.has(l.text) && seen.add(l.text)).slice(0, TELLS_MAX)
  if (!dashes.length && !prose.length) return null
  const hash = createHash('sha1').update(diff + commit).digest('hex')
  const cache = deps.diff === undefined ? cacheFile(top) : undefined
  if (cache && !dashes.length) { try { if (fs.readFileSync(cache, 'utf8') === hash) return null } catch { /* first run */ } }
  const q = Object.keys(preset.questions)[0]
  let cost = 0, errors = 0
  const flagged = (await Promise.all(prose.map(async l => {
    try {
      const out = await (deps.decide ?? decide)({ text: l.text.slice(0, 600), kind: l.kind, file: l.file }, preset.questions, preset.model, TELLS_MS)
      cost += Number(out.usage?.cost ?? 0)
      const p = out.answers?.[q]?.noul
      return typeof p === 'number' && p >= barOf(preset, q, 0.7) ? { ...l, p } : null
    } catch { errors++; return null }
  }))).filter(Boolean)
  ;(deps.log ?? defaultLog)('tells', { preset: preset.name, items: prose.length, cost, errors, flagged: flagged.length + dashes.length })
  if (!dashes.length && !flagged.length) {
    if (cache && !errors) try { fs.writeFileSync(cache, hash) } catch { /* next stop checks again */ }
    return null
  }
  const cut = s => s.trim().slice(0, 140)
  const rows = [
    ...dashes.map(l => `- ${l.file}:${l.line} em dash: ${cut(l.text)}`),
    ...flagged.map(l => `- ${l.file}:${l.line} machine-sounding ${l.p.toFixed(2)}: ${cut(l.text)}`),
  ]
  return { decision: 'block', reason: `AI-tell check before finishing. Rewrite these as a terse dev would, or keep one and say why:\n${rows.join('\n')}` }
}

/** Stack, test command and the repo's own never-rules, for the drafts. */
export function repoInfo(dir, name) {
  const top = repoTop(dir) ?? dir
  const has = f => fs.existsSync(path.join(top, f))
  let pkg = {}
  try { pkg = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8')) } catch { /* not node */ }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const runner = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') ? 'bun' : 'npm'
  const test = pkg.scripts?.test ? `${runner} test`
    : has('pyproject.toml') || has('pytest.ini') ? 'pytest' : has('Cargo.toml') ? 'cargo test' : has('go.mod') ? 'go test ./...' : has('Package.swift') ? 'swift test' : ''
  const stack = [
    [has('package.json'), 'Node'], [deps.typescript || has('tsconfig.json'), 'TypeScript'], [deps.react, 'React'], [deps.next, 'Next.js'],
    [has('pyproject.toml') || has('requirements.txt'), 'Python'], [has('Cargo.toml'), 'Rust'], [has('go.mod'), 'Go'], [has('Package.swift'), 'Swift'],
  ].filter(([on]) => on).map(([, s]) => s).join(', ')
  let never = []
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    try {
      never.push(...fs.readFileSync(path.join(top, f), 'utf8').split('\n').map(l => l.replace(/^[-*\s]+/, '').trim()).filter(l => /\b(never|do not|don't)\b/i.test(l) && l.length < 200))
    } catch { /* none */ }
  }
  never = [...new Set(never)].slice(0, 6)
  return { project: slug(name ?? path.basename(top)), stack, test, never }
}

/** The five presets for one project, from the templates below. */
export function draftPresets({ project, stack, test, never = [] }) {
  const about = `${project}${stack ? ` (${stack})` : ''}`
  const band = (high = 0.8) => ({ low: 0.2, high })
  const own = never.length ? ` Breaking one of the repo's own rules also counts: ${never.join(' ')}` : ''
  const p = {
    done: {
      description: `Was one of Kenneth's requests to a ${about} chat carried out, judging by the chat's Done list. Used by Switchboard's done-check`,
      state_fields: ['request', 'done'], display_fields: ['_id'],
      questions: { addressed: { type: 'noul', instructions: `Does \`done\` show that \`request\` was carried out or answered? A code change counts when \`done\` names the change${test ? ` or a check that ran, such as ${test}` : ''}; a question counts when \`done\` gives the answer.` } },
      thresholds: { addressed: band() },
    },
    gate: {
      description: `Ask before a risky Bash command in ${about}. Each question asks when its yes probability reaches thresholds.high. Used by jev-project.mjs guard`,
      state_fields: ['command', 'cwd'], display_fields: [],
      questions: {
        destructive: { type: 'noul', instructions: `Running \`command\` in \`cwd\` deletes or overwrites work git cannot bring back (rm of untracked files or folders outside build output, git reset --hard, git clean, git checkout of changed files), rewrites shared git history (force push, branch -D), drops or truncates data, or kills processes it did not start.${own}` },
        paid: { type: 'noul', instructions: 'Running `command` spends money or credit: it calls a paid API, starts or resizes cloud resources, buys something, or sends calls, texts or emails through a paid service.' },
        prod: { type: 'noul', instructions: `Running \`command\` touches production or shared systems: it deploys, publishes a package or release, pushes to a shared remote, changes cloud or DNS settings, or writes to a live database. Running ${test || 'the tests'}, builds, linters and local dev servers inside \`cwd\` does not count.` },
      },
      thresholds: { destructive: band(0.5), paid: band(0.5), prod: band(0.5) },
    },
    tells: {
      description: `Flag a changed line in ${about} that reads as machine written. Used by jev-project.mjs tells before a chat finishes`,
      state_fields: ['text', 'kind', 'file'], display_fields: ['file'],
      questions: { machine_prose: { type: 'noul', instructions: '`text` is a `kind` line (comment, copy, doc or commit) from `file`. It reads as machine written rather than a terse developer note: stock words such as robust, seamless, leverage, delve, comprehensive, elevate, streamline or "worth noting"; a long prose header or banner; explanation a developer would leave out; marketing tone in a comment or commit. Short plain notes, code, names and UI labels are not.' } },
      thresholds: { machine_prose: band(0.7) },
    },
    route: {
      description: `Which role takes a task in ${about}: the lead's routing step`,
      state_fields: ['task'], display_fields: ['task'],
      questions: {
        role: {
          type: 'choice', instructions: `Pick the role that should do \`task\` in ${about}. The cue is the work's output: facts found, code changed, checks run, a screen designed, a note or setup written, or words for an audience.`,
          criteria: {
            researcher: 'Finding things out before work starts: which files, docs, APIs or web pages hold the answer, how something works now, options compared. Output is facts, not a change.',
            engineer: 'Changing code, config or build files so the project behaves differently: a feature, a fix, a refactor, a test written.',
            qa: 'Running the tests, reviewing a change that already exists, reproducing a reported bug, or confirming a fix works. Output is verified problems or a pass.',
            designer: 'How a screen looks or reads to use: layout, colour, type, motion, a mockup, UI copy placement, accessibility of the interface.',
            ops: 'Machines, accounts and process: deploys, servers, CI, keys, installs, notes and runbooks, cleanup, scheduling.',
            growth: 'Words and reach for people outside the code: marketing copy, a launch post, an email, a landing page message, pricing text.',
          },
        },
      },
      thresholds: { role: 0.7 },
    },
    findings: {
      description: `How bad a review finding in ${about} is, so qa's list is worked in order`,
      state_fields: ['finding', 'where'], display_fields: ['where'],
      questions: {
        severity: {
          type: 'choice', instructions: 'Read `finding` about the code at `where`. Decide how soon it must be fixed. The cue is what breaks for the user or the data if it ships as is.',
          criteria: {
            blocker: 'Ships broken: data loss, a security hole, a crash or a failing test on the main path, a secret exposed, money spent without asking.',
            major: 'A real bug on a path people use, wrong output, a missing error or loading state that strands the user, or a clear regression.',
            minor: 'Works but is wrong at the edges: an unhandled rare case, a confusing message, slow but usable, a missing test for risky code.',
            nit: 'Style, naming, a comment, a small cleanup or a taste call. Nothing behaves differently once fixed.',
          },
        },
      },
      thresholds: { severity: 0.7 },
    },
  }
  return Object.fromEntries(Object.entries(p).map(([job, x]) => [`${project}-${job}`, { name: `${project}-${job}`, version: 1, model: MODEL, ...x, rules: [] }]))
}

const settingsPath = top => path.join(top, '.claude', 'settings.local.json')
const HOOKS = { gate: ['PreToolUse', { matcher: 'Bash', hooks: [{ type: 'command', command: `node ${ME} guard`, timeout: 5 }] }], tells: ['Stop', { hooks: [{ type: 'command', command: `node ${ME} tells`, timeout: 60 }] }] }
const ours = (entry, sub) => (entry?.hooks ?? []).some(h => String(h.command ?? '').includes(`jev-project.mjs" ${sub}`))

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return {}; throw e } }

/** Writes missing presets (all with force), merges the hooks into the repo's own settings.local.json, guards .claude/. */
export function setup(folder, { presetDir = PRESETS, jobs = JOBS, force = false } = {}) {
  const top = repoTop(folder) ?? path.resolve(folder)
  const drafts = draftPresets(repoInfo(top))
  const project = Object.keys(drafts)[0].replace(/-done$/, '')
  const written = [], kept = []
  fs.mkdirSync(presetDir, { recursive: true })
  for (const job of jobs) for (const kind of PRESETS_OF[job] ?? []) {
    const name = `${project}-${kind}`, f = path.join(presetDir, `${name}.json`)
    if (fs.existsSync(f) && !force) { kept.push(name); continue }
    fs.writeFileSync(f, JSON.stringify(drafts[name], null, 2) + '\n')
    written.push(name)
  }
  const hooks = jobs.filter(j => HOOKS[j])
  if (hooks.length) {
    const s = readJson(settingsPath(top))
    s.hooks ??= {}
    for (const job of hooks) {
      const [event, entry] = HOOKS[job]
      s.hooks[event] = [...(s.hooks[event] ?? []).filter(e => !ours(e, job === 'gate' ? 'guard' : 'tells')), entry]
    }
    fs.mkdirSync(path.dirname(settingsPath(top)), { recursive: true })
    fs.writeFileSync(settingsPath(top), JSON.stringify(s, null, 2) + '\n')
    guardExclude(top)
  }
  return { project, written, kept, hooks, settings: hooks.length ? settingsPath(top) : undefined }
}

function guardExclude(top) {
  let f
  try { f = path.resolve(top, execFileSync('git', ['-C', top, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) } catch { return }
  const now = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  if (now.split('\n').some(l => l.trim() === '.claude/' || l.trim() === '.claude')) return
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, now + (now && !now.endsWith('\n') ? '\n' : '') + '.claude/\n')
}

/** Which jobs are on for a folder: its presets exist and, for the hook jobs, the hook sits in settings.local.json. */
export function jobsOn(folder, presetDir = PRESETS) {
  const top = repoTop(folder) ?? path.resolve(folder)
  const project = slug(path.basename(top))
  const has = kind => fs.existsSync(path.join(presetDir, `${project}-${kind}.json`))
  let s = {}
  try { s = readJson(settingsPath(top)) } catch { /* unreadable counts as off */ }
  const hooked = (event, sub) => (s.hooks?.[event] ?? []).some(e => ours(e, sub))
  return { done: has('done'), gate: has('gate') && hooked('PreToolUse', 'guard'), tells: has('tells') && hooked('Stop', 'tells'), route: has('route') }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const arg = k => { const i = rest.indexOf(`--${k}`); return i < 0 ? undefined : rest[i + 1] }
  if (cmd === 'guard' || cmd === 'tells') {
    try {
      let raw = ''
      for await (const c of process.stdin) raw += c
      const out = await (cmd === 'guard' ? guard : tells)(JSON.parse(raw || '{}'))
      if (out) process.stdout.write(JSON.stringify(out))
    } catch (e) { process.stderr.write(`[jev ${cmd}] ${e.message}\n`) }
    return
  }
  const folder = arg('folder') ?? process.cwd()
  if (cmd === 'setup') return console.log(JSON.stringify(setup(folder, { force: rest.includes('--force'), ...(arg('jobs') ? { jobs: arg('jobs').split(',') } : {}) }), null, 2))
  if (cmd === 'status') return console.log(JSON.stringify({ project: projectOf(folder), jobs: jobsOn(folder) }, null, 2))
  if (cmd === 'draft') return console.log(JSON.stringify(draftPresets(repoInfo(folder)), null, 2))
  console.error('usage: jev-project.mjs guard | tells | setup --folder D [--jobs done,gate,tells,route] [--force] | status --folder D | draft --folder D')
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
