#!/usr/bin/env node
// Undo points for kit, rules, agent and memory edits.
//   node snapshot.mjs save <label> <files...>   prints "<id> <n> files"
//   node snapshot.mjs list
//   node snapshot.mjs restore <id>              saves the current files as "before undo" first
// Store: ~/.claude/switchboard/snapshots/<id>/{manifest.json,files/}. Same format as extension/src/hub/snapshots.ts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = () => path.join(os.homedir(), '.claude', 'switchboard', 'snapshots')
const rel = p => p.replace(/^[A-Za-z]:/, m => m[0]).replace(/^[\\/]+/, '')

function save(label, files, chat = process.env.CLAUDE_SESSION_ID, skipped = []) {
  const at = Date.now()
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'snap'
  fs.mkdirSync(root(), { recursive: true })
  let id = `${at}-${slug}`
  for (let n = 2; ; n++) {
    try { fs.mkdirSync(path.join(root(), id)); break } catch (e) { if (e.code !== 'EEXIST') throw e; id = `${at}-${slug}-${n}` }
  }
  const paths = []
  for (const f of files.map(x => path.resolve(x))) {
    if (!fs.statSync(f, { throwIfNoEntry: false })?.isFile()) continue
    const to = path.join(root(), id, 'files', rel(f))
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(f, to)
    paths.push(f)
  }
  fs.mkdirSync(path.join(root(), id), { recursive: true })
  fs.writeFileSync(path.join(root(), id, 'manifest.json'), JSON.stringify({ id, label, at, paths, chat: chat ?? null, ...(skipped.length ? { skipped } : {}) }, null, 1))
  return { id, label, at, paths }
}

function list() {
  let ids = []
  try { ids = fs.readdirSync(root()) } catch { return [] }
  return ids.flatMap(id => { try { return [JSON.parse(fs.readFileSync(path.join(root(), id, 'manifest.json'), 'utf8'))] } catch { return [] } })
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
}

// A path counts only when it resolves under the home folder, through symlinks too.
function underHome(p) {
  try {
    const home = fs.realpathSync(os.homedir())
    let d = path.resolve(p)
    while (!fs.existsSync(d)) d = path.dirname(d)
    const r = fs.realpathSync(d)
    return r === home || r.startsWith(home + path.sep)
  } catch { return false }
}

function restore(id) {
  const snap = list().find(s => s.id === id)
  if (!snap || !/^[\w.-]+$/.test(id)) throw new Error(`no snapshot ${id}`)
  const ok = snap.paths.filter(underHome)
  const skipped = snap.paths.filter(p => !ok.includes(p)).map(p => `${p} (outside home)`)
  const before = save(`before undo ${snap.label}`, ok, undefined, skipped)
  for (const p of ok) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.copyFileSync(path.join(root(), id, 'files', rel(p)), p)
  }
  return { ...before, skipped }
}

const [cmd, ...a] = process.argv.slice(2)
try {
  if (cmd === 'save' && a.length > 1) { const s = save(a[0], a.slice(1)); console.log(`${s.id} ${s.paths.length} files`) }
  else if (cmd === 'list') for (const s of list()) console.log(`${s.id}\t${new Date(s.at).toISOString()}\t${s.label}\t${s.paths.length} files`)
  else if (cmd === 'restore' && a[0]) { const r = restore(a[0]); for (const k of r.skipped) console.error(`skipped ${k}`); console.log(`restored ${a[0]}; undo with: restore ${r.id}`) }
  else { console.error('usage: snapshot.mjs save <label> <files...> | list | restore <id>'); process.exit(2) }
} catch (e) { console.error(e.message); process.exit(1) }
