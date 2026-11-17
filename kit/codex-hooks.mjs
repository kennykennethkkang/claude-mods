#!/usr/bin/env node
// One Codex hook for PreToolUse, PostToolUse and Stop, reusing the mods' own checks:
// bash-approve, repo-rules and account-guard on commands and patches, phone-mode on questions, done-check on the way out.
// Setup installs this file beside type-stripped .mjs copies of those mods (~/.codex/switchboard-guard),
// so it runs on plain Node and outlives a moved repo. From the repo it loads the .ts files (Node 22.6+).
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const GUARD_MODS = ['bash-approve', 'repo-rules', 'done-check', 'account-guard', 'phone-mode', 'paid-guard', 'tab-close']

/** Copies any repo file newer than its copy in `here`, mods type-stripped; the number copied. Needs Node 22.13+, else 0. */
export function refreshCopy(here, root) {
  const strip = nodeModule.stripTypeScriptTypes
  if (!strip || !existsSync(root)) return 0
  let n = 0
  for (const [to, from, ts] of [['codex-hooks.mjs', 'kit/codex-hooks.mjs', false], ...GUARD_MODS.map(m => [`${m}/hooks/register.mjs`, `${m}/hooks/register.ts`, true])]) {
    try {
      const src = join(root, from), dest = join(here, to)
      if (statSync(src).mtimeMs <= (statSync(dest, { throwIfNoEntry: false })?.mtimeMs ?? 0)) continue
      const text = readFileSync(src, 'utf8')
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, ts ? strip(text) : text)
      n++
    } catch { /* keep the old copy */ }
  }
  return n
}

// An installed copy follows the repo it came from, so mod edits reach Codex without rerunning setup.
try { refreshCopy(HERE, JSON.parse(readFileSync(join(HERE, 'source.json'), 'utf8')).root) } catch { /* run from the repo, or the repo is gone */ }

const modUrl = name => {
  const copy = join(HERE, name, 'hooks/register.mjs')
  return pathToFileURL(existsSync(copy) ? copy : join(HERE, '..', name, 'hooks/register.ts')).href
}

