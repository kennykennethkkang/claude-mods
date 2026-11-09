import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJudge, goldMatch, summarize } from './score.mjs'

test('parseJudge takes the last JSON object, even inside a fence', () => {
  const text = 'thinking {"x":1}\n```json\n{"correct":1,"claims":[{"supported":1},{"supported":0}]}\n```'
  assert.deepEqual(parseJudge(text), { correct: 1, cited: 2, supported: 1 })
})

test('parseJudge clamps junk to zeros and survives no JSON', () => {
  assert.deepEqual(parseJudge('no json here'), { correct: 0, cited: 0, supported: 0, error: 'no json' })
  assert.deepEqual(parseJudge('{"correct":"yes","claims":[{"supported":true}]}'), { correct: 0, cited: 1, supported: 1 })
})

test('goldMatch needs every alias, as case-insensitive regexes', () => {
  assert.equal(goldMatch('It was the Pritzker Prize in 2003.', ['pritzker', '2003']), 1)
  assert.equal(goldMatch('Pritzker, 2001', ['pritzker', '2003']), 0)
  assert.equal(goldMatch('Mars has 2 moons', ['two|2']), 1)
  assert.equal(goldMatch('The symbol is Md.', ['\\bmd\\b']), 1)
  assert.equal(goldMatch('', ['x']), 0)
})

test('summarize averages per arm and drops runs that hit a limit', () => {
  const rows = [
    { arm: 'baseline', correct: 1, gold: 1, cited: 2, supported: 1, cost: 0.1 },
    { arm: 'baseline', correct: 0, gold: 0, cited: 0, supported: 0, cost: 0.2 },
    { arm: 'new', correct: 1, gold: 1, cited: 3, supported: 3, cost: 0.5 },
    { arm: 'new', limited: true, correct: 0, gold: 0, cited: 0, supported: 0, cost: 0 },
  ]
  const s = summarize(rows)
  assert.deepEqual(s.baseline, { n: 2, correct: 0.5, gold: 0.5, citation: 0.5, cost: 0.3 })
  assert.deepEqual(s.new, { n: 1, correct: 1, gold: 1, citation: 1, cost: 0.5 })
})
