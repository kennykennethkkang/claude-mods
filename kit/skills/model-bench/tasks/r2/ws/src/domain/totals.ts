import { subtotalOf } from './pricing.ts'
import { discountFor } from './promotions.ts'
import type { OrderLine, Promotion, Totals } from './types.ts'

export function computeTotals(lines: OrderLine[], promo: Promotion | null): Totals {
  const subtotal = subtotalOf(lines)
  const discount = promo ? discountFor(promo, lines) : 0
  return { subtotal, discount, total: subtotal - discount }
}
