import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const dirs = []
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })))

const PICK = new URL('./pick.mjs', import.meta.url).pathname

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'account-guard-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'repo/.git'), { recursive: true })
  mkdirSync(join(dir, 'repo/sub'))
  writeFileSync(join(dir, 'aws-prefs.json'), JSON.stringify({ chrome: { profile: 'P4' }, projects: { '/w/Armasu': 'Armasu' }, browsers: { x: 1 } }))
  writeFileSync(join(dir, 'logins.json'), JSON.stringify({ apps: [{ id: 'auth0', logins: [{ id: 'a1', label: 'Tenant' }] }], links: { '/w/Armasu': { vercel: 'v1' } } }))
  writeFileSync(join(dir, 'config'), '[sso-session s]\n[profile Armasu]\n[profile Other]\n')
  const env = { ...process.env, ACCOUNT_GUARD_DIR: dir, AWS_CONFIG_FILE: join(dir, 'config') }
  const run = (...args) => execFileSync('node', [PICK, ...args], { env, encoding: 'utf8', stdio: 'pipe' })
  const read = f => JSON.parse(readFileSync(join(dir, f), 'utf8'))
  return { dir, run, read }
}

test('saves an aws pick and keeps other keys', () => {
  const { dir, run, read } = setup()
  run('aws', 'Other', join(dir, 'repo'))
  assert.deepEqual(read('aws-prefs.json'), { chrome: { profile: 'P4' }, projects: { '/w/Armasu': 'Armasu', [join(dir, 'repo')]: 'Other' }, browsers: { x: 1 } })
  // Same folder in another case reuses the existing key.
  run('aws', 'Other', '/w/armasu/')
  assert.equal(read('aws-prefs.json').projects['/w/Armasu'], 'Other')
  assert.deepEqual(readdirSync(dir).filter(f => f.includes('.tmp')), [])
})

test('saves a login pick by id or label', () => {
  const { run, read } = setup()
  run('auth0', 'Tenant', '/w/Armasu')
  assert.deepEqual(read('logins.json').links['/w/Armasu'], { vercel: 'v1', auth0: 'a1' })
})

test('refuses unknown profiles, apps and logins', () => {
  const { run, read } = setup()
  assert.throws(() => run('aws', 'Nope', '/w/Armasu'), /Nope.*Armasu, Other/s)
  assert.throws(() => run('auth0', 'zz', '/w/x'), /zz/)
  assert.throws(() => run('vercel', 'v1', '/w/x'), /vercel/)
  assert.deepEqual(read('aws-prefs.json').projects, { '/w/Armasu': 'Armasu' })
})

test('refuses /, home and folders that are not a repo top or a saved pick', () => {
  const { dir, run, read } = setup()
  for (const f of ['/', homedir(), dir, join(dir, 'repo/sub'), '/w/nope']) assert.throws(() => run('aws', 'Other', f), /repo top/)
  assert.deepEqual(read('aws-prefs.json').projects, { '/w/Armasu': 'Armasu' })
})

test('a file that does not parse is left alone', () => {
  const { dir, run } = setup()
  const bad = '{ "projects": { "/w/Armasu": "Armasu", } }'
  writeFileSync(join(dir, 'aws-prefs.json'), bad)
  assert.throws(() => run('aws', 'Other', '/w/Armasu'), /aws-prefs\.json.*parse/s)
  assert.equal(readFileSync(join(dir, 'aws-prefs.json'), 'utf8'), bad)
})
