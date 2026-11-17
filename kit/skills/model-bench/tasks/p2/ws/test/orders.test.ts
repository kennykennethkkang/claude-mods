import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOLD_MS } from '../src/service/orders.ts'
import { paidOrder, shop } from './fixture.ts'

test('lines merge and tiers reprice', () => {
  const { app } = shop()
  const o = app.orders.create('c')
  app.orders.addLine(o.id, 'TEE', 2)
  assert.equal(o.totals.total, 5000)
  app.orders.addLine(o.id, 'TEE', 1)
  assert.equal(o.lines.length, 1)
  assert.equal(o.totals.total, 6600)
  app.orders.setQty(o.id, 'TEE', 0)
  assert.equal(o.lines.length, 0)
})

test('full lifecycle with events', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 5)
  const o = paidOrder(app, [['MUG', 2]])
  app.orders.ship(o.id)
  assert.equal(o.status, 'shipped')
  assert.deepEqual(app.log.forOrder(o.id).map(e => e.type), ['created', 'placed', 'paid', 'shipped'])
})

test('pay is idempotent per paymentId', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 5)
  const o = paidOrder(app, [['MUG', 1]])
  assert.equal(app.orders.pay(o.id, `pay_${o.id}`).status, 'paid')
  assert.throws(() => app.orders.pay(o.id, 'other'), /already paid/)
  assert.equal(app.log.forOrder(o.id).filter(e => e.type === 'paid').length, 1)
})

test('holds expire', () => {
  const { app, clock } = shop()
  app.inventory.receive('ber', 'MUG', 1)
  const o = app.orders.create('c')
  app.orders.addLine(o.id, 'MUG', 1)
  app.orders.place(o.id)
  clock.advance(HOLD_MS + 1)
  assert.throws(() => app.orders.pay(o.id, 'p'), /expired/)
  assert.equal(o.status, 'expired')
  assert.equal(app.inventory.available('MUG'), 1)
})

test('expireStale sweeps overdue holds only', () => {
  const { app, clock } = shop()
  app.inventory.receive('ber', 'MUG', 5)
  const a = app.orders.create('a')
  app.orders.addLine(a.id, 'MUG', 1)
  app.orders.place(a.id)
  clock.advance(HOLD_MS - 1000)
  const b = app.orders.create('b')
  app.orders.addLine(b.id, 'MUG', 1)
  app.orders.place(b.id)
  clock.advance(2000)
  assert.deepEqual(app.orders.expireStale(), [a.id])
  assert.equal(app.inventory.available('MUG'), 4)
})

test('promo applies and is capped', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 10)
  app.promos.create({ code: 'ONCE', kind: 'percent', value: 10, maxUses: 1 })
  const o = paidOrder(app, [['MUG', 2]], 'ONCE')
  assert.deepEqual(o.totals, { subtotal: 2400, discount: 240, total: 2160 })
  const o2 = app.orders.create('d')
  app.orders.addLine(o2.id, 'MUG', 1)
  assert.throws(() => app.orders.applyPromo(o2.id, 'ONCE'), /used up/)
})

test('receipt splits the discount', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 10)
  app.inventory.receive('ber', 'TEE', 10)
  app.promos.create({ code: 'TEN', kind: 'percent', value: 10 })
  const o = paidOrder(app, [['MUG', 1], ['TEE', 1]], 'TEN')
  const r = app.receipt(o.id)
  assert.deepEqual(r.lines.map(l => l.net), [1080, 2250])
  assert.equal(r.total, 3330)
})

test('paid cancel refunds and the report nets out', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 10)
  const a = paidOrder(app, [['MUG', 2]])
  paidOrder(app, [['MUG', 1]])
  app.orders.cancel(a.id)
  assert.deepEqual(app.reports.sales(), { orders: 2, gross: 3600, refunds: 2400, net: 1200 })
  assert.equal(app.inventory.available('MUG'), 9)
})

test('audit is clean after an ordinary day', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 3)
  app.inventory.receive('rtm', 'MUG', 3)
  app.promos.create({ code: 'DAY', kind: 'fixed', value: 300, maxUses: 2 })
  const a = paidOrder(app, [['MUG', 4]], 'DAY')
  const b = app.orders.create('b')
  app.orders.addLine(b.id, 'MUG', 1)
  app.orders.place(b.id)
  app.orders.ship(a.id)
  assert.deepEqual(app.audit.run(), [])
  assert.deepEqual(app.handle({ method: 'GET', path: '/admin/audit' }).body, { problems: [] })
})

test('audit flags reserved stock no order holds', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 3)
  app.inventory.reserve([{ sku: 'MUG', qty: 1 }])
  assert.deepEqual(app.audit.run(), ['ber/MUG reserved 1 but orders hold 0'])
})
