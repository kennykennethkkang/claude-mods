import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./adjust.mjs', import.meta.url))
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'adjust-'))
const run = (dir, ...args) => {
  const r = spawn(process.execPath, [script, ...args], { env: { ...process.env, SWITCHBOARD_ADJUST_DIR: dir, HOME: path.dirname(dir) }, encoding: 'utf8' })
  let out = '', err = ''
  return new Promise(resolve => {
    r.stdout.on('data', b => out += b)
    r.stderr.on('data', b => err += b)
    r.on('close', code => resolve({ code, out, err }))
  })
}
const begin = (dir, file, more = []) => run(dir, 'begin', '--title', 'Test change', '--why', 'test', '--area', 'dev', '--target', file, '--file', file, ...more)
const record = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'record.json'), 'utf8'))
test('begin, done and undo restore existing files and mode', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'settings')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); fs.chmodSync(file, 0o640)
  const b = await begin(dir, file)
  assert.equal(b.code, 0, b.err)
  const id = b.out.trim()
  assert.match(id, /^\d{8}-\d{6}-test-change-[0-9a-f]{4}$/)
  assert.equal(fs.statSync(path.join(dir, id)).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(dir, id, 'record.json')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(dir, id, 'files', '0')).mode & 0o777, 0o600)
  fs.writeFileSync(file, 'after')
  assert.equal((await run(dir, 'done', id, '--check', 'true')).code, 0)
  assert.equal(record(dir, id).status, 'applied')
  assert.equal((await run(dir, 'undo', id)).code, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), 'before')
  assert.equal(fs.statSync(file).mode & 0o777, 0o640)
  assert.equal(record(dir, id).status, 'undone')
})

test('undo removes a new file and restores a deleted file', async t => {
  const root = temp(), dir = path.join(root, 'journal'), fresh = path.join(root, 'fresh'), old = path.join(root, 'old')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let b = await begin(dir, fresh); let id = b.out.trim(); fs.writeFileSync(fresh, 'new')
  await run(dir, 'done', id); await run(dir, 'undo', id); assert.equal(fs.existsSync(fresh), false)
  fs.writeFileSync(old, 'old')
  b = await begin(dir, old); id = b.out.trim(); fs.unlinkSync(old)
  await run(dir, 'done', id); await run(dir, 'undo', id); assert.equal(fs.readFileSync(old, 'utf8'), 'old')
})

test('failed undo command leaves target files alone', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const id = (await begin(dir, file, ['--undo', 'exit 4'])).out.trim()
  fs.writeFileSync(file, 'after'); await run(dir, 'done', id)
  const u = await run(dir, 'undo', id)
  assert.notEqual(u.code, 0); assert.equal(fs.readFileSync(file, 'utf8'), 'after'); assert.equal(record(dir, id).status, 'undo-failed')
})

test('undo refuses a changed file with newer change id, force preserves current copy', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const first = (await begin(dir, file)).out.trim()
  fs.writeFileSync(file, 'first edit'); await run(dir, 'done', first)
  const second = (await begin(dir, file)).out.trim(); fs.writeFileSync(file, 'newer edit'); await run(dir, 'done', second)
  const refused = await run(dir, 'undo', first)
  assert.notEqual(refused.code, 0); assert.match(refused.err + refused.out, new RegExp(second)); assert.equal(fs.readFileSync(file, 'utf8'), 'newer edit')
  assert.equal((await run(dir, 'undo', first, '--force')).code, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), 'before')
  assert.equal(fs.readFileSync(path.join(dir, first, 'replaced', '0'), 'utf8'), 'newer edit')
})

test('failed check records failed status and undoes immediately on explicit undo', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const id = (await begin(dir, file)).out.trim(); fs.writeFileSync(file, 'after')
  const d = await run(dir, 'done', id, '--check', 'printf nope; exit 1')
  assert.notEqual(d.code, 0); assert.equal(record(dir, id).status, 'failed'); assert.equal(record(dir, id).check.ok, false)
  assert.equal((await run(dir, 'undo', id)).code, 0); assert.equal(fs.readFileSync(file, 'utf8'), 'before')
})

test('refuses secrets, directories and privileged undo or check commands', async t => {
  const root = temp(), dir = path.join(root, 'journal'), home = path.dirname(dir)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const secret = path.join(home, 'id_rsa'); fs.writeFileSync(secret, 'secret')
  assert.notEqual((await begin(dir, secret)).code, 0)
  assert.notEqual((await begin(dir, home)).code, 0)
  const externalRoot = temp(), external = path.join(externalRoot, 'target')
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }))
  fs.writeFileSync(external, 'outside'); const link = path.join(home, 'link'); fs.symlinkSync(external, link)
  assert.notEqual((await begin(dir, link)).code, 0)
  const cmd = ['su', 'do', ' '].join('') + 'true'
  assert.notEqual((await run(dir, 'begin', '--title', 'x', '--why', 'x', '--area', 'dev', '--target', 'x', '--undo', cmd)).code, 0)
  const id = (await begin(dir, secret.replace('id_rsa', 'safe'))).out.trim()
  assert.notEqual((await run(dir, 'done', id, '--check', cmd)).code, 0)
})

