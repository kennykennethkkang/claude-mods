// node --test 'kit/skills/claude-x-jev/scripts/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EM, readOnly, guard, emDashes, proseLines, commitOf, tells, draftPresets, repoInfo, setup, jobsOn, slug, repoDiff, editedFiles, apiKey } from './jev-project.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jev-project-'))
const band = { low: 0.2, high: 0.5 }
const gateBar = { name: 'demo-gate', model: 'typesafe/jev-1.13', questions: { destructive: { type: 'noul', instructions: 'x' }, paid: { type: 'noul', instructions: 'x' }, prod: { type: 'noul', instructions: 'x' } }, thresholds: { destructive: band, paid: band, prod: band } }
const answers = v => async () => ({ answers: Object.fromEntries(Object.entries(v).map(([q, p]) => [q, { type: 'noul', noul: p }])), usage: { cost: 0.0001 } })
const bash = command => ({ tool_name: 'Bash', tool_input: { command }, cwd: '/x/demo' })
const never = async () => { throw new Error('Jev must not be called') }
const quiet = { log: () => {} }

test('obvious reads skip Jev', () => {
  for (const c of ['ls -la', 'git status', 'git diff HEAD -- a.ts', 'cat a | grep b | wc -l', 'cd app && git log --oneline -5', 'grep -rn foo src 2>/dev/null', 'ls 2>&1', 'cat a >&2', 'find . -name "*.ts"', 'pwd', 'head -20 x.md'])
    assert.equal(readOnly(c), true, c)
})

test('anything that writes, chains a writer or hides a subshell goes to Jev', () => {
  for (const c of ['rm -rf build', 'git push --force', 'git branch -D x', 'echo hi > a.txt', 'ls && rm a', 'cat $(rm x)', 'find . -delete', 'find . -exec rm {} ;', 'sed -i s/a/b/ f', 'FOO=1 ls', 'git checkout .', 'npm install', 'ls `rm x`', 'curl https://x',
    // qa's repro: each of these writes, deletes or runs something
    'ls & rm -rf x', 'ls &rm -rf x', 'echo hi >&2.txt', 'echo hi >&2foo', 'rg --pre=sh foo .', 'rg --pre sh foo .', 'git grep -Orm foo',
    'git grep --open-files-in-pager=rm foo', "sed -n 'w victim' /dev/null", "sed 's/a/b/w victim' f", 'sort -o victim a', 'uniq a victim', 'tree -o victim',
    'git diff --output=victim', 'git log --output=victim', 'find . -fprint0 victim', 'date -s 12:00', 'cat <<<x', 'git -c core.pager=sh log', 'echo rm x | sh', 'ls | xargs rm', 'file -C -m magic'])
    assert.equal(readOnly(c), false, c)
})

test('a read-only command never calls Jev', async () => {
  assert.equal(await guard(bash('git status'), { ...quiet, preset: gateBar, decide: never, paid: async () => false }), null)
})

test('a command paid-guard already asks about is left to paid-guard', async () => {
  assert.equal(await guard(bash('bland call send --task x'), { ...quiet, preset: gateBar, decide: never, paid: async () => true }), null)
})

test('a risky answer over the bar asks Kenneth', async () => {
  const out = await guard(bash('git push --force origin main'), { ...quiet, preset: gateBar, decide: answers({ destructive: 0.93, paid: 0.01, prod: 0.7 }), paid: async () => false })
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /destructive 0\.93/)
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /prod 0\.70/)
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /paid/)
})

test('everything under the bar passes with no decision, never an allow', async () => {
  assert.equal(await guard(bash('pnpm test'), { ...quiet, preset: gateBar, decide: answers({ destructive: 0.05, paid: 0.01, prod: 0.3 }), paid: async () => false }), null)
})

test('a Jev error, a missing answer or no preset falls back to the normal prompt', async () => {
  const boom = async () => { throw new Error('timeout') }
  assert.equal(await guard(bash('rm -rf dist'), { ...quiet, preset: gateBar, decide: boom, paid: async () => false }), null)
  assert.equal(await guard(bash('rm -rf dist'), { ...quiet, preset: gateBar, decide: answers({ destructive: 0.9 }), paid: async () => false }), null)
  assert.equal(await guard(bash('rm -rf dist'), { ...quiet, preset: null, decide: never, paid: async () => false }), null)
  assert.equal(await guard({ tool_name: 'Read', tool_input: {} }, { ...quiet, preset: gateBar, decide: never }), null)
})

