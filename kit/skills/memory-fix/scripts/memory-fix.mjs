#!/usr/bin/env node
// Applies the safe memory graph fixes (index drift, superseded notes to archive/, unambiguous dangling links),
// backing up every file first, then lists what needs judgment. --dry only prints, --graph <file.json> reads the graph from a file. Exit 2 no hub, 1 issues left, 0 clean.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PREDS = ['supersedes', 'depends-on', 'part-of', 'contradicts', 'related']
const DASH = String.fromCharCode(8212), EN = String.fromCharCode(8211)
const noDash = s => s.replaceAll(DASH, ':').replaceAll(EN, '-').replace(/\s+:/g, ':')
const slugOf = id => id.slice(id.lastIndexOf('/') + 1).replace(/^wiki:|^raw:/, '')
const isLive = id => id.startsWith('memory:') && !id.includes('/archive/')
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = s => s.toLowerCase().replace(/\.md$/, '').replace(/[\s_]+/g, '-')

const memRoot = home => path.join(home, '.claude', 'projects')
const wikiRoot = home => path.join(home, 'Documents', 'vault', 'wiki')

/** Node id to real file for every memory note, by the frontmatter name the graph uses (file slug without one); a name two files claim maps to null. */
export function fileIndex(home) {
  const idx = new Map()
  for (const dir of fs.existsSync(memRoot(home)) ? fs.readdirSync(memRoot(home)) : []) {
    const mem = path.join(memRoot(home), dir, 'memory')
    for (const sub of ['', 'archive']) {
      const d = path.join(mem, sub)
      for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
        if (!f.endsWith('.md') || f === 'MEMORY.md') continue
        const p = path.join(d, f)
        let text
        try { text = fs.readFileSync(p, 'utf8') } catch { continue }
        const id = `memory:${dir}/${sub ? 'archive/' : ''}${describe(text, f).name}`
        idx.set(id, idx.has(id) ? null : p)
      }
    }
  }
  return idx
}

export function filePath(home, id, idx = fileIndex(home)) {
  if (id.startsWith('wiki:')) return path.join(wikiRoot(home), `${id.slice(5)}.md`)
  return idx.get(id) ?? undefined
}

/** A write target must be a regular file (not a link) whose real path stays in a memory folder or the vault wiki. */
export function safePath(home, f) {
  try {
    if (fs.lstatSync(f).isSymbolicLink()) return false
    const real = fs.realpathSync(f)
    const rp = d => { try { return fs.realpathSync(d) } catch { return undefined } }
    const mem = rp(memRoot(home)), wiki = rp(wikiRoot(home))
    return (!!mem && new RegExp(`^${esc(mem)}/[^/]+/memory/(archive/)?[^/]+\\.md$`).test(real)) || (!!wiki && real.startsWith(wiki + path.sep))
  } catch { return false }
}

export function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** The one live note a missing link name means: same slug after normalising, else edit distance 1 for names of 6+ chars; undefined when none or several. */
export function retargetFor(missing, nodes, selfId) {
  const pool = nodes.filter(n => ['memory', 'wiki', 'raw'].includes(n.kind) && n.id !== selfId && !n.id.includes('/archive/') && n.kind !== 'raw')
  const x = norm(missing)
  const exact = pool.filter(n => norm(slugOf(n.id)) === x)
  const near = exact.length ? exact : x.length < 6 ? [] : pool.filter(n => slugOf(n.id).length >= 6 && lev(norm(slugOf(n.id)), x) <= 1)
  return near.length === 1 ? slugOf(near[0].id) : undefined
}

