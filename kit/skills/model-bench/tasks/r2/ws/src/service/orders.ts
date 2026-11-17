import { unitPrice } from '../domain/pricing.ts'
import { computeTotals } from '../domain/totals.ts'
import type { Order } from '../domain/types.ts'
import type { Clock } from '../util/clock.ts'
import { Conflict, NotFound, ValidationError } from '../util/errors.ts'
import { idGen } from '../util/ids.ts'
import type { EventLog } from '../storage/eventlog.ts'
import { Table } from '../storage/table.ts'
import type { Catalog } from './catalog.ts'
import type { Inventory } from './inventory.ts'
import type { Promos } from './promos.ts'

export const HOLD_MS = 15 * 60_000

type Deps = { clock: Clock; catalog: Catalog; inventory: Inventory; promos: Promos; log: EventLog }

export class Orders {
  table = new Table<Order>(o => o.id)
  nextId = idGen('ord_')
  deps: Deps
  constructor(deps: Deps) {
    this.deps = deps
  }

  create(customer: string): Order {
    if (!customer) throw new ValidationError('customer required')
    const o: Order = {
      id: this.nextId(),
      customer,
      status: 'draft',
      lines: [],
      promo: null,
      createdAt: this.deps.clock.now(),
      placedAt: null,
      expiresAt: null,
      paymentId: null,
      allocations: [],
      totals: { subtotal: 0, discount: 0, total: 0 },
    }
    this.table.put(o)
    this.deps.log.append('created', o.id, { customer })
    return o
  }

  get(id: string): Order {
    const o = this.table.get(id)
    if (!o) throw new NotFound(`order ${id}`)
    return o
  }

  draft(id: string): Order {
    const o = this.get(id)
    if (o.status !== 'draft') throw new Conflict(`order ${id} is ${o.status}`)
    return o
  }

  reprice(o: Order) {
    for (const l of o.lines) l.unitPrice = unitPrice(this.deps.catalog.get(l.sku), l.qty)
    o.totals = computeTotals(o.lines, o.promo ? this.deps.promos.get(o.promo) : null)
  }

  addLine(id: string, sku: string, qty: number): Order {
    const o = this.draft(id)
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer')
    this.deps.catalog.get(sku)
    const l = o.lines.find(x => x.sku === sku)
    if (l) l.qty += qty
    else o.lines.push({ sku, qty, unitPrice: 0 })
    this.reprice(o)
    return o
  }

  setQty(id: string, sku: string, qty: number): Order {
    const o = this.draft(id)
    if (!Number.isInteger(qty) || qty < 0) throw new ValidationError('qty must be a whole number')
    const l = o.lines.find(x => x.sku === sku)
    if (!l) throw new NotFound(`line ${sku}`)
    if (qty === 0) o.lines = o.lines.filter(x => x !== l)
    else l.qty = qty
    this.reprice(o)
    return o
  }

  applyPromo(id: string, code: string | null): Order {
    const o = this.draft(id)
    if (code === null) o.promo = null
    else o.promo = this.deps.promos.claim(code).code
    this.reprice(o)
    return o
  }

  place(id: string): Order {
    const o = this.draft(id)
    if (!o.lines.length) throw new ValidationError('order has no lines')
    this.reprice(o)
    o.allocations = this.deps.inventory.reserve(o.lines.map(l => ({ sku: l.sku, qty: l.qty })))
    const now = this.deps.clock.now()
    o.status = 'placed'
    o.placedAt = now
    o.expiresAt = now + HOLD_MS
    this.deps.log.append('placed', o.id, { total: o.totals.total })
    return o
  }

  pay(id: string, paymentId: string): Order {
    if (!paymentId) throw new ValidationError('paymentId required')
    const o = this.get(id)
    if (o.status === 'paid' || o.status === 'shipped') {
      if (o.paymentId === paymentId) return o
      throw new Conflict(`order ${id} already paid`)
    }
    if (o.status !== 'placed') throw new Conflict(`order ${id} is ${o.status}`)
    if (this.deps.clock.now() > o.expiresAt!) {
      this.expire(o)
      throw new Conflict(`order ${id} hold expired`)
    }
    o.status = 'paid'
    o.paymentId = paymentId
    this.deps.log.append('paid', o.id, { paymentId, amount: o.totals.total })
    return o
  }

  ship(id: string): Order {
    const o = this.get(id)
    if (o.status !== 'paid') throw new Conflict(`order ${id} is ${o.status}`)
    this.deps.inventory.commit(o.allocations)
    o.status = 'shipped'
    this.deps.log.append('shipped', o.id, { items: o.lines.map(l => ({ sku: l.sku, qty: l.qty })) })
    return o
  }

  cancel(id: string): Order {
    const o = this.get(id)
    if (!['draft', 'placed', 'paid'].includes(o.status)) throw new Conflict(`order ${id} is ${o.status}`)
    const wasPaid = o.status === 'paid'
    if (o.status !== 'draft') this.deps.inventory.release(o.lines.map(l => ({ sku: l.sku, qty: l.qty })))
    o.status = 'cancelled'
    this.deps.log.append('cancelled', o.id)
    if (wasPaid) this.deps.log.append('refunded', o.id, { amount: o.totals.total })
    return o
  }

  expire(o: Order) {
    this.deps.inventory.release(o.lines.map(l => ({ sku: l.sku, qty: l.qty })))
    o.status = 'expired'
    this.deps.log.append('expired', o.id)
  }

  expireStale(): string[] {
    const now = this.deps.clock.now()
    const stale = this.table.where(o => o.status === 'placed' && now > o.expiresAt!)
    for (const o of stale) this.expire(o)
    return stale.map(o => o.id)
  }
}
