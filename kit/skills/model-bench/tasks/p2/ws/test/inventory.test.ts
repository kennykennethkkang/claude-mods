import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shop } from './fixture.ts'

test('reserve fills by priority and splits', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 2)
  app.inventory.receive('rtm', 'MUG', 5)
  const allocs = app.inventory.reserve([{ sku: 'MUG', qty: 4 }])
  assert.deepEqual(allocs, [{ warehouse: 'ber', sku: 'MUG', qty: 2 }, { warehouse: 'rtm', sku: 'MUG', qty: 2 }])
  assert.equal(app.inventory.available('MUG'), 3)
  assert.equal(app.inventory.available('MUG', 'ber'), 0)
})

test('reserve is all or nothing', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 5)
  app.inventory.receive('ber', 'PEN', 1)
  assert.throws(() => app.inventory.reserve([{ sku: 'MUG', qty: 2 }, { sku: 'PEN', qty: 2 }]), /not enough PEN/)
  assert.equal(app.inventory.available('MUG'), 5)
})

test('cancel puts stock back in a single warehouse', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 3)
  const o = app.orders.create('c')
  app.orders.addLine(o.id, 'MUG', 3)
  app.orders.place(o.id)
  assert.equal(app.inventory.available('MUG'), 0)
  app.orders.cancel(o.id)
  assert.equal(app.inventory.available('MUG'), 3)
})

test('ship takes stock off the shelf', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 3)
  const o = app.orders.create('c')
  app.orders.addLine(o.id, 'MUG', 2)
  app.orders.place(o.id)
  app.orders.pay(o.id, 'p1')
  app.orders.ship(o.id)
  assert.deepEqual(app.inventory.levels().filter(l => l.warehouse === 'ber'), [{ warehouse: 'ber', sku: 'MUG', onHand: 1, reserved: 0, available: 1 }])
})

test('receive validates', () => {
  const { app } = shop()
  assert.throws(() => app.inventory.receive('nope', 'MUG', 1), /warehouse nope not found/)
  assert.throws(() => app.inventory.receive('ber', 'MUG', 0), /positive/)
})

test('transfer moves free stock only', () => {
  const { app } = shop()
  app.inventory.receive('ber', 'MUG', 5)
  app.inventory.reserve([{ sku: 'MUG', qty: 3 }])
  assert.throws(() => app.inventory.transfer('ber', 'rtm', 'MUG', 3), /not enough MUG/)
  app.inventory.transfer('ber', 'rtm', 'MUG', 2)
  assert.equal(app.inventory.available('MUG', 'ber'), 0)
  assert.equal(app.inventory.available('MUG', 'rtm'), 2)
  assert.throws(() => app.inventory.transfer('ber', 'ber', 'MUG', 1), /two warehouses/)
  assert.equal(app.log.ofType('transferred').length, 1)
})
