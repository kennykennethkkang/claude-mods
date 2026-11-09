// node --test kit/skills/improve-system/scripts/scan.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { redact, parseSession, summarize, findFiles } from './scan.mjs'

const human = (text, ts = '2026-11-06T10:00:00Z') => ({ type: 'user', timestamp: ts, origin: { kind: 'human' }, message: { role: 'user', content: text } })
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (id, content, is_error = true) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })

test('redacts keys, tokens and assignments', () => {
  // Split so the bundler's secret check does not flag this file.
  const s = redact(`key ${'sk'}-ant-api03-abcdefghijklmnopqrstuvwxyz and ${'gh'}p_abcdefghijklmnopqrstuvwxyz0123456789 and API_KEY=hunter22 Bearer abc.def.ghi`)
  assert.doesNotMatch(s, /abcdefghijklmnop|hunter22|abc\.def/)
  assert.match(s, /\[redacted\]/)
  assert.equal(redact('plain words stay'), 'plain words stay')
})

test('redacts stripe, google, json-quoted, url and hex secrets', () => {
  const cases = {
    [`pay ${'sk'}_live_abc12345XYZ`]: 'abc12345XYZ',
    [`pay ${'rk'}_test_abc12345XYZ`]: 'abc12345XYZ',
    [`g ${'AI'}za${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'}`]: 'A1b2C3d4E5f6G7h8I9j0',
    '{"apiKey": "zz9secretvalue"}': 'zz9secretvalue',
    '{"access_token":"tok9value"}': 'tok9value',
    'db postgres://admin:hunter22@db.local:5432/app': 'hunter22',
    'hex 0123456789abcdef0123456789abcdef here': '0123456789abcdef0123456789abcdef',
  }
  for (const [input, secret] of Object.entries(cases)) assert.ok(!redact(input).includes(secret), `${input} -> ${redact(input)}`)
  assert.match(redact('db postgres://admin:hunter22@db.local:5432/app'), /^db postgres:\/\/admin:\[redacted\]@db\.local:5432\/app$/)
})

test('redacts quoted values with spaces, @ in url passwords and auth headers', () => {
  assert.equal(redact('{"password": "correct horse battery"}'), '{"password": "[redacted]"}')
  assert.equal(redact('postgres://admin:p@ss@word@db.local/app'), 'postgres://admin:[redacted]@db.local/app')
  assert.doesNotMatch(redact('Authorization: Basic dXNlcjpwYXNzd29yZA=='), /dXNlcjpw/)
  assert.doesNotMatch(redact('Authorization: Bearer abcdefgh123'), /abcdefgh123/)
  assert.doesNotMatch(redact("clientSecret: 'abcdefghij'"), /abcdefghij/)
  assert.doesNotMatch(redact('db_password=hunter2222'), /hunter2222/)
})

test('leaves harmless pairs alone', () => {
  for (const s of ['keyboard: 12', 'monkey=banana', 'monkey=bananasplit', 'token=abc', 'turkey: "roasted with care"']) assert.equal(redact(s), s)
})

test('leaves file paths and project folder names alone', () => {
  const p = '/private/tmp/claude-501/-Users-kennykennethkkang-Documents-GitHub-switchboard/06aa1ab0-ff25-4192-bfbc-4aee8687ca10/scratchpad/scan.mjs'
  assert.equal(redact(p), p)
  assert.equal(redact('see -Users-kennykennethkkang-Documents-GitHub-switchboard-extension now'), 'see -Users-kennykennethkkang-Documents-GitHub-switchboard-extension now')
  assert.equal(redact('edit src/components/switchboard/VeryLongComponentNameForTesting1234.tsx'), 'edit src/components/switchboard/VeryLongComponentNameForTesting1234.tsx')
})

test('keeps typed turns, drops injected ones, maps tool errors and counts retries', () => {
  const s = parseSession([
    human('no, that is wrong, use pnpm not npm'),
    { type: 'user', message: { content: '<task-notification>done</task-notification>' } },
    { type: 'user', origin: { kind: 'task-notification' }, message: { content: 'agent finished' } },
    use('a', 'Bash', { command: 'npm test' }),
    result('a', 'Error: command not found: jest\nmore'),
    use('b', 'Bash', { command: 'npm test' }),
    result('b', 'ok', false),
  ])
  assert.deepEqual(s.user.map(u => u.text), ['no, that is wrong, use pnpm not npm'])
  assert.deepEqual(s.errors, [{ tool: 'Bash', msg: 'Error: command not found: jest' }])
  assert.equal(s.retries, 1)
})

test('skips meta and compact summaries, and gives an exit code its next line', () => {
  const s = parseSession([
    { type: 'user', isMeta: true, message: { content: '[Usage limit reached; stop soon]' } },
    { type: 'user', isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation' } },
    { type: 'user', message: { content: 'This session is being continued from a previous conversation that ran out' } },
    use('a', 'Bash', { command: 'tsc' }),
    result('a', 'Exit code 2\n\nsrc/x.ts(3,1): error TS2304'),
  ])
  assert.deepEqual(s.user, [])
  assert.equal(s.errors[0].msg, 'Exit code 2: src/x.ts(3,1): error TS2304')
})

test('links do not count as repeated phrases', () => {
  const a = parseSession([human('see https://www.instagram.com/reel/abc for this')])
  const b = parseSession([human('and https://www.instagram.com/reel/xyz too')])
  assert.deepEqual(summarize([{ project: 'p', ...a }, { project: 'p', ...b }]).repeated, [])
})

test('summary flags corrections and phrases repeated across sessions', () => {
  const a = parseSession([human('run the aar and write the standup'), human('that is still broken, try again')])
  const b = parseSession([human('please run the aar and write the standup now')])
  const sum = summarize([{ project: 'p1', ...a }, { project: 'p2', ...b }])
  assert.equal(sum.corrections.length, 1)
  assert.match(sum.corrections[0].text, /still broken/)
  assert.ok(sum.repeated.some(r => r.phrase === 'run the aar and write the standup' && r.sessions === 2), JSON.stringify(sum.repeated))
})

test('cli prints a compact summary for recent files only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'))
  const dir = path.join(home, '.claude', 'projects', '-x-proj')
  fs.mkdirSync(dir, { recursive: true })
  const fresh = path.join(dir, 'new.jsonl'), old = path.join(dir, 'old.jsonl')
  fs.writeFileSync(fresh, `${JSON.stringify(human('wrong again, token=abc123secret'))}\nnot json\n`)
  fs.writeFileSync(old, `${JSON.stringify(human('ancient'))}\n`)
  const t = Date.now() / 1000 - 30 * 86400
  fs.utimesSync(old, t, t)
  assert.deepEqual(findFiles(path.join(home, '.claude', 'projects'), { days: 7 }).map(f => path.basename(f.file)), ['new.jsonl'])
  const out = execFileSync(process.execPath, [path.join(import.meta.dirname, 'scan.mjs'), '--days', '7'], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  const j = JSON.parse(out)
  assert.equal(j.sessions, 1)
  assert.doesNotMatch(out, /abc123secret|ancient/)
  fs.rmSync(home, { recursive: true, force: true })
})
