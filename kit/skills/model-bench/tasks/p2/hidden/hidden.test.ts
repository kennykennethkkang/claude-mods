import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './src/app.ts'
import { FakeClock } from './src/util/clock.ts'
import { HOLD_MS } from './src/service/orders.ts'

const T0 = 1_700_000_000_000

function setup() {
  const clock = new FakeClock(T0)
  const app: any = createApp({ clock })
  app.inventory.addWarehouse('ber', 1)
  app.inventory.addWarehouse('rtm', 2)
  app.catalog.add({ sku: 'MUG', name: 'Mug', priceCents: 1200 })
  app.catalog.add({ sku: 'TEE', name: 'Tee', priceCents: 2500, tiers: [{ minQty: 3, priceCents: 2200 }] })
  app.catalog.add({ sku: 'PEN', name: 'Pen', priceCents: 199 })
  app.catalog.add({ sku: 'GUM', name: 'Gum', priceCents: 30 })
  for (const s of ['BOXA', 'BOXB', 'BOXC']) app.catalog.add({ sku: s, name: s, priceCents: 1005 })
  for (const s of ['MUG', 'TEE', 'PEN', 'GUM', 'BOXA', 'BOXB', 'BOXC']) app.inventory.receive('ber', s, 20)
  return { app, clock }
}

function order(app: any, lines: [string, number][], o: { promo?: string; currency?: string; pay?: boolean; place?: boolean } = {}) {
  const ord = o.currency ? app.orders.create('cust', o.currency) : app.orders.create('cust')
  for (const [sku, qty] of lines) app.orders.addLine(ord.id, sku, qty)
  if (o.promo) app.orders.applyPromo(ord.id, o.promo)
  if (o.place === false) return app.orders.get(ord.id)
  app.orders.place(ord.id)
  if (o.pay !== false) app.orders.pay(ord.id, `pay_${ord.id}`)
  return app.orders.get(ord.id)
}

const lvl = (app: any, wh: string, sku: string) => {
  const r = app.inventory.levels().find((l: any) => l.warehouse === wh && l.sku === sku)
  return r ? { onHand: r.onHand, reserved: r.reserved } : { onHand: 0, reserved: 0 }
}
const status = (n: number) => (e: any) => e?.status === n
const line = (o: any, sku: string) => o.lines.find((l: any) => l.sku === sku)

// receipts

test('receipt lines add up to the total on a rounding edge', () => {
  const { app } = setup()
  app.promos.create({ code: 'TEN', kind: 'percent', value: 10 })
  const o = order(app, [['BOXA', 1], ['BOXB', 1], ['BOXC', 1]], { promo: 'TEN' })
  assert.deepEqual(o.totals, { subtotal: 3015, discount: 302, total: 2713 })
  const r = app.receipt(o.id)
  assert.deepEqual(r.lines.map((l: any) => l.discount), [101, 101, 100])
  assert.deepEqual(r.lines.map((l: any) => l.net), [904, 904, 905])
})

test('receipt nets sum to total across many percents', () => {
  for (let pct = 1; pct <= 40; pct++) {
    const { app } = setup()
    app.promos.create({ code: `P${pct}X`, kind: 'percent', value: pct })
    const o = order(app, [['BOXA', 1], ['BOXB', 1], ['PEN', 1], ['GUM', 1]], { promo: `P${pct}X` })
    const r = app.receipt(o.id)
    assert.equal(r.lines.reduce((s: number, l: any) => s + l.net, 0), o.totals.total, `pct ${pct}`)
    assert.equal(r.lines.reduce((s: number, l: any) => s + l.discount, 0), o.totals.discount, `pct ${pct}`)
  }
})

test('receipt bogo discount stays on its sku', () => {
  const { app } = setup()
  app.promos.create({ code: 'PEN3', kind: 'bogo', value: 2, sku: 'PEN' })
  const o = order(app, [['MUG', 1], ['PEN', 3]], { promo: 'PEN3' })
  const r = app.receipt(o.id)
  assert.deepEqual(r.lines.map((l: any) => [l.sku, l.discount, l.net]), [['MUG', 0, 1200], ['PEN', 199, 398]])
  assert.equal(r.total, 1598)
})

