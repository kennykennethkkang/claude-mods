// Codex hook script: the guards on PreToolUse and the done-check hold on Stop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUARD_MODS, fallbackDeny, refreshCopy, preToolUse, paidGuard, tabsHold, post, stop, rolloutRows } from './codex-hooks.mjs'
import { codexGuardFiles, codexRoleNames, mergeCodexHooks } from './kit.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const runHook = (file, payload) => spawnSync(process.execPath, ['--no-warnings', file], { input: JSON.stringify(payload), encoding: 'utf8' })

const EM = String.fromCharCode(0x2014)
const HOME = '/Users/k'
const bash = command => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: `${HOME}/Documents/GitHub/app`, tool_input: { command } })
const patch = (file, line) => ({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: `${HOME}/Documents/GitHub/app`, tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+${line}\n*** End Patch` } })

test('a hard-denied command is refused', () => {
  assert.match(preToolUse(bash('su' + 'do rm x'), HOME), /bash-approve/)
  assert.match(preToolUse(bash('cat .env'), HOME), /bash-approve/)
})

test('a repo-rules command is refused', () => {
  assert.match(preToolUse(bash('git ' + 'push origin main'), HOME), /repo-rules/)
})

test('a plain command passes', () => {
  assert.equal(preToolUse(bash('ls -la'), HOME), undefined)
})

test('exec_command carries the command as cmd', () => {
  assert.match(preToolUse({ tool_name: 'exec_command', cwd: '/x', tool_input: { cmd: 'su' + 'do ls' } }, HOME), /bash-approve/)
})

test('apply_patch adding an em dash under a repo is refused', () => {
  assert.match(preToolUse(patch(`${HOME}/Documents/GitHub/app/a.md`, `a ${EM} b`), HOME), /em dash/)
})

test('apply_patch with a relative path resolves against cwd', () => {
  assert.match(preToolUse(patch('a.md', `a ${EM} b`), HOME), /em dash/)
})

test('apply_patch em dash outside the roots, or without one, passes', () => {
  assert.equal(preToolUse(patch('/tmp/a.md', `a ${EM} b`), HOME), undefined)
  assert.equal(preToolUse(patch(`${HOME}/Documents/GitHub/app/a.md`, 'plain'), HOME), undefined)
})

test('an em dash on a context or removed line is not new text', () => {
  const p = patch(`${HOME}/Documents/GitHub/app/a.md`, 'x')
  p.tool_input.command = `*** Begin Patch\n*** Update File: a.md\n@@\n a ${EM} b\n-c ${EM} d\n+c, d\n*** End Patch`
  assert.equal(preToolUse(p, HOME), undefined)
})

// A rollout as Codex writes it.
const row = (type, payload) => JSON.stringify({ type, payload })
const user = message => row('event_msg', { type: 'user_message', message })
const call = (name, args, id) => row('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id })
const out = (id, code) => row('response_item', { type: 'function_call_output', call_id: id, output: `Chunk ID: 1\nProcess exited with code ${code}\nOutput:\nx` })
const edit = id => row('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch', call_id: id })
const stopPayload = (extra = {}) => ({ hook_event_name: 'Stop', session_id: 's1', transcript_path: 'r.jsonl', cwd: '/x', stop_hook_active: false, last_assistant_message: 'All set', ...extra })

test('rolloutRows maps tool calls onto the transcript rows done-check reads', () => {
  const rows = rolloutRows([user('go'), edit('c1'), call('exec_command', { cmd: 'npm test' }, 'c2'), out('c2', 1)].join('\n'))
  const flat = rows.flatMap(r => r.message.content).filter(b => typeof b === 'object')
  assert.deepEqual(flat.map(b => b.type), ['tool_use', 'tool_use', 'tool_result'])
  assert.equal(flat[0].name, 'Edit')
  assert.equal(flat[1].input.command, 'npm test')
  assert.equal(flat[2].is_error, true)
})

const go = (dir, lines, extra) => { const text = lines.join('\n'); return stop(stopPayload(extra), { dir, read: () => text }) }

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-hooks-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('Stop holds when files were edited after the last check', () => withDir(dir => {
  const r = go(dir, [user('fix it'), edit('c1')])
  assert.equal(r.decision, 'block')
  assert.match(r.reason, /done-check: not finished yet/)
}))

test('Stop lets an edit followed by a passing check through', () => withDir(dir => {
  const r = go(dir, [user('fix it'), edit('c1'), call('exec_command', { cmd: 'npm test' }, 'c2'), out('c2', 0), ask('c3')])
  assert.equal(r, undefined)
}))

test('Stop holds on open plan items', () => withDir(dir => {
  const plan = row('response_item', { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'ship', status: 'in_progress' }] }), call_id: 'p' })
  const r = go(dir, [user('x'), plan, edit('c1'), call('exec_command', { cmd: 'npm test' }, 'c2'), out('c2', 0)])
  assert.match(r.reason, /open tasks: ship/)
}))

test('Stop holds at most twice per turn, and stop_hook_active still counts', () => withDir(dir => {
  const lines = [user('fix it'), edit('c1')]
  assert.equal(go(dir, lines).decision, 'block')
  assert.equal(go(dir, lines, { stop_hook_active: true }).decision, 'block')
  assert.equal(go(dir, lines, { stop_hook_active: true }), undefined)
}))

test('Stop does not hold a turn that ends on a question', () => withDir(dir => {
  const r = go(dir, [user('x'), edit('c1')], { last_assistant_message: 'Which one do you want?' })
  assert.equal(r, undefined)
}))

// Code mode (Codex 0.165): the rollout holds one custom_tool_call "exec" whose input is JavaScript, so Stop relies on the inner PostToolUse events.
const codeMode = [
  user('Edit math.mjs to add a mul function.'),
  row('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'k1', input: 'const r = await tools.apply_patch("*** Begin Patch\\n*** Update File: math.mjs\\n@@\\n+export const mul = (a, b) => a * b\\n*** End Patch");\ntext(r);\n' }),
  row('response_item', { type: 'custom_tool_call_output', call_id: 'k1', output: [{ type: 'input_text', text: 'Script completed\nWall time 0.4 seconds\nOutput:\n' }, { type: 'input_text', text: '{}' }] }),
].join('\n')
const postOf = (tool_name, tool_input, tool_response, turn_id = 't1') => ({ hook_event_name: 'PostToolUse', session_id: 's1', turn_id, tool_use_id: `u-${Math.random()}`, tool_name, tool_input, tool_response })

test('code mode: an inner edit seen by PostToolUse holds Stop though the rollout shows only exec', () => withDir(dir => {
  assert.equal(go(dir, codeMode.split('\n'), { turn_id: 't1' }), undefined)
  post(postOf('apply_patch', { command: '*** Begin Patch\n*** Update File: math.mjs\n*** End Patch' }, '{}'), { dir })
  const r = go(dir, codeMode.split('\n'), { turn_id: 't1' })
  assert.equal(r.decision, 'block')
  assert.match(r.reason, /edited after the last test/)
}))

test('code mode: a passing check after the edit lets Stop through, a failing one does not', () => withDir(dir => {
  post(postOf('apply_patch', { command: 'x' }, '{}'), { dir })
  post(postOf('exec_command', { cmd: 'node --test' }, 'Process exited with code 0'), { dir })
  post(postOf('mcp__switchboard__ask', {}, 'ok'), { dir })
  assert.equal(go(dir, [], { turn_id: 't1' }), undefined)
}))

test('code mode: a failing check under a success claim holds', () => withDir(dir => {
  post(postOf('apply_patch', { command: 'x' }, '{}'), { dir })
  post(postOf('exec_command', { cmd: 'node --test' }, 'Process exited with code 1'), { dir })
  assert.equal(go(dir, [], { turn_id: 't1', last_assistant_message: 'done, fixed.' }).decision, 'block')
}))

test('a new turn starts clean', () => withDir(dir => {
  post(postOf('apply_patch', { command: 'x' }, '{}'), { dir })
  assert.equal(go(dir, [], { turn_id: 't2' }), undefined)
}))

test('a move patch is judged against the destination and the source', () => {
  const mv = (from, to) => ({ tool_name: 'apply_patch', cwd: `${HOME}/Documents/GitHub/app`, tool_input: { command: `*** Begin Patch\n*** Update File: ${from}\n*** Move to: ${to}\n@@\n+a ${EM} b\n*** End Patch` } })
  assert.match(preToolUse(mv('/tmp/a.md', `${HOME}/Documents/GitHub/app/b.md`), HOME), /em dash/)
  assert.match(preToolUse(mv(`${HOME}/Documents/GitHub/app/a.md`, '/tmp/b.md'), HOME), /em dash/)
  assert.equal(preToolUse(mv('/tmp/a.md', '/tmp/b.md'), HOME), undefined)
})

test('a state file of the wrong shape fails open', () => withDir(dir => {
  const lines = [user('fix it'), edit('c1')]
  for (const bad of ['null', '[]', '"x"', '7']) {
    writeFileSync(join(dir, 'blocks.json'), bad)
    assert.equal(go(dir, lines).decision, 'block')
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 's1.jsonl'), 'null\n7\n{"type":"user"')
  assert.doesNotThrow(() => go(dir, lines))
  assert.doesNotThrow(() => post(postOf('apply_patch', { command: 'x' }, '{}'), { dir }))
}))

test('codex roles skip the Codex-shelling agents', () => {
  assert.deepEqual(codexRoleNames(['engineer.md', 'engineer-codex.md', 'qa.md', 'qa-codex.md']), ['engineer.md', 'qa.md'])
})

test('mergeCodexHooks keeps other handlers that share a group with the old entry', () => {
  const other = { type: 'command', command: 'node other.js' }
  const mixed = { hooks: { Stop: [{ matcher: 'x', hooks: [other, { type: 'command', command: 'node "/old/codex-hooks.mjs"' }] }] } }
  const r = mergeCodexHooks(mixed, 'node "/k/codex-hooks.mjs"')
  assert.deepEqual(r.hooks.Stop[0], { matcher: 'x', hooks: [other] })
  assert.equal(r.hooks.Stop.length, 2)
})

test('mergeCodexHooks adds one entry per event, keeps the others, and is idempotent', () => {
  const sb = { hooks: [{ type: 'command', command: 'node hook.js', timeout: 2 }] }
  const base = { hooks: { PreToolUse: [sb], Stop: [sb], SessionStart: [sb] } }
  const once = mergeCodexHooks(base, 'node "/k/codex-hooks.mjs"')
  assert.equal(once.hooks.PreToolUse.length, 2)
  assert.equal(once.hooks.Stop.length, 2)
  assert.equal(once.hooks.SessionStart.length, 1)
  assert.deepEqual(once.hooks.PreToolUse[0], sb)
  assert.deepEqual(mergeCodexHooks(once, 'node "/k/codex-hooks.mjs"'), once)
  // A moved kit rewrites its own entry rather than adding another.
  const moved = mergeCodexHooks(once, 'node "/new/codex-hooks.mjs"')
  assert.equal(moved.hooks.Stop.length, 2)
  assert.match(JSON.stringify(moved), /\/new\/codex-hooks/)
  assert.doesNotMatch(JSON.stringify(moved), /"\/k\/codex-hooks/)
  assert.equal(mergeCodexHooks({}, 'node "/k/codex-hooks.mjs"').hooks.Stop.length, 1)
})

test('the installed copy runs from plain .mjs files outside the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  try {
    for (const [rel, text] of codexGuardFiles(r => readFileSync(join(REPO, r), 'utf8'), stripTypeScriptTypes)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    const r = runHook(join(dir, 'codex-hooks.mjs'), bash('su' + 'do ls'))
    assert.match(r.stdout, /"permissionDecision":"deny".*bash-approve/)
    assert.doesNotMatch(r.stderr, /did not load/)
    assert.match(runHook(join(dir, 'codex-hooks.mjs'), bash('git ' + 'push origin main')).stdout, /repo-rules/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a hook whose mods are missing still refuses the worst commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  try {
    writeFileSync(join(dir, 'codex-hooks.mjs'), readFileSync(join(REPO, 'kit/codex-hooks.mjs')))
    const r = runHook(join(dir, 'codex-hooks.mjs'), bash('su' + 'do ls'))
    assert.match(r.stderr, /did not load/)
    assert.match(r.stdout, /"permissionDecision":"deny"/)
    assert.equal(runHook(join(dir, 'codex-hooks.mjs'), bash('ls -la')).stdout, '')
    assert.equal(runHook(join(dir, 'codex-hooks.mjs'), { hook_event_name: 'Stop', session_id: 's', turn_id: 't' }).stdout, '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('fallbackDeny covers sudo, rm -r of home, force push to main and disk erase', () => {
  for (const c of ['su' + 'do ls', 'rm -' + 'rf ~', 'rm -' + 'r /', 'git push --' + 'force origin main', 'diskutil ' + 'eraseDisk x', 'rm --' + 'recursive /', 'rm -' + 'rf "$HOME"', 'rm -' + 'rf ${HOME}/', 'git push origin +' + 'main', 'git push -' + 'f origin HEAD:main']) assert.ok(fallbackDeny(c), c)
  for (const c of ['ls', 'rm -' + 'rf ./build', 'git push origin feature', 'git push --' + 'force origin feature', 'git push --' + 'force origin feature/main', 'git push origin main', 'rm -' + 'rf ~/tmp/x']) assert.equal(fallbackDeny(c), undefined, c)
})

test('an installed copy rebuilds a mod the repo changed after install', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'))
  const guard = mkdtempSync(join(tmpdir(), 'guard-'))
  try {
    // A fake repo: the real hook and mods, then bash-approve edited to refuse a marker command.
    for (const rel of ['kit/codex-hooks.mjs', 'kit/guard-mods.json', ...GUARD_MODS.map(m => `${m}/hooks/register.ts`)]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), readFileSync(join(REPO, rel)))
    }
    assert.equal(refreshCopy(guard, root), 2 + GUARD_MODS.length)
    writeFileSync(join(guard, 'source.json'), JSON.stringify({ root }))
    assert.equal(refreshCopy(guard, root), 0)
    const ba = join(root, 'bash-approve/hooks/register.ts')
    writeFileSync(ba, readFileSync(ba, 'utf8').replace('export const hardDeny = (command: string, w: Where = {}) =>', "export const hardDeny = (command: string, w: Where = {}) => command.includes('zz-marker') ? 'marker' :"))
    const later = new Date(Date.now() + 5000)
    utimesSync(ba, later, later)
    const r = runHook(join(guard, 'codex-hooks.mjs'), bash('echo zz-marker'))
    assert.match(r.stdout, /marker/)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(guard, { recursive: true, force: true }) }
})

test('the installed guard carries every mod in guard-mods.json', () => {
  const files = codexGuardFiles(r => readFileSync(join(REPO, r), 'utf8'), stripTypeScriptTypes).map(([p]) => p)
  assert.deepEqual(GUARD_MODS, JSON.parse(readFileSync(join(REPO, 'kit/guard-mods.json'), 'utf8')))
  for (const m of GUARD_MODS) assert.ok(files.includes(`${m}/hooks/register.mjs`), m)
})

const withHomeAsync = async (files, fn) => {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(home, rel)), { recursive: true })
      writeFileSync(join(home, rel), typeof text === 'string' ? text : JSON.stringify(text))
    }
    await fn(home)
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// A temp home holding what account-guard and phone-mode read.
const withHome = (files, fn) => {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(home, rel)), { recursive: true })
      writeFileSync(join(home, rel), typeof text === 'string' ? text : JSON.stringify(text))
    }
    fn(home)
  } finally { rmSync(home, { recursive: true, force: true }) }
}

test('account-guard: aws with a picked profile is told to rerun with it, unpicked is refused, a set profile passes', () => {
  const repo = 'Documents/GitHub/app'
  withHome({ [`${repo}/.git/HEAD`]: '', '.aws/config': '[profile Acme]\n', '.claude/switchboard/aws-prefs.json': {} }, home => {
    const cwd = join(home, repo)
    const run = command => preToolUse({ hook_event_name: 'PreToolUse', tool_name: 'exec_command', cwd, tool_input: { cmd: command } }, home)
    assert.match(run('aws s3 ls'), /account-guard: aws: no AWS profile is picked/)
    writeFileSync(join(home, '.claude/switchboard/aws-prefs.json'), JSON.stringify({ projects: { [cwd]: 'Acme' } }))
    assert.match(run('aws s3 ls'), /account-guard.*rerun.*AWS_PROFILE=Acme; aws s3 ls/)
    assert.equal(run('AWS_PROFILE=Acme aws s3 ls'), undefined)
    assert.equal(run('ls'), undefined)
  })
})

test('phone-mode: with the phone on, a Codex question is refused unless it is the closing one or the chat is indefinite', () => {
  const ask = question => ({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', session_id: 'sid', cwd: '/x', tool_input: { questions: [{ question, options: [{ label: 'A' }, { label: 'B' }] }] } })
  withHome({ '.claude/switchboard/limits.json': { phone: true } }, home => {
    assert.match(preToolUse(ask('Which?'), home), /Phone mode is on/)
    assert.equal(preToolUse(ask('Approve this chat as finished?'), home), undefined)
    writeFileSync(join(home, '.claude/switchboard/indefinite.json'), JSON.stringify({ sid: 1 }))
    assert.equal(preToolUse(ask('Which?'), home), undefined)
  })
  withHome({ '.claude/switchboard/limits.json': { phone: false } }, home => assert.equal(preToolUse(ask('Which?'), home), undefined))
})

test('Codex deny texts name mcp__switchboard__ask, not AskUserQuestion', () => {
  withHome({ '.claude/switchboard/aws-prefs.json': {} }, home => {
    const why = preToolUse({ hook_event_name: 'PreToolUse', tool_name: 'exec_command', cwd: home, tool_input: { cmd: 'aws s3 ls' } }, home)
    assert.match(why, /mcp__switchboard__ask/)
    assert.doesNotMatch(why, /AskUserQuestion/)
  })
})

test('phone-mode also keys on mcp__switchboard__ask', () => {
  const ask = question => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__switchboard__ask', session_id: 'sid', cwd: '/x', tool_input: { questions: [{ question, options: [{ label: 'A' }] }] } })
  withHome({ '.claude/switchboard/limits.json': { phone: true } }, home => {
    assert.match(preToolUse(ask('Which?'), home), /Phone mode is on/)
    assert.equal(preToolUse(ask('Approve this chat as finished?'), home), undefined)
  })
})

const sh = cmd => ({ hook_event_name: 'PreToolUse', tool_name: 'exec_command', session_id: 's1', cwd: '/x', tool_input: { cmd } })
const NOW = Date.parse('2026-11-12T10:00:00Z')

test('paid-guard: an ask-mode spend is refused once, and the retry goes through', async () => {
  await withHomeAsync({ '.claude/switchboard/spend-policy.json': { aws: { mode: 'ask' } } }, async home => {
    const why = await paidGuard(sh('aws ec2 run-instances --image-id x'), { home, now: NOW })
    assert.match(why, /paid-guard.*AWS change.*mcp__switchboard__ask/s)
    assert.equal(await paidGuard(sh('aws ec2 run-instances --image-id x'), { home, now: NOW + 60_000 }), undefined)
    assert.match(await paidGuard(sh('aws ec2 run-instances --image-id x'), { home, now: NOW + 20 * 60_000 }), /paid-guard/)
  })
})

test('paid-guard: a free command, or a read-only aws call, is not held', async () => {
  await withHomeAsync({}, async home => {
    assert.equal(await paidGuard(sh('ls'), { home, now: NOW }), undefined)
    assert.equal(await paidGuard(sh('aws s3 ls'), { home, now: NOW }), undefined)
  })
})

test('paid-guard: a capped key runs under its monthly cap, counts the call, and is refused past it', async () => {
  await withHomeAsync({}, async home => {
    const gem = sh('curl https://generativelanguage.googleapis.com/v1/x')
    assert.equal(await paidGuard(gem, { home, now: NOW }), undefined)
    const f = join(home, '.claude/switchboard/spend.json')
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).keys.gemini.calls, 1)
    writeFileSync(f, JSON.stringify({ month: '2026-11', keys: { gemini: { calls: 99, usd: 5 } } }))
    assert.match(await paidGuard(gem, { home, now: NOW }), /cap/)
  })
})

test('paid-guard: a provider with a confirmed limit runs, an unconfirmed one is held', async () => {
  const mcp = { hook_event_name: 'PreToolUse', tool_name: 'mcp__plugin_bland_bland__send_sms', session_id: 's1', cwd: '/x', tool_input: {} }
  await withHomeAsync({}, async home => {
    const ok = { home, now: NOW, key: () => 'k', fetch: async () => ({ ok: true, text: JSON.stringify({ billing: { current_balance: 20 } }) }) }
    assert.equal(await paidGuard(mcp, ok), undefined)
  })
  await withHomeAsync({}, async home => {
    const down = { home, now: NOW, key: () => 'k', fetch: async () => ({ ok: false, text: '' }) }
    assert.match(await paidGuard(mcp, down), /did not answer/)
  })
})

const pw = (name, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: 's1', turn_id: 't1', tool_use_id: `u-${name}`, tool_name: name, tool_input: {}, tool_response: 'ok', ...extra })

test('tab-close: a browser left open holds the stop once, a close clears it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'))
  try {
    const stopP = { session_id: 's1', turn_id: 't1', last_assistant_message: 'done' }
    assert.equal(tabsHold(stopP, { dir }), undefined)
    post(pw('mcp__plugin_playwright_playwright__browser_navigate'), { dir })
    assert.match(tabsHold(stopP, { dir }), /tab-close.*Playwright browser/)
    assert.equal(tabsHold({ ...stopP, stop_hook_active: true }, { dir }), undefined)
    assert.equal(tabsHold({ ...stopP, last_assistant_message: 'Is the page right?' }, { dir }), undefined)
    post(pw('mcp__plugin_playwright_playwright__browser_close'), { dir })
    assert.equal(tabsHold(stopP, { dir }), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('tab-close: a Chrome tab is held by the id the open call returned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'))
  try {
    post(pw('mcp__claude-in-chrome__tabs_create_mcp', { tool_response: 'Created new tab. Tab ID: 42' }), { dir })
    assert.match(tabsHold({ session_id: 's1', turn_id: 't1', last_assistant_message: 'done' }, { dir }), /Chrome tab 42/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('done-check sees an mcp__switchboard__ask as a question asked', () => {
  const rows = rolloutRows([
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'go' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'mcp__switchboard__ask', call_id: 'c1', arguments: '{}' } }),
  ].join('\n'))
  assert.equal(rows.at(-1).message.content[0].name, 'AskUserQuestion')
  for (const name of ['switchboard.ask', 'switchboard/ask', 'request_user_input']) {
    const r = rolloutRows(JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name, call_id: 'c', arguments: '{}' } }))
    assert.equal(r[0].message.content[0].name, 'AskUserQuestion', name)
  }
})

test('PostToolUse stamps the Switchboard ask tool as AskUserQuestion and phone-mode keys on every spelling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'))
  try {
    post({ session_id: 's', turn_id: 't', tool_use_id: 'u', tool_name: 'switchboard.ask', tool_input: {}, tool_response: 'ok' }, { dir })
    assert.match(readFileSync(join(dir, 's.jsonl'), 'utf8'), /"name":"AskUserQuestion"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  withHome({ '.claude/switchboard/limits.json': { phone: true } }, home => {
    for (const tool_name of ['switchboard.ask', 'switchboard/ask']) assert.match(preToolUse({ hook_event_name: 'PreToolUse', tool_name, session_id: 's', cwd: '/x', tool_input: { questions: [{ question: 'Which?' }] } }, home), /Phone mode is on/)
  })
})

const patchCall = (id, files) => row('response_item', { type: 'function_call', name: 'apply_patch', call_id: id, arguments: JSON.stringify({ input: `*** Begin Patch\n${files.map(f => `*** Update File: ${f}\n+x`).join('\n')}\n*** End Patch` }) })
const ask = id => call('mcp__switchboard__ask', {}, id)

test('rolloutRows keeps apply_patch file paths and the rollout cwd', () => {
  const rows = rolloutRows([row('session_meta', { cwd: '/x' }), user('go'), patchCall('p1', ['src/a.ts', 'b.ts']), edit('p2')].join('\n'))
  const uses = rows.flatMap(r => r.message.content).filter(b => b.type === 'tool_use')
  assert.deepEqual(uses.map(u => u.name), ['Edit', 'Edit', 'Edit'])
  assert.deepEqual(uses.map(u => u.input.file_path), ['src/a.ts', 'b.ts', 'a.txt'])
  assert.equal(rows.at(-1).cwd, '/x')
})

test('rolloutRows marks a hook-refused command as an error', () => {
  const denied = row('response_item', { type: 'function_call_output', call_id: 'c2', output: 'repo-rules: no' })
  const rows = rolloutRows([user('go'), call('exec_command', { cmd: 'git add test.txt' }, 'c2'), denied].join('\n'))
  assert.equal(rows.at(-1).message.content[0].is_error, true)
})

test('Stop counts a shell write as an edit, and ignores writes outside the cwd or under .switchboard', () => withDir(dir => {
  const sh = cmd => [user('x'), call('exec_command', { cmd }, 'c1'), out('c1', 0)]
  assert.equal(go(dir, sh('cat > index.js <<EOF\nx\nEOF')).decision, 'block')
  assert.equal(go(dir, sh('echo x > /private/tmp/n.md')), undefined)
  assert.equal(go(dir, sh('echo x > .switchboard/stages/n.md')), undefined)
  assert.equal(go(dir, [user('x'), patchCall('p', ['/h/.cache/a.md'])]), undefined)
}))

test('Stop holds once for the finish steps after a checked edit with no closing question', () => withDir(dir => {
  const lines = [user('fix'), edit('c1'), call('exec_command', { cmd: 'npm test' }, 'c2'), out('c2', 0)]
  assert.match(go(dir, lines).reason, /aar skill.*standup.*Approve this chat as finished/)
  assert.equal(go(dir, [...lines, ask('c3')]), undefined)
}))

test('Stop does not hold on a hook-refused test command', () => withDir(dir => {
  const denied = row('response_item', { type: 'function_call_output', call_id: 'c2', output: 'repo-rules: no' })
  const r = go(dir, [user('fix'), edit('c1'), call('exec_command', { cmd: 'git add test.txt' }, 'c2'), denied, ask('c3')])
  assert.equal(r, undefined)
}))

test('Stop cap is per turn key even when stop_hook_active is false mid-turn', () => withDir(dir => {
  const lines = [user('fix it'), edit('c1')]
  assert.equal(go(dir, lines).decision, 'block')
  assert.equal(go(dir, lines, { stop_hook_active: false }).decision, 'block')
  assert.equal(go(dir, lines, { stop_hook_active: true }), undefined)
  assert.equal(go(dir, lines, { stop_hook_active: false }), undefined)
}))

test('request_user_input and its async form count as the closing ask', () => withDir(dir => {
  const base = [user('fix'), edit('c1'), call('exec_command', { cmd: 'npm test' }, 'c2'), out('c2', 0)]
  for (const name of ['request_user_input', 'request_user_input_async']) {
    assert.equal(go(dir, [...base, call(name, {}, 'q')]), undefined, name)
    const custom = row('response_item', { type: 'custom_tool_call', name, call_id: 'q', input: '{}' })
    assert.equal(go(dir, [...base, custom]), undefined, `${name} custom`)
  }
}))

test('apply_patch Move to records the destination too', () => {
  const body = '*** Begin Patch\n*** Update File: old.ts\n*** Move to: /h/.cache/new.ts\n+x\n*** End Patch'
  const rows = rolloutRows([row('session_meta', { cwd: '/x' }), user('go'), row('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: body, call_id: 'p' })].join('\n'))
  const paths = rows.flatMap(r => r.message.content).filter(b => b.type === 'tool_use').map(b => b.input.file_path)
  assert.deepEqual(paths, ['old.ts', '/h/.cache/new.ts'])
})
