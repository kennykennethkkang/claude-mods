import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitPrice } from '../src/domain/pricing.ts'
import { discountFor, validatePromo } from '../src/domain/promotions.ts'

const tee = { sku: 'TEE', name: 'Tee', priceCents: 2500, tiers: [{ minQty: 10, priceCents: 2000 }, { minQty: 3, priceCents: 2200 }] }

test('deepest reached tier wins', () => {
  assert.equal(unitPrice(tee, 2), 2500)
  assert.equal(unitPrice(tee, 3), 2200)
  assert.equal(unitPrice(tee, 12), 2000)
})

test('promo kinds', () => {
  const lines = [{ sku: 'A', qty: 5, unitPrice: 300 }, { sku: 'B', qty: 1, unitPrice: 1000 }]
  assert.equal(discountFor({ code: 'P10', kind: 'percent', value: 10 }, lines), 250)
  assert.equal(discountFor({ code: 'F5', kind: 'fixed', value: 5000 }, lines), 2500)
  assert.equal(discountFor({ code: 'B2', kind: 'bogo', value: 2, sku: 'A' }, lines), 300)
  assert.equal(discountFor({ code: 'MIN', kind: 'fixed', value: 100, minSubtotal: 3000 }, lines), 0)
})

test('promo validation', () => {
  assert.equal(validatePromo({ code: 'ok', kind: 'percent', value: 5 }), 'code must be 3-16 capitals or digits')
  assert.equal(validatePromo({ code: 'BIG', kind: 'percent', value: 101 }), 'percent above 100')
  assert.equal(validatePromo({ code: 'BOGO', kind: 'bogo', value: 1 }), 'bogo needs a sku')
})
