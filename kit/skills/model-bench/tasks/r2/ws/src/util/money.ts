import { ValidationError } from './errors.ts'

// digits after the point for each currency we sell in
const DECIMALS: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }

export function decimals(currency: string): number {
  const d = DECIMALS[currency]
  if (d === undefined) throw new ValidationError(`unsupported currency ${currency}`)
  return d
}

// half away from zero, what finance expects
export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

export function percentOf(amount: number, pct: number): number {
  return roundHalfUp((amount * pct) / 100)
}

// split total over integer weights, largest remainder first, ties to the earlier slot
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map(() => 0)
  const out = weights.map(w => Math.floor((total * w) / sum))
  const rem = weights.map((w, i) => [(total * w) % sum, i])
  rem.sort((a, b) => b[0] - a[0] || a[1] - b[1])
  let left = total - out.reduce((a, b) => a + b, 0)
  for (let k = 0; left > 0; k++, left--) out[rem[k][1]]++
  return out
}

export function format(minor: number, currency: string): string {
  const d = decimals(currency)
  const abs = Math.abs(minor)
  const body = d === 0 ? String(abs) : `${Math.floor(abs / 10 ** d)}.${String(abs % 10 ** d).padStart(d, '0')}`
  return `${minor < 0 ? '-' : ''}${body} ${currency}`
}
