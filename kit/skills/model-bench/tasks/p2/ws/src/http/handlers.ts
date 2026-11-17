import type { App } from '../app.ts'
import { receipt } from '../service/receipts.ts'
import { toCsv } from '../util/csv.ts'
import { router } from './router.ts'
import { int, optStr, str } from './validate.ts'

export function handlers(app: App) {
  const { catalog, inventory, promos, orders, reports } = app
  const promoOf = (id: string) => {
    const o = orders.get(id)
    return o.promo ? promos.get(o.promo) : null
  }
  return router([
    ['POST', '/products', (_, b) => ({ status: 201, body: catalog.add(b) })],
    ['GET', '/products/:sku', p => catalog.get(p.sku)],
    ['POST', '/warehouses', (_, b) => {
      inventory.addWarehouse(str(b, 'id'), b.priority === undefined ? 100 : int(b, 'priority'))
      return { status: 201, body: { id: b.id } }
    }],
    ['POST', '/stock/:warehouse/:sku', (p, b) => {
      inventory.receive(p.warehouse, p.sku, int(b, 'qty', 1))
      return { sku: p.sku, available: inventory.available(p.sku) }
    }],
    ['GET', '/stock/:sku', p => ({ sku: p.sku, available: inventory.available(p.sku) })],
    ['GET', '/stock', () => inventory.levels()],
    ['GET', '/stock.csv', () => toCsv(inventory.levels(), ['warehouse', 'sku', 'onHand', 'reserved', 'available'])],
    ['POST', '/stock/transfer', (_, b) => {
      inventory.transfer(str(b, 'from'), str(b, 'to'), str(b, 'sku'), int(b, 'qty', 1))
      return { from: inventory.available(b.sku, b.from), to: inventory.available(b.sku, b.to) }
    }],
    ['POST', '/promos', (_, b) => ({ status: 201, body: promos.create(b) })],
    ['GET', '/promos/:code', p => ({ ...promos.get(p.code), uses: promos.uses(p.code) })],
    ['POST', '/orders', (_, b) => ({ status: 201, body: orders.create(str(b, 'customer')) })],
    ['GET', '/orders/:id', p => orders.get(p.id)],
    ['POST', '/orders/:id/lines', (p, b) => orders.addLine(p.id, str(b, 'sku'), int(b, 'qty', 1))],
    ['PUT', '/orders/:id/lines/:sku', (p, b) => orders.setQty(p.id, p.sku, int(b, 'qty'))],
    ['PUT', '/orders/:id/promo', (p, b) => orders.applyPromo(p.id, b.code === null ? null : str(b, 'code'))],
    ['POST', '/orders/:id/place', p => orders.place(p.id)],
    ['POST', '/orders/:id/pay', (p, b) => orders.pay(p.id, str(b, 'paymentId'))],
    ['POST', '/orders/:id/ship', p => orders.ship(p.id)],
    ['POST', '/orders/:id/cancel', p => orders.cancel(p.id)],
    ['GET', '/orders/:id/receipt', p => receipt(orders.get(p.id), promoOf(p.id))],
    ['GET', '/orders/:id/events', p => app.log.forOrder(p.id)],
    ['GET', '/reports/sales', () => reports.sales()],
    ['GET', '/admin/audit', () => ({ problems: app.audit.run() })],
    ['POST', '/admin/expire', (_, b) => ({ expired: orders.expireStale(), by: optStr(b, 'by') ?? 'api' })],
  ])
}