// Kept for when the mods fail to load, so a broken install still refuses the worst commands.
const FALLBACK = [
  [/\bsudo\b/, 'sudo'],
  [/\brm\s+(?:[^;&|]*\s)?(?:-[a-z]*r[a-z]*|--recursive)\b[^;&|]*\s["']?(?:\/|~|\$HOME|\$\{HOME\})\/?["']?(?=\s|$)/i, 'rm -r of / or ~'],
  [/\bgit\s+push\b(?=[^;&|]*(?:--force|\s-f\b|\s\+))[^;&|]*[\s:+]main(?=\s|$)/, 'force push to main'],
  [/\bdiskutil\s+(?:erase|zero)|\bmkfs\b|\bdd\s+[^;&|]*of=\/dev\//, 'disk erase'],
]
export const fallbackDeny = command => FALLBACK.find(([re]) => re.test(command))?.[1]

export let loadError
let hardDeny = command => fallbackDeny(command)
let bashRule = () => undefined, addsEmDash = () => false, rootsFor = () => [], isUnder = () => false
let decide, clisOf, targetOf, denial
let spendOf, ruleOf, ESTIMATE, FLOOR, CHECKS, thisMonth, openBrowsers, tabReason, waiting
let lastTurn, judge, noteTask, MAX_BLOCKS = 0
// Each mod loads on its own, so one broken copy leaves the others on.
const load = async (name, take) => {
  try { take(await import(modUrl(name))) } catch (e) {
    loadError ??= e
    process.stderr.write(`codex-hooks: ${name} did not load (${e?.message ?? e}). Rerun kit/setup.mjs --codex-hooks-only.\n`)
  }
}
await load('bash-approve', m => ({ hardDeny } = m))
await load('repo-rules', m => ({ bashRule, addsEmDash, rootsFor, isUnder } = m))
await load('done-check', m => ({ lastTurn, judge, noteTask, MAX_BLOCKS } = m))
await load('account-guard', m => ({ decide, clisOf, targetOf } = m))
await load('phone-mode', m => ({ denial } = m))
await load('paid-guard', m => ({ spendOf, ruleOf, ESTIMATE, FLOOR, CHECKS, thisMonth } = m))
await load('tab-close', m => ({ openBrowsers, reason: tabReason, waiting } = m))

const SHELLS = new Set(['Bash', 'exec_command', 'shell', 'local_shell', 'unified_exec', 'container.exec'])
const PATCH_FILE = /^\*\*\* (?:Add|Update) File:\s*(.+?)\s*$/
const PATCH_MOVE = /^\*\*\* Move to:\s*(.+?)\s*$/

const commandOf = i => {
  const c = i?.command ?? i?.cmd
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : ''
}

/** The new text per file in an apply_patch body: its + lines. */
function patchAdds(text) {
  const files = new Map()
  let cur = []
  const open = f => { if (!files.has(f)) files.set(f, []); cur.push(f) }
  for (const l of text.split('\n')) {
    const m = PATCH_FILE.exec(l)
    const mv = PATCH_MOVE.exec(l)
    // A move's new text lands at the destination; the source is judged too.
    if (m) { cur = []; open(m[1]) }
    else if (mv) open(mv[1])
    else if (/^\*\*\* /.test(l)) cur = []
    else if (l.startsWith('+')) for (const f of cur) files.get(f).push(l.slice(1))
  }
  return files
}

const readJson = f => { try { const v = JSON.parse(readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

// account-guard's folder for pick.mjs: the repo this copy came from, else the one beside this file.
const accountRoot = () => {
  try { const r = join(JSON.parse(readFileSync(join(HERE, 'source.json'), 'utf8')).root, 'account-guard'); if (existsSync(r)) return r } catch { /* run from the repo */ }
  return join(HERE, '..', 'account-guard')
}

/** account-guard on a shell command. Codex cannot rewrite a command, so a fix comes back as a refusal to rerun with it. */
function accountGuard(command, cwd, home) {
  if (!decide) return undefined
  const dir = process.env.ACCOUNT_GUARD_DIR || join(home, '.claude', 'switchboard')
  const logins = readJson(join(dir, 'logins.json'))
  const apps = Array.isArray(logins.apps) ? logins.apps.filter(a => isObj(a) && typeof a.id === 'string') : []
  if (!clisOf(command, apps.map(a => a.id)).length) return undefined
  const prefs = readJson(join(dir, 'aws-prefs.json'))
  let config = ''
  try { config = readFileSync(process.env.AWS_CONFIG_FILE || join(home, '.aws', 'config'), 'utf8') } catch { /* no aws config */ }
  const profiles = [...config.matchAll(/^\[(?:profile\s+([^\]]+)|(default))\]/gm)].map(m => (m[1] ?? m[2]).trim())
  let top = targetOf(command, cwd, home)
  for (let d = top; d.length > home.length && d !== '/'; d = dirname(d)) if (existsSync(join(d, '.git'))) { top = d; break }
  const r = decide(command, cwd, home, { projects: isObj(prefs.projects) ? prefs.projects : {}, links: isObj(logins.links) ? logins.links : {}, apps, profiles }, accountRoot(), top)
  if (!r) return undefined
  if ('deny' in r) return r.deny
  return r.command ? `account-guard: rerun it as: ${r.command}` : undefined
}

/** phone-mode: with the Phone toggle on, a Codex question becomes a call, except the closing Approve question and indefinite chats. */
function phoneGuard(p, home) {
  if (!denial) return undefined
  const dir = join(home, '.claude', 'switchboard')
  if (readJson(join(dir, 'limits.json')).phone !== true) return undefined
  if (p.session_id && readJson(join(dir, 'indefinite.json'))[p.session_id] !== undefined) return undefined
  const input = isObj(p.tool_input) ? p.tool_input : {}
  const qs = Array.isArray(input.questions) ? input.questions : []
  if (qs.some(q => String(q?.question ?? '').includes('Approve this chat as finished'))) return undefined
  return denial(input)
}

// Codex asks through the switchboard MCP; AskUserQuestion is a Claude tool.
const forCodex = s => s?.replace(/AskUserQuestion if you are the lead, mcp__switchboard__ask if you are a subagent/g, 'mcp__switchboard__ask').replace(/AskUserQuestion/g, 'mcp__switchboard__ask')
const isAsk = name => /^(?:request_user_input(?:_async)?|mcp__switchboard__ask|switchboard[./]ask)$/.test(name)

/** A refusal reason for a Codex PreToolUse payload, or undefined to let it run. */
export const preToolUse = (p, home = homedir()) => forCodex(preToolUseRaw(p, home))

function preToolUseRaw(p, home) {
  const name = p.tool_name ?? ''
  if (SHELLS.has(name)) {
    const command = commandOf(p.tool_input)
    const why = hardDeny(command, { cwd: p.cwd, home })
    if (why) return `bash-approve: always refused (${why}). Do it another way or ask Kenneth to run it.`
    const rule = bashRule(command)
    if (rule) return `repo-rules: ${rule.why}`
    return accountGuard(command, p.cwd ?? process.cwd(), home)
  }
  if (isAsk(name)) return phoneGuard(p, home)
  if (name === 'apply_patch') {
    const input = p.tool_input
    const text = typeof input === 'string' ? input : Object.values(input ?? {}).filter(v => typeof v === 'string').join('\n')
    const roots = rootsFor(home)
    for (const [file, added] of patchAdds(text)) {
      const path = isAbsolute(file) ? file : resolve(p.cwd ?? '', file)
      if (isUnder(path, roots) && addsEmDash('', added.join('\n'))) return 'repo-rules: an em dash in the new text. Use a comma, a colon, or "to".'
    }
  }
  return undefined
}

const FAILED = /exit(?:ed)?(?: with)? code[:\s]+(\d+)/i
// A hook refusal opens with its mod's name; done-check must not read it as a check result.
const DENIED = /^(repo-rules|bash-approve|paid-guard|usage-meter|chat-wait|tab-close|phone-mode|done-check|git-guard|account-guard):/
const failed = out => { const code = FAILED.exec(out); return DENIED.test(out.trimStart()) || (code ? code[1] !== '0' : false) }
const patchFiles = text => [...String(text).matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s*(.+?)\s*$/gm)].map(m => m[1])
const patchText = v => typeof v === 'string' ? v : Object.values(v ?? {}).filter(x => typeof x === 'string').join('\n')

/** A Codex rollout as the Claude-style rows done-check's lastTurn reads. */
export function rolloutRows(text) {
  const rows = []
  let cwd
  const use = (id, name, input) => rows.push({ type: 'assistant', cwd, message: { content: [{ type: 'tool_use', id, name, input }] } })
  // One Edit per patched file, so done-check can tell repo work from scratch files.
  const patch = (id, body) => { const f = patchFiles(patchText(body)); for (const x of f.length ? f : [undefined]) use(id, 'Edit', x ? { file_path: x } : {}) }
  text.split('\n').forEach((line, i) => {
    let o
    try { o = JSON.parse(line) } catch { return }
    const p = o?.payload ?? {}
    if ((o.type === 'session_meta' || o.type === 'turn_context') && typeof p.cwd === 'string') cwd = p.cwd
    if (o.type === 'event_msg' && p.type === 'user_message') {
      rows.push({ type: 'user', uuid: String(i), message: { content: String(p.message ?? '') } })
    } else if (o.type === 'response_item' && p.type === 'function_call') {
      let args = {}
      try { args = JSON.parse(p.arguments) } catch { /* a cut line */ }
      if (SHELLS.has(p.name)) use(p.call_id, 'Bash', { command: commandOf(args) })
      else if (p.name === 'apply_patch') patch(p.call_id, args)
      else if (p.name === 'update_plan') use(p.call_id, 'TodoWrite', { todos: (args.plan ?? []).map(t => ({ content: t.step, status: t.status })) })
      else if (isAsk(p.name)) use(p.call_id, 'AskUserQuestion', {})
      else use(p.call_id, p.name, args)
    } else if (o.type === 'response_item' && p.type === 'custom_tool_call') {
      if (p.name === 'apply_patch') patch(p.call_id, p.input)
      else if (isAsk(p.name)) use(p.call_id, 'AskUserQuestion', {})
      else use(p.call_id, p.name, {})
    } else if (o.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) {
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      rows.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: p.call_id, content: out, is_error: failed(out) }] } })
    }
  })
  return rows
}

