export type Tier = { minQty: number; priceCents: number }

export type Product = { sku: string; name: string; priceCents: number; tiers?: Tier[] }

export type PromoKind = 'percent' | 'fixed' | 'bogo'

export type Promotion = {
  code: string
  kind: PromoKind
  value: number
  sku?: string
  minSubtotal?: number
  maxUses?: number
}

export type OrderStatus = 'draft' | 'placed' | 'paid' | 'shipped' | 'cancelled' | 'expired'

export type OrderLine = { sku: string; qty: number; unitPrice: number }

export type Allocation = { warehouse: string; sku: string; qty: number }

export type Totals = { subtotal: number; discount: number; total: number }

export type Order = {
  id: string
  customer: string
  status: OrderStatus
  lines: OrderLine[]
  promo: string | null
  createdAt: number
  placedAt: number | null
  expiresAt: number | null
  paymentId: string | null
  allocations: Allocation[]
  totals: Totals
}

export type Item = { sku: string; qty: number }

export type LogEvent = { seq: number; at: number; type: string; orderId: string | null; data: Record<string, unknown> }