test('receipt fixed discount splits by weight and keeps the total', () => {
  const { app } = setup()
  app.promos.create({ code: 'OFF10', kind: 'fixed', value: 1000 })
  const o = order(app, [['MUG', 1], ['TEE', 1], ['PEN', 1]], { promo: 'OFF10' })
  const r = app.receipt(o.id)
  assert.deepEqual(r.lines.map((l: any) => l.discount), [308, 641, 51])
  assert.equal(r.total, 2899)
  assert.equal(r.currency, 'USD')
})

// stock goes back where it came from

function crossWarehouse() {
  const { app, clock } = setup()
  app.inventory.receive('rtm', 'CUP', 5)
  app.catalog.add({ sku: 'CUP', name: 'Cup', priceCents: 800 })
  const a = order(app, [['CUP', 5]], { pay: false })
  app.inventory.receive('ber', 'CUP', 5)
  const b = order(app, [['CUP', 5]])
  return { app, clock, a, b }
}

test('cancel returns stock to the warehouse it was reserved from', () => {
  const { app, a } = crossWarehouse()
  app.orders.cancel(a.id)
  assert.deepEqual(lvl(app, 'ber', 'CUP'), { onHand: 5, reserved: 5 })
  assert.deepEqual(lvl(app, 'rtm', 'CUP'), { onHand: 5, reserved: 0 })
})

test('shipping after a cross warehouse cancel leaves true levels', () => {
  const { app, a, b } = crossWarehouse()
  app.orders.cancel(a.id)
  app.orders.ship(b.id)
  assert.deepEqual(lvl(app, 'ber', 'CUP'), { onHand: 0, reserved: 0 })
  assert.equal(app.inventory.available('CUP', 'rtm'), 5)
  assert.equal(app.inventory.available('CUP'), 5)
})

test('expiry returns stock to the warehouse it was reserved from', () => {
  const { app, clock, a } = crossWarehouse()
  clock.advance(HOLD_MS + 1)
  assert.ok(app.orders.expireStale().includes(a.id))
  assert.deepEqual(lvl(app, 'rtm', 'CUP'), { onHand: 5, reserved: 0 })
  assert.deepEqual(lvl(app, 'ber', 'CUP'), { onHand: 5, reserved: 5 })
})

test('paying an overdue hold returns its own stock', () => {
  const { app, clock, a } = crossWarehouse()
  clock.advance(HOLD_MS + 1)
  assert.throws(() => app.orders.pay(a.id, 'late'), status(409))
  assert.equal(app.orders.get(a.id).status, 'expired')
  assert.deepEqual(lvl(app, 'ber', 'CUP'), { onHand: 5, reserved: 5 })
})

test('no level goes negative after mixed cancels and ships', () => {
  const { app, a, b } = crossWarehouse()
  app.orders.cancel(a.id)
  app.orders.ship(b.id)
  const c = order(app, [['CUP', 5]])
  app.orders.ship(c.id)
  for (const l of app.inventory.levels()) {
    assert.ok(l.reserved >= 0 && l.onHand >= 0 && l.available >= 0, JSON.stringify(l))
  }
  assert.equal(app.inventory.available('CUP'), 0)
})

// promo uses

test('applying a code twice to a draft uses nothing', () => {
  const { app } = setup()
  app.promos.create({ code: 'ONCE', kind: 'percent', value: 10, maxUses: 1 })
  const o = order(app, [['MUG', 1]], { promo: 'ONCE', place: false })
  app.orders.applyPromo(o.id, 'ONCE')
  assert.equal(app.promos.uses('ONCE'), 0)
  app.orders.place(o.id)
  assert.equal(app.promos.uses('ONCE'), 1)
})

test('drafts can hold a code but only one can place it', () => {
  const { app } = setup()
  app.promos.create({ code: 'ONCE', kind: 'percent', value: 10, maxUses: 1 })
  const a = order(app, [['MUG', 1]], { promo: 'ONCE', place: false })
  const b = order(app, [['MUG', 2]], { promo: 'ONCE', place: false })
  app.orders.place(a.id)
  assert.throws(() => app.orders.place(b.id), status(409))
  assert.equal(app.orders.get(b.id).status, 'draft')
  assert.equal(app.inventory.available('MUG'), 19)
})

