import { createApp } from '../src/app.ts'
import { FakeClock } from '../src/util/clock.ts'

export function shop() {
  const clock = new FakeClock()
  const app = createApp({ clock })
  app.inventory.addWarehouse('ber', 1)
  app.inventory.addWarehouse('rtm', 2)
  app.catalog.add({ sku: 'MUG', name: 'Mug', priceCents: 1200 })
  app.catalog.add({ sku: 'TEE', name: 'Tee', priceCents: 2500, tiers: [{ minQty: 3, priceCents: 2200 }, { minQty: 10, priceCents: 2000 }] })
  app.catalog.add({ sku: 'PEN', name: 'Pen', priceCents: 199 })
  return { app, clock }
}

export function paidOrder(app: ReturnType<typeof shop>['app'], lines: [string, number][], promo?: string) {
  const o = app.orders.create('cust')
  for (const [sku, qty] of lines) app.orders.addLine(o.id, sku, qty)
  if (promo) app.orders.applyPromo(o.id, promo)
  app.orders.place(o.id)
  app.orders.pay(o.id, `pay_${o.id}`)
  return app.orders.get(o.id)
}