/** Claude-style rows for one finished inner tool call, from a PostToolUse payload. */
function postRows(p) {
  const name = p.tool_name ?? ''
  const input = p.tool_input
  const id = p.tool_use_id ?? String(Date.now())
  let use
  if (SHELLS.has(name)) use = { name: 'Bash', input: { command: commandOf(input) } }
  else if (name === 'apply_patch') use = { name: 'Edit', input: { file_path: patchFiles(patchText(input))[0] } }
  else if (name === 'update_plan') use = { name: 'TodoWrite', input: { todos: (input?.plan ?? []).map(t => ({ content: t.step, status: t.status })) } }
  else if (isAsk(name)) use = { name: 'AskUserQuestion', input: {} }
  else if (name.startsWith('mcp__')) use = { name, input: input ?? {} }
  else return []
  const out = typeof p.tool_response === 'string' ? p.tool_response : JSON.stringify(p.tool_response ?? '')
  return [
    { type: 'assistant', cwd: p.cwd, message: { content: [{ type: 'tool_use', id, ...use }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: failed(out) }] } },
  ]
}

const STATE = join(homedir(), '.claude', 'switchboard', 'codex-hooks')

/** Keeps what a turn did, per session, from PostToolUse: code mode hides the edits and commands from the rollout. */
export function post(p, { dir = STATE } = {}) {
  const rows = postRows(p)
  if (!rows.length || !p.session_id) return
  const file = join(dir, `${p.session_id}.jsonl`)
  let seen
  try { seen = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(l => l.includes('"turn"')).pop()).uuid } catch { /* first call, or a cut line */ }
  const head = seen === p.turn_id ? [] : [{ type: 'user', uuid: p.turn_id, message: { content: 'turn' } }]
  try { mkdirSync(dir, { recursive: true }); appendFileSync(file, [...head, ...rows].map(r => `${JSON.stringify(r)}\n`).join('')) } catch { /* the rollout still backs Stop */ }
}