test('cancel gives the use back', () => {
  const { app } = setup()
  app.promos.create({ code: 'SPRING', kind: 'percent', value: 10, maxUses: 1 })
  const a = order(app, [['MUG', 1]], { promo: 'SPRING', pay: false })
  app.orders.cancel(a.id)
  assert.equal(app.promos.uses('SPRING'), 0)
  const b = order(app, [['MUG', 1]], { promo: 'SPRING' })
  assert.equal(b.promo, 'SPRING')
  assert.equal(app.promos.uses('SPRING'), 1)
})

test('expiry gives the use back', () => {
  const { app, clock } = setup()
  app.promos.create({ code: 'SPRING', kind: 'percent', value: 10, maxUses: 1 })
  order(app, [['MUG', 1]], { promo: 'SPRING', pay: false })
  clock.advance(HOLD_MS + 1)
  app.orders.expireStale()
  assert.equal(app.promos.uses('SPRING'), 0)
  assert.equal(order(app, [['MUG', 1]], { promo: 'SPRING' }).status, 'paid')
})

test('switching and removing codes on a draft uses nothing', () => {
  const { app } = setup()
  app.promos.create({ code: 'ONCE', kind: 'percent', value: 10, maxUses: 1 })
  app.promos.create({ code: 'OTHER', kind: 'fixed', value: 100, maxUses: 1 })
  const o = order(app, [['MUG', 1]], { promo: 'ONCE', place: false })
  app.orders.applyPromo(o.id, 'OTHER')
  app.orders.applyPromo(o.id, null)
  app.orders.applyPromo(o.id, 'ONCE')
  assert.equal(app.promos.uses('OTHER'), 0)
  app.orders.place(o.id)
  assert.equal(app.promos.uses('ONCE'), 1)
  assert.equal(app.promos.uses('OTHER'), 0)
})

test('placed, paid and shipped orders each hold a use', () => {
  const { app } = setup()
  app.promos.create({ code: 'SPRING', kind: 'percent', value: 10, maxUses: 3 })
  order(app, [['MUG', 1]], { promo: 'SPRING', pay: false })
  order(app, [['MUG', 1]], { promo: 'SPRING' })
  const c = order(app, [['MUG', 1]], { promo: 'SPRING' })
  app.orders.ship(c.id)
  assert.equal(app.promos.uses('SPRING'), 3)
  const d = order(app, [['MUG', 1]], { place: false })
  assert.throws(() => app.orders.applyPromo(d.id, 'SPRING'), status(409))
  assert.equal(app.handle({ method: 'GET', path: '/promos/SPRING' }).body.uses, 3)
})

// currencies

test('orders default to USD at rate 1', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 1]])
  assert.equal(o.currency, 'USD')
  assert.equal(o.fxRate, '1')
  assert.equal(o.totals.total, 1200)
  assert.equal(app.fx.rateAt('USD', T0), '1')
})

test('EUR order converts unit prices at the locked rate', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.92', T0)
  const o = order(app, [['MUG', 2]], { currency: 'EUR' })
  assert.equal(o.currency, 'EUR')
  assert.equal(o.fxRate, '0.92')
  assert.equal(line(o, 'MUG').unitPrice, 1104)
  assert.equal(o.totals.total, 2208)
})

test('conversion is exact half up', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '1.15', T0)
  const o = order(app, [['GUM', 1]], { currency: 'EUR' })
  assert.equal(line(o, 'GUM').unitPrice, 35)
})

test('JPY and KWD use their own decimals', () => {
  const { app } = setup()
  app.fx.setRate('JPY', '151.37', T0)
  app.fx.setRate('KWD', '0.3075', T0)
  assert.equal(line(order(app, [['MUG', 1]], { currency: 'JPY' }), 'MUG').unitPrice, 1816)
  assert.equal(line(order(app, [['MUG', 1]], { currency: 'KWD' }), 'MUG').unitPrice, 3690)
})

