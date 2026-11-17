import type { Allocation, Item } from '../domain/types.ts'
import { NotFound, OutOfStock, ValidationError } from '../util/errors.ts'
import type { EventLog } from '../storage/eventlog.ts'
import type { StockStore } from '../storage/stock.ts'

export class Inventory {
  stock: StockStore
  log: EventLog
  constructor(stock: StockStore, log: EventLog) {
    this.stock = stock
    this.log = log
  }

  addWarehouse(id: string, priority = 100) {
    if (!id) throw new ValidationError('warehouse id required')
    this.stock.addWarehouse(id, priority)
  }

  receive(warehouse: string, sku: string, qty: number) {
    if (!this.stock.has(warehouse)) throw new NotFound(`warehouse ${warehouse}`)
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer')
    this.stock.level(warehouse, sku).onHand += qty
    this.log.append('received', null, { warehouse, sku, qty })
  }

  available(sku: string, warehouse?: string): number {
    const whs = warehouse ? [warehouse] : this.stock.byPriority()
    return whs.reduce((s, w) => {
      const l = this.stock.level(w, sku)
      return s + l.onHand - l.reserved
    }, 0)
  }

  // all or nothing: check every item before touching a level
  reserve(items: Item[]): Allocation[] {
    for (const it of items) if (this.available(it.sku) < it.qty) throw new OutOfStock(it.sku)
    const out: Allocation[] = []
    for (const it of items) {
      let left = it.qty
      for (const w of this.stock.byPriority()) {
        if (!left) break
        const l = this.stock.level(w, it.sku)
        const take = Math.min(l.onHand - l.reserved, left)
        if (take <= 0) continue
        l.reserved += take
        left -= take
        out.push({ warehouse: w, sku: it.sku, qty: take })
      }
    }
    return out
  }

  release(items: Item[]) {
    for (const it of items) {
      let left = it.qty
      for (const w of this.stock.byPriority()) {
        if (!left) break
        const l = this.stock.level(w, it.sku)
        const take = Math.min(l.reserved, left)
        l.reserved -= take
        left -= take
      }
    }
  }

  // reserved stock leaves the building
  commit(allocs: Allocation[]) {
    for (const a of allocs) {
      const l = this.stock.level(a.warehouse, a.sku)
      l.onHand -= a.qty
      l.reserved -= a.qty
    }
  }

  // only free stock moves; reserved units stay with their orders
  transfer(from: string, to: string, sku: string, qty: number) {
    for (const w of [from, to]) if (!this.stock.has(w)) throw new NotFound(`warehouse ${w}`)
    if (from === to) throw new ValidationError('transfer needs two warehouses')
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer')
    if (this.available(sku, from) < qty) throw new OutOfStock(sku)
    this.stock.level(from, sku).onHand -= qty
    this.stock.level(to, sku).onHand += qty
    this.log.append('transferred', null, { from, to, sku, qty })
  }

  levels() {
    const rows = []
    for (const [k, l] of this.stock.levels) {
      const [warehouse, sku] = k.split('|')
      rows.push({ warehouse, sku, onHand: l.onHand, reserved: l.reserved, available: l.onHand - l.reserved })
    }
    return rows.sort((a, b) => (a.warehouse + a.sku < b.warehouse + b.sku ? -1 : 1))
  }
}
