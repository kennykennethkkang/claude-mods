import { validatePromo } from '../domain/promotions.ts'
import type { Promotion } from '../domain/types.ts'
import { Conflict, NotFound, ValidationError } from '../util/errors.ts'
import { Table } from '../storage/table.ts'

type PromoRow = Promotion & { used: number }

export class Promos {
  table = new Table<PromoRow>(p => p.code)

  create(p: Promotion): Promotion {
    const bad = validatePromo(p)
    if (bad) throw new ValidationError(bad)
    if (this.table.get(p.code)) throw new Conflict(`promo ${p.code} exists`)
    return this.table.put({ ...p, used: 0 })
  }

  get(code: string): Promotion {
    const p = this.table.get(code)
    if (!p) throw new NotFound(`promo ${code}`)
    return p
  }

  uses(code: string): number {
    this.get(code)
    return this.table.get(code)!.used
  }

  claim(code: string): Promotion {
    const p = this.table.get(code)
    if (!p) throw new NotFound(`promo ${code}`)
    if (p.maxUses !== undefined && p.used >= p.maxUses) throw new Conflict(`promo ${code} used up`)
    p.used++
    return p
  }
}
