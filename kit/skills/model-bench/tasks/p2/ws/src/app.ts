import { handlers } from './http/handlers.ts'
import type { Req, Res } from './http/router.ts'
import { Audit } from './service/audit.ts'
import { Catalog } from './service/catalog.ts'
import { Inventory } from './service/inventory.ts'
import { Orders } from './service/orders.ts'
import { Promos } from './service/promos.ts'
import { receipt } from './service/receipts.ts'
import { Reports } from './service/reports.ts'
import { EventLog } from './storage/eventlog.ts'
import { StockStore } from './storage/stock.ts'
import { type Clock, systemClock } from './util/clock.ts'

export type App = {
  clock: Clock
  log: EventLog
  catalog: Catalog
  inventory: Inventory
  promos: Promos
  orders: Orders
  reports: Reports
  audit: Audit
  receipt: (orderId: string) => ReturnType<typeof receipt>
  handle: (req: Req) => Res
}

export function createApp(opts: { clock?: Clock } = {}): App {
  const clock = opts.clock ?? systemClock
  const log = new EventLog(clock)
  const catalog = new Catalog()
  const inventory = new Inventory(new StockStore(), log)
  const promos = new Promos()
  const orders = new Orders({ clock, catalog, inventory, promos, log })
  const reports = new Reports(orders, log)
  const app = { clock, log, catalog, inventory, promos, orders, reports } as App
  app.audit = new Audit(orders, inventory, promos)
  app.receipt = id => {
    const o = orders.get(id)
    return receipt(o, o.promo ? promos.get(o.promo) : null)
  }
  app.handle = handlers(app)
  return app
}