test('two concurrent undos cannot race', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const id = (await begin(dir, file)).out.trim(); fs.writeFileSync(file, 'after'); await run(dir, 'done', id)
  const [a, b] = await Promise.all([run(dir, 'undo', id), run(dir, 'undo', id)])
  assert.equal([a, b].filter(x => x.code === 0).length, 1)
  assert.equal(fs.readFileSync(file, 'utf8'), 'before')
})

test('bad ids are rejected', async t => {
  const root = temp(), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.notEqual((await run(dir, 'undo', '../escape')).code, 0)
})

test('facts omits account and host names', async t => {
  const root = temp(), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const f = await run(dir, 'facts')
  assert.equal(f.code, 0, f.err); assert.doesNotMatch(f.out, new RegExp(os.userInfo().username)); assert.doesNotMatch(f.out, new RegExp(os.hostname()))
})

test('undoing a change that was never finished keeps what was there', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const id = (await begin(dir, file)).out.trim()
  fs.writeFileSync(file, 'half done')
  assert.equal((await run(dir, 'undo', id)).code, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), 'before')
  assert.equal(fs.readFileSync(path.join(dir, id, 'replaced', '0'), 'utf8'), 'half done')
})

test('a bad undo id leaves no lock behind', async t => {
  const root = temp(), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(dir, { recursive: true })
  assert.notEqual((await run(dir, 'undo', '..')).code, 0)
  assert.notEqual((await run(dir, 'undo', '20260101-000000-none-abcd')).code, 0)
  assert.equal(fs.existsSync(path.join(root, 'undo.lock')), false)
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('a forced undo keeps the newer copy even when the undo command changes the file', async t => {
  const root = temp(), dir = path.join(root, 'journal'), file = path.join(root, 'f')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'before'); const id = (await begin(dir, file, ['--undo', `rm ${file}`])).out.trim()
  fs.writeFileSync(file, 'after'); await run(dir, 'done', id)
  fs.writeFileSync(file, 'newer')
  assert.equal((await run(dir, 'undo', id, '--force')).code, 0)
  assert.equal(fs.readFileSync(path.join(dir, id, 'replaced', '0'), 'utf8'), 'newer')
  assert.equal(fs.readFileSync(file, 'utf8'), 'before')
})

test('a link to a secret is refused, a link to a plain file records both paths', async t => {
  const root = fs.realpathSync(temp()), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'id_rsa'), 'k'); fs.symlinkSync(path.join(root, 'id_rsa'), path.join(root, 'safe'))
  assert.match((await begin(dir, path.join(root, 'safe'))).err, /secret/)
  fs.writeFileSync(path.join(root, 'real'), 'x'); fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'))
  const id = (await begin(dir, path.join(root, 'link'))).out.trim()
  assert.equal(record(dir, id).files[0].path, path.join(root, 'real'))
  assert.equal(record(dir, id).files[0].link, path.join(root, 'link'))
})

test('other ways to root are refused too', async t => {
  const root = temp(), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const cmd of ['su root -c id', 'pkexec id', 's""u' + 'do id', `osascript -e 'do shell script "id" with administrator privileges'`]) {
    const r = await run(dir, 'begin', '--title', 'x', '--why', 'y', '--area', 'dev', '--target', 'z', '--undo', cmd)
    assert.notEqual(r.code, 0, cmd); assert.match(r.err, /privileged/)
  }
})

test('an undo that stops halfway can be run again without force', async t => {
  const root = temp(), dir = path.join(root, 'journal'), a = path.join(root, 'a'), b = path.join(root, 'b')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(a, 'a1'); fs.writeFileSync(b, 'b1')
  const id = (await begin(dir, a, ['--file', b])).out.trim()
  fs.writeFileSync(a, 'a2'); fs.writeFileSync(b, 'b2'); await run(dir, 'done', id)
  const backup = path.join(dir, id, 'files', '1')
  fs.renameSync(backup, `${backup}.away`)
  assert.notEqual((await run(dir, 'undo', id)).code, 0)
  assert.equal(record(dir, id).status, 'undo-failed')
  fs.renameSync(`${backup}.away`, backup)
  assert.equal((await run(dir, 'undo', id)).code, 0)
  assert.equal(fs.readFileSync(a, 'utf8') + fs.readFileSync(b, 'utf8'), 'a1b1')
})

test('token files and secrets folders are refused', async t => {
  const root = temp(), dir = path.join(root, 'journal')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'secrets'))
  for (const f of ['.netrc', '.npmrc', 'secrets/x.txt']) assert.match((await begin(dir, path.join(root, f))).err, /secret/, f)
  assert.equal((await begin(dir, path.join(root, 'design-tokens.css'))).code, 0)
})
