export type Level = { onHand: number; reserved: number }

export type Warehouse = { id: string; priority: number }

export class StockStore {
  warehouses: Warehouse[] = []
  levels = new Map<string, Level>()

  addWarehouse(id: string, priority: number) {
    this.warehouses = this.warehouses.filter(w => w.id !== id)
    this.warehouses.push({ id, priority })
    this.warehouses.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  }

  has(id: string) {
    return this.warehouses.some(w => w.id === id)
  }

  // fill order: lower priority number first
  byPriority(): string[] {
    return this.warehouses.map(w => w.id)
  }

  level(warehouse: string, sku: string): Level {
    const k = `${warehouse}|${sku}`
    let l = this.levels.get(k)
    if (!l) this.levels.set(k, (l = { onHand: 0, reserved: 0 }))
    return l
  }
}