/** Swap [[x]] in the body and x as a whole item in relation lists of the frontmatter; the file's line ending stays. */
export function relink(text, from, to) {
  const crlf = text.includes('\r\n')
  const t = text.replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---/.exec(t)
  const fix = s => s.replace(new RegExp(`\\[\\[${esc(from)}(?=[\\]|#])`, 'gi'), `[[${to}`)
  const core = i => i.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim().toLowerCase()
  const swap = i => (core(i) === from.toLowerCase() ? i.trim().replace(new RegExp(esc(from), 'i'), to) : i.trim())
  // Items of one relation key, swapped and deduped by target.
  const dedupe = list => { const seen = new Set(); return list.map(swap).filter(i => !seen.has(core(i)) && seen.add(core(i))) }
  let out = t
  if (m) {
    const seen = new Set()
    let rel = false
    const head = m[1].split('\n').flatMap(line => {
      const kv = /^(\s*)([\w-]+):(.*)$/.exec(line)
      if (kv) { rel = PREDS.includes(kv[2]); seen.clear() }
      if (!rel) return [fix(line)]
      if (kv && kv[3].trim()) {
        const v = kv[3].trim(), wrapped = /^\[(?!\[)[\s\S]*\]$/.test(v)
        const items = dedupe((wrapped ? v.slice(1, -1) : v).split(','))
        items.forEach(i => seen.add(core(i)))
        return [`${kv[1]}${kv[2]}: ${wrapped ? `[${items.join(', ')}]` : items.join(', ')}`]
      }
      const li = /^(\s*-\s+)(.+)$/.exec(line)
      if (!li) return [line]
      const i = swap(li[2])
      return seen.has(core(i)) ? [] : (seen.add(core(i)), [`${li[1]}${i}`])
    }).join('\n')
    out = `${t.slice(0, m.index)}---\n${head}\n---${fix(t.slice(m[0].length))}`
  } else out = fix(t)
  return crlf ? out.replace(/\n/g, '\r\n') : out
}

function describe(text, file) {
  const get = k => { const r = new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm').exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''); const v = r?.[1].trim(); return v && !/^[|>]/.test(v) ? v.replace(/^["']|["']$/g, '') : undefined }
  return { name: get('name') ?? file.replace(/\.md$/, ''), description: get('description') }
}

/** MEMORY.md text with lines for missing files dropped and unlisted live notes appended; gone = files about to be moved. */
export function syncIndex(memDir, gone = new Set()) {
  const idx = path.join(memDir, 'MEMORY.md')
  if (!fs.existsSync(idx)) return undefined
  const text = fs.readFileSync(idx, 'utf8')
  const listed = new Set()
  const keep = text.split('\n').filter(line => {
    const t = /\]\(([^)\s]+\.md)\)/.exec(line)?.[1]
    if (!t || /:\/\//.test(t) || t.startsWith('../') || t.startsWith('/')) return true
    const abs = path.resolve(memDir, t)
    listed.add(abs)
    return !(path.dirname(abs) === memDir && gone.has(path.basename(abs))) && fs.existsSync(abs)
  })
  const add = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md' && !listed.has(path.resolve(memDir, f)) && !gone.has(f)).sort().map(f => {
    const { name, description } = describe(fs.readFileSync(path.join(memDir, f), 'utf8'), f)
    return noDash(`- [${name}](${f}): ${description ?? name}`)
  })
  const out = [...(add.length && keep.at(-1) === '' ? keep.slice(0, -1) : keep), ...add, ...(add.length && keep.at(-1) === '' ? [''] : [])].join('\n')
  return out === text ? undefined : out
}