/** done-check's hold for a Codex Stop payload: { decision, reason }, or undefined to let the turn end. */
export function stop(p, { dir = STATE, read = f => readFileSync(f, 'utf8') } = {}) {
  if (!judge) return undefined
  let rows
  try { rows = readFileSync(join(dir, `${p.session_id}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r && typeof r === 'object' && r.message) } catch { rows = [] }
  if (!rows.some(r => r.uuid === p.turn_id)) {
    try { rows = rolloutRows(read(p.transcript_path)) } catch { return undefined }
  }
  const turn = lastTurn(rows.map(r => JSON.stringify(r)).join('\n'), p.cwd ?? '')
  const tasks = new Map()
  for (const r of rows) for (const b of r.message.content) if (b?.type === 'tool_use' && b.name === 'TodoWrite') noteTask(tasks, 'TodoWrite', b.input, undefined)
  const v = judge(turn, p.last_assistant_message ?? '', [...tasks.values()])
  const file = join(dir, 'blocks.json')
  let all = {}
  try { all = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first hold */ }
  if (!all || typeof all !== 'object' || Array.isArray(all)) all = {}
  const key = `${p.session_id}:${turn.key}`
  const n = all[key] ?? 0
  const block = v.block && n < MAX_BLOCKS
  if (block) all[key] = n + 1
  // ponytail: the 200 newest turns kept, by insertion.
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-200)))) } catch { /* the hold still goes out */ }
  return block ? { decision: 'block', reason: `done-check: not finished yet. ${v.reason}` } : undefined
}

const PENDING_MS = 10 * 60_000
const CAP_MS = 10 * 60_000

// Key where Switchboard saved it: the env, the Keychain, or keys/<NAME>. Never logged.
const secretOf = (dir, name) => {
  if (process.env[name]) return process.env[name]
  try { const k = execFileSync('security', ['find-generic-password', '-s', 'switchboard', '-a', name, '-w'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (k) return k } catch { /* no keychain entry */ }
  try { return readFileSync(join(dir, 'keys', name), 'utf8').trim() || undefined } catch { return undefined }
}

const withTimeout = (ms, f) => Promise.race([f(), new Promise(r => setTimeout(() => r(undefined), ms))]).catch(() => undefined)
const httpGet = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) })
  return { ok: res.ok, text: await res.text() }
}

/** The provider's own cap check for a key, cached ten minutes in the state dir (each hook call is a new process). */
async function providerCap(key, { dir, state, now, fetch: get, secret }) {
  const file = join(state, 'paid-caps.json')
  const all = readJson(file)
  if (all[key] && now - all[key].at < CAP_MS) return all[key].cap
  const c = CHECKS[key]
  let cap
  const k = c && secret(c.env)
  if (!c) cap = { capped: false, why: 'this provider has no API to confirm a spend limit' }
  else if (!k) cap = { capped: false, why: `no ${c.env} saved to check its limit` }
  else {
    const ask = async ({ url, read }) => {
      const res = await withTimeout(4500, () => get(url, c.auth(k)))
      if (!res?.ok) return { capped: false, why: `the ${key} limit check did not answer` }
      try { return read(JSON.parse(res.text)) } catch { return { capped: false, why: `the ${key} limit check answered oddly` } }
    }
    cap = await ask(c)
    if (!cap.capped && c.next) cap = await ask(c.next)
  }
  try { mkdirSync(state, { recursive: true }); writeFileSync(file, JSON.stringify({ ...all, [key]: { at: now, cap } })) } catch { /* checked again next call */ }
  return cap
}

/** Tells the hub window for this folder what the guard did; silent when none holds it. */
async function reportHub(home, cwd, action, detail, sessionId) {
  const dir = join(home, '.claude', 'switchboard')
  let best
  try {
    for (const f of (await import('node:fs')).readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'workspaces.json') continue
      const j = readJson(join(dir, f))
      const w = typeof j.workspace === 'string' ? j.workspace.replace(/\/+$/, '') : ''
      if (typeof j.port !== 'number' || typeof j.hubToken !== 'string' || !w || (cwd !== w && !cwd.startsWith(`${w}/`))) continue
      if (!best || w.length > best.w.length) best = { port: j.port, token: j.hubToken, w }
    }
  } catch { return }
  if (!best) return
  await withTimeout(2000, () => fetch(`http://127.0.0.1:${best.port}/hub`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: best.token, kind: 'guard', mod: 'paid-guard', action, detail, sessionId }) }))
}

/**
 * paid-guard for a Codex PreToolUse payload: a refusal reason, or undefined to let it run. A call that needs Kenneth is refused once
 * with the question to ask; the retry within ten minutes goes through (a speed bump like the hub's edit guard, since a hook cannot ask).
 * ponytail: a retry cannot be tied to his answer; an ask round through the hub would, if this ever needs to be a boundary.
 */
export async function paidGuard(p, { home = homedir(), now = Date.now(), fetch: get = httpGet, key } = {}) {
  if (!spendOf) return undefined
  const name = p.tool_name ?? ''
  const input = isObj(p.tool_input) ? p.tool_input : {}
  const spend = SHELLS.has(name) ? spendOf('Bash', { command: commandOf(input) }) : spendOf(name, input)
  if (!spend) return undefined
  const dir = join(home, '.claude', 'switchboard')
  const state = join(dir, 'codex-hooks')
  const sid = p.session_id
  const mark = `${sid}:${spend.key}`
  const pending = readJson(join(state, 'paid-pending.json'))
  const save = (file, v) => { try { mkdirSync(state, { recursive: true }); writeFileSync(join(state, file), JSON.stringify(v)) } catch { /* the call still goes out */ } }
  const month = new Date(now).toISOString().slice(0, 7)
  const used = () => { const f = readJson(join(dir, 'spend.json')); return f.month === month && isObj(f.keys) ? f : { month, keys: {} } }
  const count = () => {
    const f = used(), k = f.keys[spend.key] ?? { calls: 0, usd: 0 }
    f.keys[spend.key] = { calls: k.calls + 1, usd: Math.round((k.usd + (ESTIMATE[spend.key] ?? 0)) * 100) / 100 }
    try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'spend.json'), JSON.stringify(f)) } catch { /* not counted */ }
  }
  // The same rules as the mod's needsAsk.
  const rule = ruleOf(readJson(join(dir, 'spend-policy.json')), spend.key)
  let why
  if (rule.mode === 'ask') why = `This call is ${spend.what}. Run it?`
  else if (rule.mode === 'cap') {
    const spent = used().keys[spend.key]?.usd ?? 0, cap = rule.monthlyUsd ?? 0
    if (spent + (ESTIMATE[spend.key] ?? 0) > cap) why = `This call is ${spend.what}. It would pass this month's $${cap.toFixed(2)} cap ($${spent.toFixed(2)} used so far). Run it?`
  } else {
    const cap = await providerCap(spend.key, { dir, state, now, fetch: get, secret: key ?? (n => secretOf(dir, n)) })
    if (!cap.capped) why = `This call is ${spend.what}. No spend limit confirmed: ${cap.why}. Run it?`
    else if (cap.left !== undefined && cap.left < FLOOR) why = `This call is ${spend.what}. Only $${cap.left.toFixed(2)} of its limit is left. Run it?`
  }
  const cwd = p.cwd ?? ''
  if (!why) { count(); await reportHub(home, cwd, 'allowed', `${spend.what} (auto)`, sid); return undefined }
  if (pending[mark] && now - pending[mark] < PENDING_MS) {
    delete pending[mark]; save('paid-pending.json', pending); count()
    await reportHub(home, cwd, 'allowed', `${spend.what} (retry after asking)`, sid)
    return undefined
  }
  save('paid-pending.json', { ...Object.fromEntries(Object.entries(pending).filter(([, at]) => now - at < PENDING_MS)), [mark]: now })
  await reportHub(home, cwd, 'asked', spend.what, sid)
  return `paid-guard: ${why} Ask Kenneth with mcp__switchboard__ask (options: Allow once, Deny). If he allows, run the same call again; if he denies, do not.`
}

