import type { EventLog } from '../storage/eventlog.ts'
import type { Orders } from './orders.ts'

export class Reports {
  orders: Orders
  log: EventLog
  constructor(orders: Orders, log: EventLog) {
    this.orders = orders
    this.log = log
  }

  // gross counts every order that was ever paid, refunds come back out of it
  sales() {
    const paid = this.orders.table.where(o => o.paymentId !== null)
    const gross = paid.reduce((s, o) => s + o.totals.total, 0)
    const refunds = this.log.ofType('refunded').reduce((s, e) => s + (e.data.amount as number), 0)
    return { orders: paid.length, gross, refunds, net: gross - refunds }
  }
}