test('rate is locked at creation', () => {
  const { app, clock } = setup()
  app.fx.setRate('EUR', '0.92', T0)
  const o = app.orders.create('c', 'EUR')
  clock.advance(1000)
  app.fx.setRate('EUR', '0.5', clock.now())
  app.orders.addLine(o.id, 'MUG', 1)
  assert.equal(app.orders.get(o.id).totals.total, 1104)
  const n = app.orders.create('c', 'EUR')
  app.orders.addLine(n.id, 'MUG', 1)
  assert.equal(n.fxRate, '0.5')
  assert.equal(app.orders.get(n.id).totals.total, 600)
})

test('future rates are not in force yet', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '2', T0 + 5000)
  app.fx.setRate('EUR', '0.92', T0 - 1000)
  assert.equal(app.fx.rateAt('EUR', T0), '0.92')
  assert.equal(app.fx.rateAt('EUR', T0 + 5000), '2')
  assert.equal(app.orders.create('c', 'EUR').fxRate, '0.92')
})

test('missing rate or unknown currency is a 400', () => {
  const { app } = setup()
  assert.throws(() => app.orders.create('c', 'GBP'), status(400))
  assert.throws(() => app.orders.create('c', 'XXX'), status(400))
  app.fx.setRate('GBP', '0.8', T0 + 1)
  assert.throws(() => app.orders.create('c', 'GBP'), status(400))
  assert.equal(app.handle({ method: 'POST', path: '/orders', body: { customer: 'c', currency: 'GBP' } }).status, 400)
})

test('bad rates are rejected', () => {
  const { app } = setup()
  for (const r of ['abc', '-1', '0', '0.000', '1.1234567', '', '1e3']) {
    assert.throws(() => app.fx.setRate('EUR', r, T0), status(400), r)
  }
  assert.throws(() => app.fx.setRate('XXX', '1', T0), status(400))
})

test('tier price converts after the tier is picked', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.92', T0)
  const o = order(app, [['TEE', 3]], { currency: 'EUR' })
  assert.equal(line(o, 'TEE').unitPrice, 2024)
  assert.equal(o.totals.subtotal, 6072)
})

test('fixed promo value converts', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.9', T0)
  app.promos.create({ code: 'FIVE', kind: 'fixed', value: 500 })
  const o = order(app, [['MUG', 1]], { currency: 'EUR', promo: 'FIVE' })
  assert.deepEqual(o.totals, { subtotal: 1080, discount: 450, total: 630 })
})

test('minSubtotal converts', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.5', T0)
  app.promos.create({ code: 'MIN20', kind: 'fixed', value: 100, minSubtotal: 2000 })
  assert.equal(order(app, [['MUG', 1]], { currency: 'EUR', promo: 'MIN20' }).totals.discount, 0)
  assert.equal(order(app, [['MUG', 2]], { currency: 'EUR', promo: 'MIN20' }).totals.discount, 50)
})

test('JPY percent rounds to whole yen', () => {
  const { app } = setup()
  app.fx.setRate('JPY', '150', T0)
  app.promos.create({ code: 'TEN', kind: 'percent', value: 10 })
  const o = order(app, [['PEN', 1]], { currency: 'JPY', promo: 'TEN' })
  assert.deepEqual(o.totals, { subtotal: 299, discount: 30, total: 269 })
  assert.equal(app.receipt(o.id).currency, 'JPY')
})

test('sales report is per currency', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.92', T0)
  order(app, [['MUG', 1]])
  order(app, [['MUG', 1]], { currency: 'EUR' })
  assert.deepEqual(app.reports.sales(), { orders: 1, gross: 1200, refunds: 0, net: 1200 })
  assert.deepEqual(app.reports.sales('EUR'), { orders: 1, gross: 1104, refunds: 0, net: 1104 })
  assert.equal(app.handle({ method: 'GET', path: '/reports/sales/EUR' }).body.gross, 1104)
})