test('when Jev fails, a plainly risky command still asks, since bypass mode has no normal prompt', async () => {
  const boom = async () => { throw new Error('timeout') }
  for (const c of ['git push --force origin main', 'git reset --hard HEAD~1', 'git clean -fdx', 'git branch -D old', 'rm -rf ~/.claude/switchboard/uploads',
    'lsof -ti :3000 | xargs kill -9', 'pkill -f node', 'npx vsce publish', 'npm publish', 'gh release create v1', 'claude -p "bench"', 'codex exec "x"']) {
    const out = await guard(bash(c), { ...quiet, preset: gateBar, decide: boom, paid: async () => false })
    assert.equal(out?.hookSpecificOutput.permissionDecision, 'ask', c)
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Jev unavailable/, c)
  }
  for (const c of ['rm -rf dist', 'pnpm test', 'git add -A', 'node build.js'])
    assert.equal(await guard(bash(c), { ...quiet, preset: gateBar, decide: boom, paid: async () => false }), null, c)
})

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,0 +3,3 @@
+// This robust helper seamlessly leverages the cache
+const x = 1 ${EM} 2
+const label = 'Saved your changes to the server'
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -10,0 +11,1 @@
+Run the tests before you push a branch.
`

test('em dashes are found on added lines with file and line', () => {
  assert.deepEqual(emDashes(DIFF).map(l => `${l.file}:${l.line}`), ['src/a.ts:4'])
})

test('comments, UI strings and doc prose are the lines Jev reads; code is not', () => {
  const got = proseLines(DIFF).map(l => `${l.file}:${l.line}:${l.kind}`)
  assert.deepEqual(got, ['src/a.ts:3:comment', 'src/a.ts:5:copy', 'README.md:11:doc'])
})

test('the proposed commit message is the fenced block after Commit message:', () => {
  const msg = 'Standup...\n\nCommit message:\n```\nAdd Jev setup\n\n- Robust new flow\n```'
  assert.equal(commitOf(msg), 'Add Jev setup\n\n- Robust new flow')
  assert.equal(commitOf('no block here'), '')
})

const tellsPreset = { name: 'demo-tells', model: 'm', questions: { machine_prose: { type: 'noul', instructions: 'x' } }, thresholds: { machine_prose: { low: 0.2, high: 0.7 } } }

test('tells blocks the stop with the lines to fix, and lets a second stop through', async () => {
  const decide = async state => ({ answers: { machine_prose: { type: 'noul', noul: /robust/i.test(state.text) ? 0.95 : 0.05 } }, usage: { cost: 0.0001 } })
  const out = await tells({ cwd: '/x/demo', last_assistant_message: 'Commit message:\n```\nFix it, robustly\n```' }, { ...quiet, preset: tellsPreset, decide, diff: DIFF })
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /src\/a\.ts:4 em dash/)
  assert.match(out.reason, /src\/a\.ts:3 machine-sounding 0\.95/)
  assert.match(out.reason, /commit message:1 machine-sounding/)
  assert.doesNotMatch(out.reason, /README/)
  assert.equal(await tells({ cwd: '/x/demo', stop_hook_active: true }, { ...quiet, preset: tellsPreset, decide: never, diff: DIFF }), null)
})

test('tells still flags em dashes when Jev is down, and passes a clean diff', async () => {
  const out = await tells({ cwd: '/x/demo' }, { ...quiet, preset: tellsPreset, decide: async () => { throw new Error('down') }, diff: DIFF })
  assert.match(out.reason, /em dash/)
  assert.equal(await tells({ cwd: '/x/demo' }, { ...quiet, preset: tellsPreset, decide: answers({ machine_prose: 0.1 }), diff: '' }), null)
})

test('project names match Switchboard: the repo folder, lower case', () => {
  assert.equal(slug('agent-flow'), 'agent-flow')
  assert.equal(slug('My App'), 'my-app')
})

test('repoInfo reads the stack and test command; drafts name every preset <project>-<job>', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'tsx --test' }, dependencies: { react: '1' }, devDependencies: { typescript: '5' } }))
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '')
  const info = repoInfo(dir, 'Demo')
  assert.equal(info.test, 'pnpm test')
  assert.match(info.stack, /TypeScript/)
  assert.match(info.stack, /React/)
  const p = draftPresets(info)
  assert.deepEqual(Object.keys(p).sort(), ['demo-done', 'demo-findings', 'demo-gate', 'demo-route', 'demo-tells'])
  assert.deepEqual(p['demo-done'].state_fields, ['request', 'done'])
  assert.ok(p['demo-done'].questions.addressed, 'coverage.ts reads the addressed key')
  assert.deepEqual(Object.keys(p['demo-gate'].questions).sort(), ['destructive', 'paid', 'prod'])
  assert.deepEqual(Object.keys(p['demo-route'].questions.role.criteria), ['researcher', 'engineer', 'qa', 'designer', 'ops', 'growth'])
  assert.match(p['demo-done'].questions.addressed.instructions, /pnpm test/)
  for (const [name, preset] of Object.entries(p)) assert.equal(preset.name, name)
  assert.doesNotMatch(JSON.stringify(p), new RegExp(EM))
})

test('setup writes presets and project-only hooks, guards .claude in info/exclude, keeps tuned presets', () => {
  const dir = tmp(), presets = tmp()
  execFileSync('git', ['init', '-q', dir])
  fs.mkdirSync(path.join(dir, '.claude'))
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }))
  const name = slug(path.basename(dir))
  fs.writeFileSync(path.join(presets, `${name}-done.json`), '{"tuned":true}')
  const out = setup(dir, { presetDir: presets })
  assert.deepEqual(out.kept, [`${name}-done`])
  assert.equal(JSON.parse(fs.readFileSync(path.join(presets, `${name}-done.json`), 'utf8')).tuned, true)
  assert.ok(fs.existsSync(path.join(presets, `${name}-gate.json`)))
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'))
  assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] })
  assert.equal(s.hooks.Stop.length, 2)
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash')
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /jev-project\.mjs" guard$/)
  setup(dir, { presetDir: presets })
  const again = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'))
  assert.equal(again.hooks.Stop.length, 2, 'a second setup does not add the hook twice')
  const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')
  assert.equal(exclude.split('\n').filter(l => l === '.claude/').length, 1)
  assert.deepEqual(jobsOn(dir, presets), { done: true, gate: true, tells: true, route: true })
})

test('setup with some jobs turns on only those', () => {
  const dir = tmp(), presets = tmp()
  execFileSync('git', ['init', '-q', dir])
  setup(dir, { presetDir: presets, jobs: ['done', 'route'] })
  assert.deepEqual(jobsOn(dir, presets), { done: true, gate: false, tells: false, route: true })
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.local.json')), false)
})

const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' })

test('an untracked file after a skipped lock file chunk keeps its own header and is read', () => {
  const dir = tmp()
  git(dir, 'init', '-q')
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'a\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'b\n')
  fs.writeFileSync(path.join(dir, 'new.ts'), '// fresh line here for the check\n')
  const d = repoDiff(dir)
  assert.doesNotMatch(d, /pnpm-lock/)
  assert.deepEqual(addedFiles(d), ['new.ts'])
})
const addedFiles = d => [...new Set(proseLines(d).map(l => l.file))]

test('the files this chat edited come from its transcript', () => {
  const dir = tmp(), t = path.join(dir, 't.jsonl')
  const use = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
  fs.writeFileSync(t, [use('Edit', { file_path: '/r/src/a.ts' }), use('Write', { file_path: '/r/README.md' }), use('MultiEdit', { file_path: '/r/b.ts' }), use('Bash', { command: 'ls' }), 'not json'].join('\n'))
  assert.deepEqual([...editedFiles(t, '/r')].sort(), ['README.md', 'b.ts', 'src/a.ts'])
})

test("tells checks the chat's own files and leaves other chats' lines alone", async () => {
  const dir = tmp(), t = path.join(dir, 't.jsonl')
  fs.writeFileSync(t, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/demo/README.md' } }] } }))
  const seen = []
  const decide = async state => { seen.push(state.file); return { answers: { machine_prose: { type: 'noul', noul: 0.1 } } } }
  const out = await tells({ cwd: '/x/demo', transcript_path: t }, { ...quiet, preset: tellsPreset, decide, diff: DIFF, top: '/x/demo' })
  assert.equal(out, null, "src/a.ts belongs to another chat, so its em dash does not block this one")
  assert.deepEqual(seen, ['README.md'])
})

test('the key comes from the env, then the Keychain, then the saved file, and is never printed', () => {
  const bin = tmp(), keys = tmp()
  fs.writeFileSync(path.join(bin, 'security'), '#!/bin/sh\n[ "$*" = "find-generic-password -s switchboard -a OPENROUTER_API_KEY -w" ] && echo sk-or-from-keychain\n')
  fs.chmodSync(path.join(bin, 'security'), 0o755)
  const env = { PATH: `${bin}:/usr/bin:/bin` }
  assert.equal(apiKey({ env: { ...env, OPENROUTER_API_KEY: 'sk-or-env' }, keysDir: keys }), 'sk-or-env')
  assert.equal(apiKey({ env, keysDir: keys }), 'sk-or-from-keychain')
  fs.writeFileSync(path.join(keys, 'OPENROUTER_API_KEY'), 'sk-or-file\n')
  assert.equal(apiKey({ env: { PATH: '/nowhere' }, keysDir: keys }), 'sk-or-file')
  assert.equal(apiKey({ env: { PATH: '/nowhere' }, keysDir: tmp() }), '')
})
