import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { lev, relink, retargetFor, syncIndex, plan, apply, filePath, fileIndex, safePath } from './memory-fix.mjs'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-'))
const mem = path.join(home, '.claude', 'projects', 'p', 'memory')
fs.mkdirSync(mem, { recursive: true })
const w = (f, t) => fs.writeFileSync(path.join(mem, f), t)
const note = (name, extra = '', body = 'body') => `---\nname: ${name}\ndescription: about ${name}\nmetadata:\n  type: feedback\n${extra}---\n${body}\n`
const id = s => `memory:p/${s}`
const node = (s, extra = {}) => ({ id: id(s), kind: 'memory', label: s, ...extra })

test('lev counts edits', () => {
  assert.equal(lev('kitten', 'sitting'), 3)
  assert.equal(lev('abc', 'abc'), 0)
})

test('retargetFor needs exactly one live match', () => {
  const nodes = [node('release-every-update'), node('release-every-updates'), node('wiki-page'), node('old', {}), { id: 'memory:p/archive/arch-note', kind: 'memory', label: 'x' }]
  assert.equal(retargetFor('Wiki_Page', nodes, id('self')), 'wiki-page')
  assert.equal(retargetFor('release-every-upd', nodes, id('self')), undefined)
  assert.equal(retargetFor('arch-note', nodes, id('self')), undefined)
  assert.equal(retargetFor('totally-else', nodes, id('self')), undefined)
})

test('relink fixes body links and relation items only', () => {
  const t = '---\nname: a\nrelated: [gone, keep]\nsupersedes:\n  - gone\ndescription: gone stays\n---\nsee [[gone]] and [[Gone|alias]] and gone\n'
  assert.equal(relink(t, 'gone', 'here'), '---\nname: a\nrelated: [here, keep]\nsupersedes:\n  - here\ndescription: gone stays\n---\nsee [[here]] and [[here|alias]] and gone\n')
})

