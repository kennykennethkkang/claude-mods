import { lineSubtotal } from '../domain/pricing.ts'
import { appliesTo, eligibleSubtotal } from '../domain/promotions.ts'
import type { Order, Promotion } from '../domain/types.ts'
import { roundHalfUp } from '../util/money.ts'

export type ReceiptLine = { sku: string; qty: number; unitPrice: number; subtotal: number; discount: number; net: number }

export function receipt(o: Order, promo: Promotion | null) {
  const base = promo ? eligibleSubtotal(promo, o.lines) : 0
  const lines: ReceiptLine[] = o.lines.map(l => {
    const subtotal = lineSubtotal(l)
    const share = promo && base && appliesTo(promo, l) ? roundHalfUp((o.totals.discount * subtotal) / base) : 0
    return { sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, subtotal, discount: share, net: subtotal - share }
  })
  return { orderId: o.id, currency: 'USD', lines, ...o.totals }
}
