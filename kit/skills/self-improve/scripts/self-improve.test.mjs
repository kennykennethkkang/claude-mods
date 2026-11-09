import test from 'node:test'
import assert from 'node:assert/strict'
import { guardTarget, guardCandidate, diffLines, decide, loadTasks } from './self-improve.mjs'

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

test('decide needs margin and no regression', () => {
  assert.equal(decide(s([1, 0, 0, 1]), s([1, 1, 0, 1])).accept, true)
  assert.equal(decide(s([1, 0, 0, 1]), s([1, 0, 0, 1])).accept, false)
  const r = decide(s([1, 0, 1, 1], [0, 0]), s([0, 1, 1, 1], [1, 1]))
  assert.equal(r.accept, false)
  assert.match(r.why, /regressed on t0/)
  assert.equal(decide(s([1, 0], [0, 0]), { t0: { pass: [1, 1] } }).accept, false)
})

test('decide tie breaks on cost and turns', () => {
  const base = s([1, 0]), cheap = { t0: { pass: [1, 0], turns: 3, cost: 0.1 } }
  assert.equal(decide(base, cheap).accept, true)
  assert.equal(decide(base, { t0: { pass: [1, 0], turns: 9, cost: 0.1 } }).accept, false)
})

test('seed evals have a dev and held-out split with checklists', () => {
  const t = loadTasks(`${K}/agents/ops.md`)
  assert.ok(t.length >= 3)
  assert.ok(t.some(x => x.split === 'dev') && t.filter(x => x.split === 'heldout').length >= 2)
  for (const x of t) assert.ok(x.prompt && x.checklist.length >= 3)
})