/** Pure given the graph and the files under home. actions: edit {file,text}, move {file,to}, index {file,text}; left: judgment lines. */
export function plan(graph, home) {
  const { nodes, edges = [], health: h } = graph
  const idx = fileIndex(home)
  const fp = id => filePath(home, id, idx)
  const unsafe = []
  const ok = f => safePath(home, f) || (unsafe.push(f), false)
  const actions = [], left = []
  const loopIds = new Set((h.loops ?? []).flat())
  const byId = new Map(nodes.map(n => [n.id, n]))
  const edited = new Map()
  const remaining = []
  for (const id of h.dangling) {
    const f = fp(id)
    if (!f || !fs.existsSync(f) || !ok(f)) { remaining.push([id, byId.get(id)?.missing ?? []]); continue }
    let text = edited.get(f) ?? fs.readFileSync(f, 'utf8'), rest = []
    for (const miss of byId.get(id)?.missing ?? []) {
      const to = retargetFor(miss, nodes, id)
      const next = to && relink(text, miss, to)
      if (next && next !== text) { text = next; actions.push({ type: 'note', msg: `retarget ${miss} -> ${to} in ${f}` }) } else rest.push(miss)
    }
    edited.set(f, text)
    if (rest.length) remaining.push([id, rest])
  }
  for (const [f, text] of edited) if (text !== fs.readFileSync(f, 'utf8')) actions.push({ type: 'edit', file: f, text })
  const gone = new Map()
  const moved = new Set()
  for (const id of h.superseded) {
    const by = edges.filter(e => e.kind === 'supersedes' && e.target === id).map(e => byId.get(e.source)).find(n => n && (n.kind === 'memory' || n.kind === 'wiki') && !n.id.includes('/archive/') && !loopIds.has(n.id))
    const f = fp(id)
    const to = f && path.join(path.dirname(f), 'archive', path.basename(f))
    if (!isLive(id) || loopIds.has(id) || !by || !fs.existsSync(f) || fs.existsSync(to) || !ok(f)) continue
    actions.push({ type: 'move', file: f, to })
    moved.add(id)
    gone.set(path.dirname(f), new Set([...(gone.get(path.dirname(f)) ?? []), path.basename(f)]))
  }
  const dirs = new Set(nodes.filter(n => isLive(n.id)).map(n => fp(n.id)).filter(Boolean).map(f => path.dirname(f)))
  for (const d of dirs) {
    const text = fs.existsSync(d) ? syncIndex(d, gone.get(d)) : undefined
    if (text !== undefined && ok(path.join(d, 'MEMORY.md'))) actions.push({ type: 'index', file: path.join(d, 'MEMORY.md'), text })
  }
  const P = id => fp(id) ?? id
  for (const f of unsafe) left.push(`unsafe ${f}: a link, or outside the memory folders and wiki; not touched`)
  for (const [id, miss] of remaining) left.push(`dangling ${P(id)}: no single match for ${miss.join(', ')}; link the right note, or remove the link`)
  for (const id of h.orphans) left.push(`orphan ${P(id)}: add a typed relation or [[link]] to a genuinely related note, else leave`)
  for (const k of h.duplicates) left.push(`duplicate "${k}": compare description and type; merge with supersedes, or rename`)
  for (const [a, b] of h.contradictions) left.push(`contradiction ${P(a)} vs ${P(b)}: supersedes only with same subject and newer evidence, else ask Kenneth`)
  for (const id of h.invalid) left.push(`invalid ${P(id)}: add a description (draft from the body) and metadata.type user|feedback|project|reference`)
  for (const id of h.stale) left.push(`stale ${P(id)}: check against code and git; update, supersede, or report`)
  for (const g of h.loops ?? []) left.push(`loop ${g.map(P).join(' <-> ')}: keep the newest, remove the other supersedes lines`)
  for (const id of h.superseded) if (!moved.has(id)) left.push(`superseded ${P(id)}: not moved (loop, no live superseder, or archive/ taken); check by hand`)
  return { actions, left }
}

export function apply(actions, backupDir, home = os.homedir()) {
  const save = f => { const to = path.join(backupDir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(f, to) }
  for (const a of actions) {
    if (a.type === 'note') continue
    if (!safePath(home, a.file)) throw new Error(`refusing ${a.file}`)
    save(a.file)
    if (a.type === 'move') { fs.mkdirSync(path.dirname(a.to), { recursive: true }); fs.renameSync(a.file, a.to) } else fs.writeFileSync(a.file, a.text)
  }
}

async function hubGraph(home) {
  const dir = path.join(home, '.claude', 'switchboard')
  const windows = fs.readdirSync(dir).filter(f => /^[0-9a-f]+-\d+\.json$/.test(f)).sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)
  for (const f of windows) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (w.port && w.hubToken) return await (await fetch(`http://127.0.0.1:${w.port}/hub/graph`, { headers: { 'x-switchboard-token': w.hubToken } })).json()
    } catch { /* next window */ }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const home = os.homedir()
  const gi = process.argv.indexOf('--graph')
  const graph = gi > 0 ? JSON.parse(fs.readFileSync(process.argv[gi + 1], 'utf8')) : await hubGraph(home).catch(() => undefined)
  if (!graph) { console.log('no Switchboard hub running; open a VS Code window with Switchboard and retry'); process.exit(2) }
  const { actions, left } = plan(graph, home)
  const dry = process.argv.includes('--dry')
  const dir = path.join(home, '.cache', 'memory-fix', new Date().toISOString().replace(/[:.]/g, '-'))
  if (!dry) apply(actions, dir, home)
  for (const a of actions) console.log(`${dry ? 'would ' : ''}${a.type === 'note' ? a.msg : a.type === 'move' ? `move ${a.file} -> ${a.to}` : `write ${a.file}`}`)
  if (!actions.length) console.log('nothing to auto-fix')
  else if (!dry) console.log(`backups: ${dir}`)
  if (left.length) console.log(`\nneeds judgment (${left.length}):\n${left.map(l => `- ${l}`).join('\n')}`)
  process.exit(left.length ? 1 : 0)
}
