import { validateProduct } from '../domain/pricing.ts'
import type { Product } from '../domain/types.ts'
import { NotFound, ValidationError } from '../util/errors.ts'
import { Table } from '../storage/table.ts'

export class Catalog {
  products = new Table<Product>(p => p.sku)

  add(p: Product): Product {
    const bad = validateProduct(p)
    if (bad) throw new ValidationError(bad)
    return this.products.put({ sku: p.sku, name: p.name ?? p.sku, priceCents: p.priceCents, tiers: p.tiers ?? [] })
  }

  get(sku: string): Product {
    const p = this.products.get(sku)
    if (!p) throw new NotFound(`product ${sku}`)
    return p
  }
}
