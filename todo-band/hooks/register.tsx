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

// Cuts the item text, not the head or the source, so "from" stays on screen.
export function bandText(t: Todo, width: number): string {
  const head = `To-do ${t.n}${t.auto ? ' · auto' : ''} · `
  const more = t.total > 1 ? ` (+${t.total - 1} more)` : ''
  const tail = t.from ? ` · from ${t.from}` : ''
  const text = t.text.replace(/\s+/g, ' ').trim()
  const full = head + text + more + tail
  if (full.length <= width) return full
  const room = width - head.length - more.length - tail.length
  if (room > 1) return head + text.slice(0, room - 1) + '…' + more + tail
  return full.slice(0, Math.max(0, width - 1)) + '…'
}

export const register: Register = (on) => {
  let todo: Todo | undefined

  on('session.start', async ($, e, next) => {
    todo = parseTodo(await $.env.get('SWITCHBOARD_TODO'))
    if (todo) $.ui.status(`To-do ${todo.n}`)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!todo || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor wrap="truncate-end">{bandText(todo, e.props.bodyColumns)}</Text>
  })
}