test('syncIndex drops missing files, appends unlisted notes, keeps other lines', () => {
  w('a.md', note('a'))
  w('b.md', note('b'))
  w('MEMORY.md', '# head\n- [A](a.md): hook\n- [Gone](gone.md): x\n- [Away](../../x/y.md): other folder\n')
  const out = syncIndex(mem)
  assert.match(out, /# head/)
  assert.match(out, /\[A\]\(a\.md\)/)
  assert.doesNotMatch(out, /gone\.md/)
  assert.match(out, /^- \[\]\(b\.md\) about b$/m)
  assert.equal(syncIndex(mem, new Set(['b.md'])).includes('b.md'), false)
  assert.doesNotMatch(out, /\u2014/)
})

test('syncIndex keeps an unproven note out of the index until it is proven', () => {
  w('a.md', note('a'))
  w('b.md', note('b', 'status: unproven\n'))
  w('MEMORY.md', '- [](a.md) hook\n- [](b.md) guess\n')
  assert.equal(syncIndex(mem), '- [](a.md) hook\n')
  w('MEMORY.md', '- [](a.md) hook\n')
  assert.equal(syncIndex(mem), undefined)
  w('b.md', note('b').replace('about b', 'word '.repeat(40).trim()))
  assert.match(syncIndex(mem), /^- \[\]\(b\.md\) (word ?){10,20}\.\.\.$/m)
})

test('plan and apply: retarget, archive a superseded note, back up first', () => {
  for (const f of fs.readdirSync(mem)) fs.rmSync(path.join(mem, f), { recursive: true })
  w('fresh-note.md', note('fresh-note', 'supersedes: old\n'))
  w('old.md', note('old'))
  w('user.md', note('user', '', 'see [[fresh-nots]] and [[nowhere-at-all]]'))
  w('MEMORY.md', '- [fresh-note](fresh-note.md): n\n- [old](old.md): o\n- [user](user.md): u\n')
  const graph = {
    nodes: [node('fresh-note'), node('old', { superseded: true }), node('user', { missing: ['fresh-nots', 'nowhere-at-all'] })],
    edges: [{ source: id('fresh-note'), target: id('old'), kind: 'supersedes' }],
    health: { dangling: [id('user')], orphans: [], duplicates: [], contradictions: [], superseded: [id('old')], invalid: [], stale: [], loops: [] },
  }
  const { actions, left } = plan(graph, home)
  assert.deepEqual(actions.map(a => a.type).sort(), ['edit', 'index', 'move', 'note'])
  assert.equal(left.length, 1)
  assert.match(left[0], /nowhere-at-all/)
  assert.equal(fs.readFileSync(path.join(mem, 'user.md'), 'utf8').includes('[[fresh-nots]]'), true, 'plan alone writes nothing')
  const bak = path.join(home, 'bak')
  apply(actions, bak, home)
  assert.ok(fs.existsSync(path.join(mem, 'archive', 'old.md')))
  assert.ok(!fs.existsSync(path.join(mem, 'old.md')))
  assert.match(fs.readFileSync(path.join(mem, 'user.md'), 'utf8'), /\[\[fresh-note\]\] and \[\[nowhere-at-all\]\]/)
  assert.doesNotMatch(fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8'), /old\.md/)
  assert.match(fs.readFileSync(path.join(bak, mem, 'old.md'), 'utf8'), /name: old/)
  assert.match(fs.readFileSync(path.join(bak, mem, 'user.md'), 'utf8'), /\[\[fresh-nots\]\]/)
})

test('a loop or a missing superseder is never auto-archived', () => {
  w('x.md', note('x'))
  w('y.md', note('y'))
  const nodes = [node('x', { superseded: true }), node('y', { superseded: true })]
  const edges = [{ source: id('x'), target: id('y'), kind: 'supersedes' }, { source: id('y'), target: id('x'), kind: 'supersedes' }]
  const health = { dangling: [], orphans: [], duplicates: [], contradictions: [], superseded: [id('x'), id('y')], invalid: [], stale: [], loops: [[id('x'), id('y')]] }
  const { actions, left } = plan({ nodes, edges, health }, home)
  assert.ok(!actions.some(a => a.type === 'move'))
  assert.ok(left.some(l => l.startsWith('loop ')))
  assert.equal(filePath(home, 'wiki:foo'), path.join(home, 'Documents', 'vault', 'wiki', 'foo.md'))
})

test('no fuzzy retarget for short names, distance 1 only', () => {
  const short = [node('a'), node('ab')]
  assert.equal(retargetFor('bar', short, id('self')), undefined)
  assert.equal(retargetFor('ab', [node('a')], id('self')), undefined)
  assert.equal(retargetFor('release-note', [node('release-notes')], id('self')), 'release-notes')
  assert.equal(retargetFor('release-nt', [node('release-notes')], id('self')), undefined)
})

test('relink swaps whole relation items only, dedupes, keeps CRLF', () => {
  const t = '---\nname: a\nrelated: [foo-bar, bar, [[bar|x]]]\ndepends-on: bar, bar-two\nsupersedes:\n  - bar\n  - other\n---\n[[bar]] [[foo-bar]] [[bar#h]]\n'
  const out = relink(t, 'bar', 'baz')
  assert.match(out, /related: \[foo-bar, baz\]/)
  assert.match(out, /depends-on: baz, bar-two/)
  assert.match(out, /supersedes:\n  - baz\n  - other/)
  assert.match(out, /\[\[baz\]\] \[\[foo-bar\]\] \[\[baz#h\]\]/)
  const crlf = relink(t.replace(/\n/g, '\r\n'), 'bar', 'baz')
  assert.equal(crlf.replace(/\r\n/g, '\n'), out)
  assert.ok(!/[^\r]\n/.test(crlf))
})

test('maps a node to its real file by frontmatter name, skips ambiguity', () => {
  for (const f of fs.readdirSync(mem)) fs.rmSync(path.join(mem, f), { recursive: true })
  w('xfile.md', note('yname'))
  w('dup1.md', note('same'))
  w('dup2.md', note('same'))
  const idx = fileIndex(home)
  assert.equal(filePath(home, id('yname'), idx), path.join(mem, 'xfile.md'))
  assert.equal(filePath(home, id('same'), idx), undefined)
})

test('refuses symlinks and paths outside memory and the wiki', () => {
  for (const f of fs.readdirSync(mem)) fs.rmSync(path.join(mem, f), { recursive: true })
  const out = path.join(home, 'outside.md')
  fs.writeFileSync(out, note('out'))
  fs.symlinkSync(out, path.join(mem, 'link.md'))
  w('real.md', note('real'))
  assert.equal(safePath(home, path.join(mem, 'link.md')), false)
  assert.equal(safePath(home, out), false)
  assert.equal(safePath(home, path.join(mem, 'real.md')), true)
})

test('syncIndex leaves urls and parent or absolute targets alone', () => {
  for (const f of fs.readdirSync(mem)) fs.rmSync(path.join(mem, f), { recursive: true })
  const idx = '- [U](https://x.org/a.md): u\n- [P](../w/gone.md): p\n- [A](/abs/gone.md): a\n'
  w('MEMORY.md', idx)
  assert.equal(syncIndex(mem), undefined)
})

after(() => fs.rmSync(home, { recursive: true, force: true }))
