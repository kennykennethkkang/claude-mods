import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocate, decimals, format, percentOf, roundHalfUp } from '../src/util/money.ts'

test('rounds half away from zero', () => {
  assert.equal(roundHalfUp(2.5), 3)
  assert.equal(roundHalfUp(-2.5), -3)
  assert.equal(roundHalfUp(2.4), 2)
})

test('percentOf rounds the result', () => {
  assert.equal(percentOf(1005, 10), 101)
  assert.equal(percentOf(3015, 10), 302)
})

test('allocate keeps the total', () => {
  assert.deepEqual(allocate(302, [1005, 1005, 1005]), [101, 101, 100])
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3])
  assert.deepEqual(allocate(5, [0, 0]), [0, 0])
})

test('format by currency decimals', () => {
  assert.equal(format(1234, 'USD'), '12.34 USD')
  assert.equal(format(-5, 'EUR'), '-0.05 EUR')
  assert.equal(format(1500, 'JPY'), '1500 JPY')
  assert.equal(decimals('KWD'), 3)
  assert.throws(() => decimals('XXX'), /unsupported/)
})

test('csv quotes awkward cells', async () => {
  const { toCsv } = await import('../src/util/csv.ts')
  assert.equal(toCsv([{ a: 'x,y', b: 'say "hi"', c: null }]), 'a,b,c\n"x,y","say ""hi""",\n')
  assert.equal(toCsv([]), '\n')
})
