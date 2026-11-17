export class Table<T> {
  rows = new Map<string, T>()
  key: (row: T) => string
  constructor(key: (row: T) => string) {
    this.key = key
  }
  get(k: string): T | undefined {
    return this.rows.get(k)
  }
  put(row: T): T {
    this.rows.set(this.key(row), row)
    return row
  }
  all(): T[] {
    return [...this.rows.values()]
  }
  where(fn: (row: T) => boolean): T[] {
    return this.all().filter(fn)
  }
}
