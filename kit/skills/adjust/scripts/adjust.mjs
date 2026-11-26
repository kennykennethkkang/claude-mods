#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = os.homedir()
const root = process.env.SWITCHBOARD_ADJUST_DIR || path.join(home, '.claude', 'switchboard', 'adjustments')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const idOk = id => /^\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$/.test(id)
const recordPath = id => { if (!idOk(id)) throw Error(`invalid id: ${id}`); return path.join(root, id, 'record.json') }
const digest = p => { try { return hash(fs.readFileSync(p)) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const inside = (base, p) => p === base || p.startsWith(base + path.sep)

const SECRET = /(^|[/.])env(?:rc|\.|$)|(^|[/.])\.ssh([/.]|$)|id_(?:rsa|ed25519|ecdsa|dsa)|\.pem$|(^|[/.])(?:netrc|npmrc|pgpass|pypirc)$|(^|\/)\.?secrets?([/.]|$)|keychain|credentials?/i
function safeFile(file) {
  const p = path.resolve(file)
  if (SECRET.test(p)) throw Error(`refusing secret path: ${p}`)
  let st
  try { st = fs.lstatSync(p) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (st?.isDirectory()) throw Error(`refusing directory: ${p}`)
  if (st && !st.isFile() && !st.isSymbolicLink()) throw Error(`refusing non-file: ${p}`)
  if (st?.isSymbolicLink()) {
    const real = fs.realpathSync(p)
    if (!inside(fs.realpathSync(home), real)) throw Error(`refusing symlink outside home: ${p}`)
    if (SECRET.test(real)) throw Error(`refusing secret path: ${p}`)
    const target = fs.statSync(p)
    if (!target.isFile()) throw Error(`refusing non-file: ${p}`)
    return real
  }
  return p
}

function atomicRecord(file, record) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}
function save(record) { atomicRecord(recordPath(record.id), record) }
function load(id) { return JSON.parse(fs.readFileSync(recordPath(id), 'utf8')) }
function parse(args) {
  const pos = [], opts = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { pos.push(args[i]); continue }
    const key = args[i].slice(2)
    if (key === 'force') { opts.force = true; continue }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`missing value for --${key}`)
    if (key === 'file') (opts.files ??= []).push(args[++i])
    else opts[key] = args[++i]
  }
  return { pos, opts }
}
function required(opts, names) { for (const n of names) if (!opts[n]) throw Error(`required: --${n}`) }
function lock(id) {
  const f = path.join(path.dirname(recordPath(id)), 'undo.lock')
  if (!fs.existsSync(path.dirname(f))) throw Error(`no change ${id}`)
  try { return fs.openSync(f, 'wx', 0o600) } catch (e) {
    if (e.code !== 'EEXIST') throw e
    try { if (Date.now() - fs.statSync(f).mtimeMs > 10 * 60_000) { fs.unlinkSync(f); return fs.openSync(f, 'wx', 0o600) } } catch (err) { if (err.code !== 'ENOENT') throw err }
    throw Error('undo already running')
  }
}
function command(cmd) {
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd]
  try { return { ok: true, out: execFileSync(shell, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).slice(0, 4000) } }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}${e.stdout || e.stderr ? '' : e.message}`.slice(0, 4000) } }
}

export function begin(opts) {
  required(opts, ['title', 'why', 'area', 'target'])
  if (!['mac', 'dev', 'kit', 'other'].includes(opts.area)) throw Error('invalid area')
  const files = (opts.files ?? []).map(safeFile), asked = (opts.files ?? []).map(f => path.resolve(f))
  if (!files.length && !opts.undo && !opts['no-undo']) throw Error('needs --file, --undo or --no-undo')
  if (opts.undo) commandSafe(opts.undo)
  if (opts['no-undo'] && opts.undo) throw Error('choose --undo or --no-undo')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700)
  const slug = opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'change'
  let id, dir
  do { const now = new Date(); id = `${now.toISOString().slice(0, 10).replaceAll('-', '')}-${now.toISOString().slice(11, 19).replaceAll(':', '')}-${slug}-${crypto.randomBytes(2).toString('hex')}`; dir = path.join(root, id) } while (fs.existsSync(dir))
  fs.mkdirSync(dir, { mode: 0o700 }); fs.mkdirSync(path.join(dir, 'files'), { mode: 0o700 })
  const record = { id, title: opts.title, why: opts.why, area: opts.area, target: opts.target, device: device(), status: 'open', at: Date.now(), ...(process.env.CLAUDE_CODE_SESSION_ID ? { sessionId: process.env.CLAUDE_CODE_SESSION_ID } : {}), ...(opts.report ? { report: opts.report } : {}), ...(opts.action ? { action: opts.action } : {}), ...(opts.undo ? { undo: opts.undo } : {}), ...(opts['no-undo'] ? { noUndo: opts['no-undo'] } : {}), files: [] }
  files.forEach((p, i) => {
    const before = digest(p), backup = before === null ? null : `files/${i}`
    if (backup) { const to = path.join(dir, backup); fs.copyFileSync(p, to, fs.constants.COPYFILE_EXCL); fs.chmodSync(to, 0o600) }
    record.files.push({ path: p, ...(asked[i] !== p ? { link: asked[i] } : {}), backup, before, ...(before !== null ? { mode: fs.statSync(p).mode & 0o777 } : {}) })
  })
  save(record)
  return id
}
// A guard rail against a careless command, not a boundary: the user sees the undo before it runs.
function commandSafe(cmd) { if (/\b(?:sudo|doas|su|pkexec|runas)\b|administrator privileges/i.test(cmd.replace(/["'\\]/g, ''))) throw Error('refusing privileged command') }

export function done(id, check) {
  const r = load(id)
  if (r.status !== 'open') throw Error(`cannot finish change in ${r.status} status`)
  if (check) {
    commandSafe(check)
    r.check = { cmd: check, ...command(check) }
  }
  for (const f of r.files) f.after = digest(safeFile(f.path))
  r.doneAt = Date.now(); r.status = r.check?.ok === false ? 'failed' : 'applied'; save(r)
  if (r.status === 'failed') throw Error(`check failed: ${r.check.out || 'nonzero exit'}`)
  return r
}
function newerChange(id, file) {
  for (const name of fs.readdirSync(root).filter(idOk).sort().reverse()) {
    if (name === id) continue
    try { const r = load(name); if (r.at > load(id).at && r.files.some(f => f.path === file)) return name } catch {}
  }
}
function writeFile(p, bytes, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 })
  const tmp = `${p}.${process.pid}.adjust-tmp`
  fs.writeFileSync(tmp, bytes, { mode: mode ?? 0o600 }); fs.chmodSync(tmp, mode ?? 0o600); fs.renameSync(tmp, p)
}
export function undo(id, force = false) {
  const lockFd = lock(id)
  try {
    const r = load(id)
    if (!['open', 'applied', 'failed', 'undo-failed'].includes(r.status)) throw Error(`cannot undo change in ${r.status} status`)
    if (r.noUndo) throw Error(`change has no undo: ${r.noUndo}`)
    const seen = r.files.map((f, i) => ({ f, i, current: digest(safeFile(f.path)) }))
    const changes = seen.filter(({ f, current }) => f.after !== undefined && current !== f.after && current !== f.before)
    if (changes.length && !force) {
      const { f } = changes[0], newer = newerChange(id, f.path)
      throw Error(`refusing changed file ${f.path}${newer ? `; newer change ${newer}` : ''}`)
    }
    const replaced = path.join(root, id, 'replaced'), removed = path.join(root, id, 'removed')
    // Forced, or never finished: what is there now may be someone's own edit, so keep it.
    const keep = seen.filter(({ f, current }) => current !== null && current !== f.before && (f.after === undefined || current !== f.after))
    if (keep.length) fs.mkdirSync(replaced, { recursive: true, mode: 0o700 })
    for (const { f, i } of keep) { const to = path.join(replaced, String(i)); fs.copyFileSync(f.path, to); fs.chmodSync(to, 0o600) }
    if (r.undo) {
      commandSafe(r.undo)
      const result = command(r.undo)
      if (!result.ok) {
        r.status = 'undo-failed'; r.problem = `undo command failed: ${result.out || result.error}`; save(r); throw Error(r.problem)
      }
    }
    try {
      for (const [i, f] of r.files.entries()) {
        safeFile(f.path)
        if (f.backup === null) {
          if (fs.existsSync(f.path)) {
            fs.mkdirSync(removed, { recursive: true, mode: 0o700 })
            // Copy then delete: the file may sit on another volume.
            fs.copyFileSync(f.path, path.join(removed, String(i)))
            fs.chmodSync(path.join(removed, String(i)), 0o600)
            fs.unlinkSync(f.path)
          }
        } else writeFile(f.path, fs.readFileSync(path.join(root, id, f.backup)), f.mode)
      }
    } catch (e) { r.status = 'undo-failed'; r.problem = `restore failed: ${e.message}`; save(r); throw e }
    delete r.problem
    r.status = 'undone'; r.undoneAt = Date.now(); save(r); return r
  } finally { fs.closeSync(lockFd); try { fs.unlinkSync(path.join(root, id, 'undo.lock')) } catch {} }
}
export function list(json = false) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const records = fs.readdirSync(root).filter(idOk).map(id => { try { return load(id) } catch { return null } }).filter(Boolean).sort((a, b) => b.at - a.at)
  return json ? JSON.stringify(records, null, 2) : records.map(r => `${r.id} ${r.status} ${r.title}`).join('\n')
}
const run = (bin, ...args) => { try { return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() } catch { return '' } }
const chip = () => (process.platform === 'darwin' && run('sysctl', '-n', 'machdep.cpu.brand_string')) || os.cpus()[0]?.model || os.arch()
const system = () => process.platform === 'darwin' ? `macOS ${run('sw_vers', '-productVersion')}`.trim() : `${os.type()} ${os.release()}`
const device = () => `${system()}, ${chip()}`
export function facts() {
  const gb = n => `${Math.round(n / 1024 ** 3)} GB`
  let disk = 'unknown'
  try { const s = fs.statfsSync(home); disk = gb(s.bavail * s.bsize) }
  catch { try { disk = execFileSync('df', ['-h', home], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3] } catch {} }
  const has = bin => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true } catch { return false } }
  const brews = run('brew', 'list', '--formula').split('\n').filter(Boolean).length
  const managers = ['brew', 'npm', 'pnpm', 'yarn', 'cargo', 'uv', 'pipx', 'winget', 'apt'].filter(has).map(m => m === 'brew' ? `brew (${brews} formulae)` : m)
  const tools = ['git', 'node', 'python3', 'code', 'docker', 'ollama', 'defaults', 'osascript', 'shortcuts', 'launchctl', 'agent-desktop', 'trash'].filter(has)
  return [`OS: ${system()}`, `Chip: ${chip()}`, `RAM: ${gb(os.totalmem())}`, `Disk free: ${disk}`, `Shell: ${path.basename(process.env.SHELL || 'unknown')}`, `Package managers: ${managers.join(', ') || 'none detected'}`, `Useful CLIs: ${tools.join(', ') || 'none detected'}`].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [verb, ...args] = process.argv.slice(2), { pos, opts } = parse(args)
    if (verb === 'facts') console.log(facts())
    else if (verb === 'begin') console.log(begin(opts))
    else if (verb === 'done') console.log(`${done(pos[0], opts.check).id} applied`)
    else if (verb === 'undo') console.log(`${undo(pos[0], opts.force).id} undone`)
    else if (verb === 'list') console.log(list(!!opts.json))
    else throw Error('usage: adjust facts|begin|done <id>|undo <id>|list [--json]')
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