const TAIL = 512 * 1024

/** tab-close's hold for a Codex Stop payload: browsers this chat opened and has not closed, read from the PostToolUse record, else the rollout. */
export function tabsHold(p, { dir = STATE, read = f => readFileSync(f, 'utf8') } = {}) {
  if (!openBrowsers) return undefined
  let text
  try { text = readFileSync(join(dir, `${p.session_id}.jsonl`), 'utf8') } catch { /* no record yet */ }
  if (!text) { try { text = rolloutRows(read(p.transcript_path)).map(r => JSON.stringify(r)).join('\n') } catch { return undefined } }
  const { cli, held } = openBrowsers(text.slice(-TAIL))
  for (const s of cli) spawnSync('agent-browser', ['--session', s, 'close'], { timeout: 5000, stdio: 'ignore' })
  if (!held.length || p.stop_hook_active || waiting((p.last_assistant_message ?? '').trim())) return undefined
  return tabReason(held)
}

async function main() {
  let p
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch { return }
  // ponytail: a crash in here lets the call through, but a shell command still meets the fallback list.
  try {
    if (p.hook_event_name === 'PreToolUse') {
      const why = preToolUse(p) ?? await paidGuard(p)
      if (why) deny(why)
    } else if (p.hook_event_name === 'PostToolUse') {
      post(p)
    } else if (p.hook_event_name === 'Stop') {
      const r = stop(p)
      const tabs = tabsHold(p)
      const reason = [r?.reason, tabs].filter(Boolean).join('\n')
      if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }))
    }
  } catch (e) {
    process.stderr.write(`codex-hooks: ${e?.message ?? e}\n`)
    const why = p.hook_event_name === 'PreToolUse' && SHELLS.has(p.tool_name ?? '') && fallbackDeny(commandOf(p.tool_input))
    if (why) deny(`bash-approve: always refused (${why}).`)
  }
}

const deny = why => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }))

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main()
