import test from 'node:test'
import assert from 'node:assert/strict'
import { wilson, aggregate, decode, personas, report, votesFromRatings } from './crowd-ab.mjs'

const v = (pick, n, seg = { age: '25-34', device: 'phone' }, reason = 'clearer') => Array.from({ length: n }, () => ({ pick, reason, seg }))

test('wilson matches known 95% interval', () => {
  const [lo, hi] = wilson(60, 100)
  assert.ok(Math.abs(lo - 0.502) < 0.002 && Math.abs(hi - 0.691) < 0.002, `${lo} ${hi}`)
  assert.deepEqual(wilson(0, 0), [0, 1])
})

test('clear lead declares a winner', () => {
  const a = aggregate([...v(0, 600), ...v(1, 300), ...v('none', 100)], ['A', 'B'])
  assert.equal(a.winner, 0)
  assert.equal(a.headToHead.rate, 600 / 900)
  assert.equal(a.share.none, 0.1)
  assert.equal(a.firstSlot, null)
  const b = aggregate([{ pick: 0, slot: 'first', seg: {} }, { pick: 1, slot: 'second', seg: {} }, { pick: 1, slot: 'first', seg: {} }, { pick: 'none', slot: 'none', seg: {} }], ['A', 'B'])
  assert.equal(b.firstSlot, 2 / 3)
})

test('near tie declares no winner, none votes stay out of head to head', () => {
  const a = aggregate([...v(0, 52), ...v(1, 48), ...v('none', 400)], ['A', 'B'])
  assert.equal(a.winner, null)
  assert.ok(a.headToHead.ci[0] < 0.5)
})

test('three options: leader vs runner up only', () => {
  const a = aggregate([...v(2, 500), ...v(1, 300), ...v(0, 50)], ['A', 'B', 'C'])
  assert.equal(a.headToHead.leader, 2)
  assert.equal(a.headToHead.runnerUp, 1)
  assert.equal(a.winner, 2)
})

test('segments and reasons', () => {
  const a = aggregate([...v(0, 30, { age: '65+', device: 'phone' }, 'accessible'), ...v(1, 10, { age: '18-24', device: 'desktop' }, 'looks')], ['A', 'B'])
  assert.equal(a.segments.age['65+'].leadRate, 1)
  assert.equal(a.segments.age['18-24'].leadRate, 0)
  assert.deepEqual(a.reasons[0][0], ['accessible', 30])
  assert.match(report(a, ['A', 'B']), /Verdict: A wins/)
})

test('decode maps shuffled slots back and personas shuffle position', () => {
  assert.equal(decode('first', [1, 0]), 1)
  assert.equal(decode('second', [1, 0]), 0)
  assert.equal(decode('none', [1, 0]), 'none')
  assert.equal(decode('third', [1, 0]), 'none')
  const ps = personas(1000, 7, 2)
  const firstIsA = ps.filter(p => p.order[0] === 0).length
  assert.ok(firstIsA > 440 && firstIsA < 560, String(firstIsA))
  assert.deepEqual(personas(5, 7, 2), personas(5, 7, 2))
})

test('ratings become votes, close scores are no preference, partial personas dropped', () => {
  const r = (p, o, appeal, reason = 'clearer') => ({ p, o, appeal, reason, age: '65+' })
  const v = votesFromRatings([r(0, 0, 3.2), r(0, 1, 1.0, 'looks'), r(1, 0, 2.0), r(1, 1, 2.1), r(2, 0, 4), { p: 2, o: 1, _error: 'x' }], 2)
  assert.equal(v.length, 2)
  assert.deepEqual([v[0].pick, v[0].reason, v[0].seg.age], [0, 'clearer', '65+'])
  assert.equal(v[1].pick, 'none')
})