test('fx and currency over http', () => {
  const { app } = setup()
  const h = app.handle
  const r = h({ method: 'PUT', path: '/fx/EUR', body: { rate: '0.92', effectiveAt: T0 } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { currency: 'EUR', rate: '0.92', effectiveAt: T0 })
  assert.equal(h({ method: 'PUT', path: '/fx/EUR', body: { rate: 'x', effectiveAt: T0 } }).status, 400)
  const o = h({ method: 'POST', path: '/orders', body: { customer: 'c', currency: 'EUR' } })
  assert.equal(o.status, 201)
  assert.equal(o.body.fxRate, '0.92')
  assert.equal(h({ method: 'POST', path: `/orders/${o.body.id}/lines`, body: { sku: 'MUG', qty: 1 } }).body.totals.total, 1104)
})

// shipments

function split() {
  const { app, clock } = setup()
  app.catalog.add({ sku: 'CUP', name: 'Cup', priceCents: 800 })
  app.inventory.receive('ber', 'CUP', 2)
  app.inventory.receive('rtm', 'CUP', 5)
  const o = order(app, [['CUP', 4], ['MUG', 2]])
  return { app, clock, o }
}

test('partial shipment takes from allocations in order', () => {
  const { app, o } = split()
  app.orders.ship(o.id, [{ sku: 'CUP', qty: 3 }])
  const g = app.orders.get(o.id)
  assert.equal(g.status, 'partially_shipped')
  assert.equal(line(g, 'CUP').shipped, 3)
  assert.equal(line(g, 'MUG').shipped, 0)
  assert.deepEqual(lvl(app, 'ber', 'CUP'), { onHand: 0, reserved: 0 })
  assert.deepEqual(lvl(app, 'rtm', 'CUP'), { onHand: 4, reserved: 1 })
})

test('ship with no items sends the rest', () => {
  const { app, o } = split()
  app.orders.ship(o.id, [{ sku: 'CUP', qty: 3 }])
  app.orders.ship(o.id)
  const g = app.orders.get(o.id)
  assert.equal(g.status, 'shipped')
  assert.deepEqual(g.lines.map((l: any) => l.shipped), [4, 2])
  const ev = app.log.forOrder(o.id).filter((e: any) => e.type === 'shipped')
  assert.deepEqual(ev.map((e: any) => e.data.items), [[{ sku: 'CUP', qty: 3 }], [{ sku: 'CUP', qty: 1 }, { sku: 'MUG', qty: 2 }]])
  assert.deepEqual(lvl(app, 'rtm', 'CUP'), { onHand: 3, reserved: 0 })
  assert.deepEqual(lvl(app, 'ber', 'MUG'), { onHand: 18, reserved: 0 })
})

test('full ship in one go still works', () => {
  const { app, o } = split()
  app.orders.ship(o.id)
  const g = app.orders.get(o.id)
  assert.equal(g.status, 'shipped')
  assert.deepEqual(g.lines.map((l: any) => l.shipped), [4, 2])
  assert.equal(app.inventory.available('CUP'), 3)
})

test('over shipping is refused and changes nothing', () => {
  const { app, o } = split()
  assert.throws(() => app.orders.ship(o.id, [{ sku: 'MUG', qty: 1 }, { sku: 'CUP', qty: 9 }]), status(409))
  const g = app.orders.get(o.id)
  assert.equal(g.status, 'paid')
  assert.equal(line(g, 'MUG').shipped, 0)
  assert.deepEqual(lvl(app, 'ber', 'MUG'), { onHand: 20, reserved: 2 })
})

test('shipping a sku not on the order is a 400', () => {
  const { app, o } = split()
  assert.throws(() => app.orders.ship(o.id, [{ sku: 'PEN', qty: 1 }]), status(400))
})

test('unpaid orders do not ship', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 1]], { pay: false })
  assert.throws(() => app.orders.ship(o.id), status(409))
  assert.throws(() => app.orders.ship(o.id, [{ sku: 'MUG', qty: 1 }]), status(409))
})

test('cancel is refused once anything shipped', () => {
  const { app, o } = split()
  app.orders.ship(o.id, [{ sku: 'MUG', qty: 1 }])
  assert.throws(() => app.orders.cancel(o.id), status(409))
  assert.equal(app.orders.get(o.id).status, 'partially_shipped')
})

