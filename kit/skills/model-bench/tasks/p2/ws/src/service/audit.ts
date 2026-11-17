import type { OrderStatus } from '../domain/types.ts'
import type { Inventory } from './inventory.ts'
import type { Orders } from './orders.ts'
import type { Promos } from './promos.ts'

// orders whose allocations should still sit in reserved
const LIVE: OrderStatus[] = ['placed', 'paid']

// cheap consistency sweep for the ops page, returns what looks wrong
export class Audit {
  orders: Orders
  inventory: Inventory
  promos: Promos
  constructor(orders: Orders, inventory: Inventory, promos: Promos) {
    this.orders = orders
    this.inventory = inventory
    this.promos = promos
  }

  run(): string[] {
    const problems: string[] = []
    const held = new Map<string, number>()
    for (const o of this.orders.table.where(o => LIVE.includes(o.status))) {
      for (const a of o.allocations) held.set(`${a.warehouse}/${a.sku}`, (held.get(`${a.warehouse}/${a.sku}`) ?? 0) + a.qty)
    }
    for (const l of this.inventory.levels()) {
      const k = `${l.warehouse}/${l.sku}`
      if (l.onHand < 0 || l.reserved < 0 || l.available < 0) problems.push(`${k} negative stock`)
      const want = held.get(k) ?? 0
      if (want !== l.reserved) problems.push(`${k} reserved ${l.reserved} but orders hold ${want}`)
    }
    for (const o of this.orders.table.all()) {
      const t = o.totals
      if (t.subtotal - t.discount !== t.total || t.total < 0) problems.push(`${o.id} totals do not add up`)
    }
    for (const p of this.promos.table.all()) {
      if (p.maxUses !== undefined && this.promos.uses(p.code) > p.maxUses) problems.push(`${p.code} over its limit`)
    }
    return problems
  }
}
