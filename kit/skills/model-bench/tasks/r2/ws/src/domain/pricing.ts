import type { OrderLine, Product } from './types.ts'

// the deepest tier the qty reaches prices every unit in the line
export function unitPrice(p: Product, qty: number): number {
  let price = p.priceCents
  let reached = 0
  for (const t of p.tiers ?? []) {
    if (qty >= t.minQty && t.minQty > reached) {
      reached = t.minQty
      price = t.priceCents
    }
  }
  return price
}

export const lineSubtotal = (l: OrderLine) => l.unitPrice * l.qty

export const subtotalOf = (lines: OrderLine[]) => lines.reduce((s, l) => s + lineSubtotal(l), 0)

export function validateProduct(p: Product): string | null {
  if (!p.sku || typeof p.sku !== 'string') return 'sku required'
  if (!Number.isInteger(p.priceCents) || p.priceCents < 0) return 'priceCents must be a whole number of cents'
  for (const t of p.tiers ?? []) {
    if (!Number.isInteger(t.minQty) || t.minQty < 2) return 'tier minQty must be 2 or more'
    if (!Number.isInteger(t.priceCents) || t.priceCents < 0) return 'tier priceCents invalid'
  }
  return null
}
