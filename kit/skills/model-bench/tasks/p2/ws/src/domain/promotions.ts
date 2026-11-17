import { percentOf } from '../util/money.ts'
import { lineSubtotal, subtotalOf } from './pricing.ts'
import type { OrderLine, Promotion } from './types.ts'

// bogo only touches its own sku, the rest spread over the whole order
export const appliesTo = (p: Promotion, l: OrderLine) => p.kind !== 'bogo' || l.sku === p.sku

export function discountFor(p: Promotion, lines: OrderLine[]): number {
  const subtotal = subtotalOf(lines)
  if (p.minSubtotal && subtotal < p.minSubtotal) return 0
  if (p.kind === 'percent') return percentOf(subtotal, p.value)
  if (p.kind === 'fixed') return Math.min(p.value, subtotal)
  const l = lines.find(x => x.sku === p.sku)
  if (!l) return 0
  return Math.floor(l.qty / (p.value + 1)) * l.unitPrice
}

export function eligibleSubtotal(p: Promotion, lines: OrderLine[]): number {
  return lines.filter(l => appliesTo(p, l)).reduce((s, l) => s + lineSubtotal(l), 0)
}

export function validatePromo(p: Promotion): string | null {
  if (!/^[A-Z0-9]{3,16}$/.test(p.code ?? '')) return 'code must be 3-16 capitals or digits'
  if (!['percent', 'fixed', 'bogo'].includes(p.kind)) return 'unknown kind'
  if (!Number.isInteger(p.value) || p.value <= 0) return 'value must be a positive integer'
  if (p.kind === 'percent' && p.value > 100) return 'percent above 100'
  if (p.kind === 'bogo' && !p.sku) return 'bogo needs a sku'
  if (p.maxUses !== undefined && (!Number.isInteger(p.maxUses) || p.maxUses < 1)) return 'maxUses must be 1 or more'
  return null
}
