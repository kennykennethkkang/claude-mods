import { AppError } from '../util/errors.ts'

export type Req = { method: string; path: string; body?: any }
export type Res = { status: number; body: any }
export type Handler = (params: Record<string, string>, body: any) => Res | any

type Route = { method: string; parts: string[]; fn: Handler }

export function router(table: [string, string, Handler][]) {
  const routes: Route[] = table.map(([method, pattern, fn]) => ({ method, parts: pattern.split('/').filter(Boolean), fn }))
  return (req: Req): Res => {
    const parts = req.path.split('?')[0].split('/').filter(Boolean)
    let pathSeen = false
    for (const r of routes) {
      const params = match(r.parts, parts)
      if (!params) continue
      pathSeen = true
      if (r.method !== req.method) continue
      try {
        const out = r.fn(params, req.body ?? {})
        return out && typeof out.status === 'number' && 'body' in out ? out : { status: 200, body: out }
      } catch (e) {
        if (e instanceof AppError) return { status: e.status, body: { error: e.code, message: e.message } }
        return { status: 500, body: { error: 'internal', message: String((e as Error)?.message ?? e) } }
      }
    }
    return pathSeen ? { status: 405, body: { error: 'method_not_allowed' } } : { status: 404, body: { error: 'not_found' } }
  }
}

function match(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(parts[i])
    else if (pattern[i] !== parts[i]) return null
  }
  return params
}
