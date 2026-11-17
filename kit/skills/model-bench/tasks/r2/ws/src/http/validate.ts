import type { Item } from '../domain/types.ts'
import { ValidationError } from '../util/errors.ts'

export function str(body: any, key: string): string {
  const v = body?.[key]
  if (typeof v !== 'string' || !v) throw new ValidationError(`${key} must be a non-empty string`)
  return v
}

export function optStr(body: any, key: string): string | undefined {
  return body?.[key] === undefined ? undefined : str(body, key)
}

export function int(body: any, key: string, min = 0): number {
  const v = body?.[key]
  if (!Number.isInteger(v) || v < min) throw new ValidationError(`${key} must be an integer >= ${min}`)
  return v
}

export function items(body: any, key = 'items'): Item[] {
  const v = body?.[key]
  if (!Array.isArray(v) || !v.length) throw new ValidationError(`${key} must be a non-empty list`)
  return v.map((it: any) => ({ sku: str(it, 'sku'), qty: int(it, 'qty', 1) }))
}
