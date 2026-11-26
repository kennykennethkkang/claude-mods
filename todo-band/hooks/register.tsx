// Switchboard starts a to-do chat with SWITCHBOARD_TODO set; show which item above the prompt.
import type { Register } from 'claude-code'

export type Todo = { n: number; auto: boolean; text: string; from: string; project: string; total: number }

export function parseTodo(raw: string | undefined): Todo | undefined {
  if (!raw) return undefined
  try {
    const t = JSON.parse(raw)
    if (!t || typeof t !== 'object' || typeof t.n !== 'number' || typeof t.text !== 'string') return undefined
    return {
      n: t.n,
      auto: t.auto === true,
      text: t.text,
      from: typeof t.from === 'string' ? t.from : '',
      project: typeof t.project === 'string' ? t.project : '',
      total: typeof t.total === 'number' ? t.total : 1,
    }
  } catch {
    return undefined
  }
}

// Terminal cells of a code point: 0 for joiners and marks, 2 for CJK and emoji.
const cells = (cp: number) =>
  cp < 0x300 ? 1
  : (cp <= 0x36f || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f)) ? 0
  : (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1
export const width = (s: string) => [...s].reduce((n, c) => n + cells(c.codePointAt(0)!), 0)

// First chars of text that fit room cells, with an ellipsis when it was cut.
export function cut(text: string, room: number): string {
  if (width(text) <= room) return text
  if (room < 1) return ''
  let out = ''
  let used = 0
  for (const c of text) {
    const w = cells(c.codePointAt(0)!)
    if (used + w > room - 1) break
    out += c
    used += w
  }
  return out + '…'
}

export type Seg = { t: string; dim?: boolean; b?: boolean }
const widthOf = (segs: Seg[]) => segs.reduce((n, s) => n + width(s.t), 0)

// Segments cut to cols cells, an ellipsis where the cut fell.
function cutSegs(segs: Seg[], cols: number): Seg[] {
  const out: Seg[] = []
  let room = cols
  for (const s of segs) {
    if (room <= 0) break
    const t = cut(s.t, room)
    out.push({ ...s, t })
    room -= width(t)
  }
  return out
}

// "To-do 3 auto  item  +3 more  left by aar": bold head, dim rest. Folds: source first, then the
// item text is cut. compact (a short terminal) also drops the source and says "+3".
export function bandParts(t: Todo, cols: number, compact = false): Seg[] {
  const head: Seg[] = [{ t: `To-do ${t.n}`, b: true }, ...(t.auto ? [{ t: ' auto', dim: true }] : [])]
  const text = t.text.replace(/\s+/g, ' ').trim()
  const more: Seg[] = t.total > 1 ? [{ t: compact ? ` +${t.total - 1}` : `  +${t.total - 1} more`, dim: true }] : []
  const from: Seg[] = !compact && t.from ? [{ t: `  left by ${t.from}`, dim: true }] : []
  const full = [...head, { t: '  ' + text }, ...more, ...from]
  if (widthOf(full) <= cols) return full
  const room = cols - widthOf(head) - 2 - widthOf(more)
  if (room > 1) return [...head, { t: '  ' + cut(text, room) }, ...more]
  return cutSegs([...head, { t: '  ' + text }, ...more], cols)
}

export const bandText = (t: Todo, cols: number, compact = false) => bandParts(t, cols, compact).map(s => s.t).join('')

export const register: Register = (on) => {
  let todo: Todo | undefined

  on('session.start', async ($, e, next) => {
    todo = parseTodo(await $.env.get('SWITCHBOARD_TODO'))
    if (todo) $.ui.status(`To-do ${todo.n}`)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!todo || e.props.hasSurvey) return next(e)
    const below = await next(e).catch(() => undefined)
    const { Box, Text } = $.ui.resolve(e)
    const parts = bandParts(todo, e.props.bodyColumns, (e.viewport?.rows ?? 99) < 20 || e.props.bodyColumns < 90)
    const row = <Text wrap="truncate-end">{parts.map(s => <Text bold={s.b} dimColor={s.dim}>{s.t}</Text>)}</Text>
    return below ? <Box flexDirection="column">{row}{below}</Box> : row
  })
}