test('pay stays idempotent on a partially shipped order', () => {
  const { app, o } = split()
  app.orders.ship(o.id, [{ sku: 'MUG', qty: 1 }])
  assert.equal(app.orders.pay(o.id, `pay_${o.id}`).status, 'partially_shipped')
  assert.throws(() => app.orders.pay(o.id, 'other'), status(409))
})

test('partial ship over http', () => {
  const { app, o } = split()
  const r = app.handle({ method: 'POST', path: `/orders/${o.id}/ship`, body: { items: [{ sku: 'CUP', qty: 1 }] } })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'partially_shipped')
  assert.equal(app.handle({ method: 'POST', path: `/orders/${o.id}/ship` }).body.status, 'shipped')
})

// returns

function shipped(lines: [string, number][], promo?: string) {
  const { app } = setup()
  if (promo) app.promos.create({ code: promo, kind: 'percent', value: 10 })
  const o = order(app, lines, { promo })
  app.orders.ship(o.id)
  return { app, o: app.orders.get(o.id) }
}

test('full return refunds the total', () => {
  const { app, o } = shipped([['MUG', 2]])
  assert.deepEqual(app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 2 }], 'ber'), { refund: 2400 })
  const g = app.orders.get(o.id)
  assert.equal(g.refunded, 2400)
  assert.equal(g.status, 'returned')
  assert.equal(line(g, 'MUG').returned, 2)
})

test('unit by unit refunds floor the running share', () => {
  const { app, o } = shipped([['BOXA', 3]], 'TEN')
  assert.equal(o.totals.total, 2713)
  const got = [1, 1, 1].map(q => app.orders.returnItems(o.id, [{ sku: 'BOXA', qty: q }], null).refund)
  assert.deepEqual(got, [904, 904, 905])
  assert.equal(app.orders.get(o.id).refunded, 2713)
})

test('returning every line refunds exactly the total', () => {
  const { app, o } = shipped([['BOXA', 1], ['BOXB', 1], ['BOXC', 1]], 'TEN')
  const got = ['BOXA', 'BOXB', 'BOXC'].map(s => app.orders.returnItems(o.id, [{ sku: s, qty: 1 }], 'ber').refund)
  assert.deepEqual(got, [904, 904, 905])
  assert.equal(app.orders.get(o.id).refunded, o.totals.total)
})

test('restock goes to the named warehouse, damaged goods do not', () => {
  const { app, o } = shipped([['MUG', 2]])
  assert.deepEqual(lvl(app, 'ber', 'MUG'), { onHand: 18, reserved: 0 })
  app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], 'rtm')
  app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], null)
  assert.deepEqual(lvl(app, 'rtm', 'MUG'), { onHand: 1, reserved: 0 })
  assert.deepEqual(lvl(app, 'ber', 'MUG'), { onHand: 18, reserved: 0 })
})

test('cannot return more than shipped', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 2]])
  app.orders.ship(o.id, [{ sku: 'MUG', qty: 1 }])
  assert.throws(() => app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 2 }], 'ber'), status(409))
  assert.equal(app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], 'ber').refund, 1200)
  assert.throws(() => app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], 'ber'), status(409))
})

test('unknown restock warehouse changes nothing', () => {
  const { app, o } = shipped([['MUG', 2]])
  assert.throws(() => app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], 'nowhere'), status(404))
  const g = app.orders.get(o.id)
  assert.equal(g.refunded, 0)
  assert.equal(line(g, 'MUG').returned, 0)
})

test('return of a sku not on the order is a 400', () => {
  const { app, o } = shipped([['MUG', 2]])
  assert.throws(() => app.orders.returnItems(o.id, [{ sku: 'PEN', qty: 1 }], null), status(400))
})

test('partial return keeps the status and logs the return', () => {
  const { app, o } = shipped([['MUG', 2], ['PEN', 1]])
  const { refund } = app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }, { sku: 'PEN', qty: 1 }], 'ber')
  assert.equal(refund, 1399)
  assert.equal(app.orders.get(o.id).status, 'shipped')
  const ev = app.log.forOrder(o.id).filter((e: any) => e.type === 'returned')
  assert.equal(ev.length, 1)
  assert.deepEqual(ev[0].data, { items: [{ sku: 'MUG', qty: 1 }, { sku: 'PEN', qty: 1 }], refund: 1399, restockTo: 'ber' })
})

