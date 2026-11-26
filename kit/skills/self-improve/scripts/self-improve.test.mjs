import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardTarget, guardCandidate, diffLines, decide, loadTasks, parsePass, MIN_APPROVED, runsFor, merge } from './self-improve.mjs'

const K = '/Users/x/claude-mods/kit'

test('guardTarget allows kit files only', () => {
  assert.equal(guardTarget(`${K}/agents/ops.md`), null)
  assert.equal(guardTarget(`${K}/skills/aar/SKILL.md`), null)
  assert.equal(guardTarget(`${K}/rules.md`), null)
  assert.match(guardTarget(`${K}/../CLAUDE.md`), /off limits|must be/)
  assert.match(guardTarget('/Users/x/.claude/settings.json'), /off limits/)
  assert.match(guardTarget(`${K}/skills/hooks/SKILL.md`), /off limits/)
  assert.match(guardTarget(new URL('../SKILL.md', import.meta.url).pathname), /itself/)
  assert.match(guardTarget(new URL('../evals/judge.md', import.meta.url).pathname), /itself/)
})

test('guardCandidate freezes frontmatter and caps the diff', () => {
  const base = '---\nname: ops\ntools: Read\n---\n\nline\n'
  assert.equal(guardCandidate(base, base + 'more\n'), null)
  assert.match(guardCandidate(base, base.replace('tools: Read', 'tools: Bash')), /frontmatter/)
  assert.match(guardCandidate(base, base), /identical/)
  assert.match(guardCandidate(base, base + 'x\n'.repeat(31)), /cap is 30/)
})

test('diffLines counts changed lines', () => {
  assert.equal(diffLines('a\nb\nc', 'a\nB\nc'), 2)
  assert.equal(diffLines('a', 'a\nb'), 1)
})

const s = (...tasks) => Object.fromEntries(tasks.map((p, i) => [`t${i}`, { pass: p, turns: 4, cost: 0.2 }]))
// small samples: these tests check margin and regression, not the 30 result floor
const d = (b, c) => decide(b, c, 0.1, 0)

test('decide needs margin and no regression', () => {
  assert.equal(d(s([1, 0, 0, 1]), s([1, 1, 0, 1])).accept, true)
  assert.equal(d(s([1, 0, 0, 1]), s([1, 0, 0, 1])).accept, false)
  const r = d(s([1, 0, 1, 1], [0, 0]), s([0, 1, 1, 1], [1, 1]))
  assert.equal(r.accept, false)
  assert.match(r.why, /regressed on t0/)
  assert.equal(d(s([1, 0], [0, 0]), { t0: { pass: [1, 1] } }).accept, false)
})

test('decide tie breaks on cost and turns', () => {
  const base = s([1, 0]), cheap = { t0: { pass: [1, 0], turns: 3, cost: 0.1 } }
  assert.equal(d(base, cheap).accept, true)
  assert.equal(d(base, { t0: { pass: [1, 0], turns: 9, cost: 0.1 } }).accept, false)
})

test('decide needs 30 approved results by default', () => {
  const r = (n, k) => ({ t0: { pass: [...Array(n).fill(1), ...Array(k).fill(0)], items: 4 } })
  assert.equal(MIN_APPROVED, 30)
  assert.match(decide(r(20, 12), r(29, 3)).why, /29 approved results, need 30/)
  assert.equal(decide(r(20, 12), r(30, 2)).accept, true)
})

test('repeated runs compare passes per item, not per slot', () => {
  // item 1 passed once on each side, in different runs
  assert.deepEqual(d({ t0: { pass: [1, 0, 0, 1], items: 2 } }, { t0: { pass: [1, 1, 1, 0], items: 2 } }).regressed, [])
  assert.deepEqual(d({ t0: { pass: [1, 1, 1, 1], items: 2 } }, { t0: { pass: [1, 1, 0, 1], items: 2 } }).regressed, ['t0'])
})

test('runsFor judges enough items that 80% passing reaches 30', () => {
  assert.equal(runsFor(10), 4)
  assert.equal(runsFor(13), 3)
  assert.equal(runsFor(30), 2)
  assert.equal(runsFor(38), 1)
  assert.equal(runsFor(7), 6)
  for (const n of [7, 8, 9, 10, 11, 13, 24]) assert.ok(runsFor(n) * n * 0.8 >= 30, n)
})

test('merge joins a task side across runs in run order', () => {
  const m = merge([
    { id: 'a', side: 'candidate', run: 1, pass: [false, true], turns: 2, cost: 0.1, result: 'r1' },
    { id: 'a', side: 'candidate', run: 0, pass: [true, true], turns: 3, cost: 0.2, result: 'r0' },
    { id: 'a', side: 'baseline', run: 0, pass: [true, false], turns: 1, cost: 0.1, result: 'b0' },
  ])
  assert.deepEqual(m.find(x => x.side === 'candidate'), { id: 'a', side: 'candidate', items: 2, pass: [true, true, false, true], turns: 5, cost: 0.30000000000000004, results: ['r0', 'r1'] })
  assert.equal(m.length, 2)
})

test('seed evals have a dev and held-out split with checklists', () => {
  const t = loadTasks(`${K}/agents/ops.md`)
  assert.ok(t.length >= 3)
  assert.ok(t.some(x => x.split === 'dev') && t.filter(x => x.split === 'heldout').length >= 2)
  for (const x of t) assert.ok(x.prompt && x.checklist.length >= 3)
})

test('every tuned target has a dev task and two held-out', () => {
  for (const f of ['agents/Explore.md', 'agents/growth.md', 'agents/engineer-codex.md', 'agents/qa-codex.md', 'skills/aar/SKILL.md', 'skills/toolchain/SKILL.md', 'skills/crowd-ab/SKILL.md']) {
    const t = loadTasks(`${K}/${f}`)
    assert.ok(t.some(x => x.split === 'dev'), f)
    assert.ok(t.filter(x => x.split === 'heldout').length >= 2, f)
    for (const x of t) assert.ok(x.prompt && x.checklist.length >= 3, x.id)
  }
  const ids = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../evals/tasks.json'), 'utf8')).map(x => x.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('parsePass rejects a verdict whose length does not match the checklist', () => {
  assert.deepEqual(parsePass('ok {"pass":[true,0,1]}', 3), [true, false, true])
  assert.equal(parsePass('{"pass":[true,false]}', 3), null)
  assert.equal(parsePass('no json here', 2), null)
  assert.equal(parsePass('{"pass": oops}', 2), null)
})
