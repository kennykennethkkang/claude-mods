import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shop } from './fixture.ts'

test('order flow over http', () => {
  const { app } = shop()
  const h = app.handle
  assert.equal(h({ method: 'POST', path: '/stock/ber/MUG', body: { qty: 4 } }).body.available, 4)
  const made = h({ method: 'POST', path: '/orders', body: { customer: 'c' } })
  assert.equal(made.status, 201)
  const id = made.body.id
  assert.equal(h({ method: 'POST', path: `/orders/${id}/lines`, body: { sku: 'MUG', qty: 3 } }).body.totals.total, 3600)
  assert.equal(h({ method: 'POST', path: `/orders/${id}/place` }).body.status, 'placed')
  assert.equal(h({ method: 'POST', path: `/orders/${id}/pay`, body: { paymentId: 'x' } }).body.status, 'paid')
  assert.equal(h({ method: 'POST', path: `/orders/${id}/ship` }).body.status, 'shipped')
  assert.equal(h({ method: 'GET', path: '/stock/MUG' }).body.available, 1)
})

test('errors map to status codes', () => {
  const { app } = shop()
  const h = app.handle
  assert.equal(h({ method: 'GET', path: '/orders/nope' }).status, 404)
  assert.equal(h({ method: 'POST', path: '/orders', body: {} }).status, 400)
  assert.equal(h({ method: 'DELETE', path: '/orders' }).status, 405)
  assert.equal(h({ method: 'GET', path: '/nothing/here' }).status, 404)
  const id = h({ method: 'POST', path: '/orders', body: { customer: 'c' } }).body.id
  h({ method: 'POST', path: `/orders/${id}/lines`, body: { sku: 'MUG', qty: 1 } })
  const r = h({ method: 'POST', path: `/orders/${id}/place` })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'out_of_stock')
})

test('stock transfer and csv export', () => {
  const { app } = shop()
  const h = app.handle
  h({ method: 'POST', path: '/stock/ber/MUG', body: { qty: 4 } })
  assert.deepEqual(h({ method: 'POST', path: '/stock/transfer', body: { from: 'ber', to: 'rtm', sku: 'MUG', qty: 1 } }).body, { from: 3, to: 1 })
  const csv = h({ method: 'GET', path: '/stock.csv' }).body
  assert.equal(csv, 'warehouse,sku,onHand,reserved,available\nber,MUG,3,0,3\nrtm,MUG,1,0,1\n')
})