test('returns before shipping are refused', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 1]])
  assert.throws(() => app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], null), status(409))
})

test('sales report counts return refunds', () => {
  const { app, o } = shipped([['MUG', 2]])
  order(app, [['PEN', 1]])
  app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], null)
  assert.deepEqual(app.reports.sales(), { orders: 2, gross: 2599, refunds: 1200, net: 1399 })
})

test('paid cancel records refunded', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 2]])
  app.orders.cancel(o.id)
  assert.equal(app.orders.get(o.id).refunded, 2400)
  assert.deepEqual(app.reports.sales(), { orders: 1, gross: 2400, refunds: 2400, net: 0 })
})

test('returned orders still hold their promo use', () => {
  const { app } = setup()
  app.promos.create({ code: 'ONCE', kind: 'percent', value: 10, maxUses: 1 })
  const o = order(app, [['MUG', 1]], { promo: 'ONCE' })
  app.orders.ship(o.id)
  app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], 'ber')
  assert.equal(app.orders.get(o.id).status, 'returned')
  assert.equal(app.promos.uses('ONCE'), 1)
})

test('returns in another currency refund in that currency', () => {
  const { app } = setup()
  app.fx.setRate('EUR', '0.92', T0)
  const o = order(app, [['MUG', 3]], { currency: 'EUR' })
  app.orders.ship(o.id)
  assert.equal(app.orders.returnItems(o.id, [{ sku: 'MUG', qty: 1 }], null).refund, 1104)
  assert.deepEqual(app.reports.sales('EUR'), { orders: 1, gross: 3312, refunds: 1104, net: 2208 })
  assert.equal(app.reports.sales().gross, 0)
})

test('returns over http', () => {
  const { app, o } = shipped([['MUG', 2]])
  const r = app.handle({ method: 'POST', path: `/orders/${o.id}/returns`, body: { items: [{ sku: 'MUG', qty: 1 }], restockTo: null } })
  assert.equal(r.status, 200)
  assert.equal(r.body.refund, 1200)
  assert.equal(r.body.order.refunded, 1200)
  assert.equal(app.handle({ method: 'POST', path: `/orders/${o.id}/returns`, body: { items: [] , restockTo: null } }).status, 400)
})

// old behaviour

test('lifecycle and events unchanged', () => {
  const { app } = setup()
  const o = order(app, [['MUG', 2]])
  app.orders.ship(o.id)
  assert.deepEqual(app.log.forOrder(o.id).map((e: any) => e.type), ['created', 'placed', 'paid', 'shipped'])
  assert.deepEqual(app.log.forOrder(o.id)[3].data, { items: [{ sku: 'MUG', qty: 2 }] })
})

test('tiers, merging and caps still hold', () => {
  const { app } = setup()
  app.promos.create({ code: 'CAP', kind: 'percent', value: 10, maxUses: 1 })
  const o = order(app, [['TEE', 2], ['TEE', 1]], { promo: 'CAP' })
  assert.equal(o.lines.length, 1)
  assert.deepEqual(o.totals, { subtotal: 6600, discount: 660, total: 5940 })
  const d = order(app, [['MUG', 1]], { place: false })
  assert.throws(() => app.orders.applyPromo(d.id, 'CAP'), status(409))
})

test('old http flow still works', () => {
  const { app } = setup()
  const h = app.handle
  const id = h({ method: 'POST', path: '/orders', body: { customer: 'c' } }).body.id
  h({ method: 'POST', path: `/orders/${id}/lines`, body: { sku: 'MUG', qty: 3 } })
  assert.equal(h({ method: 'POST', path: `/orders/${id}/place` }).body.status, 'placed')
  assert.equal(h({ method: 'POST', path: `/orders/${id}/pay`, body: { paymentId: 'x' } }).body.status, 'paid')
  assert.equal(h({ method: 'POST', path: `/orders/${id}/cancel` }).body.status, 'cancelled')
  assert.equal(h({ method: 'GET', path: '/reports/sales' }).body.net, 0)
  assert.equal(h({ method: 'GET', path: '/stock/MUG' }).body.available, 20)
})
