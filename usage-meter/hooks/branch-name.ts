const STOP = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'for', 'and', 'with', 'my', 'me', 'please', 'can', 'you', 'could', 'i', 'it', 'is', 'this', 'that', 'now'])
export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w && !STOP.has(w))
/** A plan's filename without its date prefix and .md, as words. */
export const planWords = (planPath?: string) => words((planPath ? (planPath.split('/').pop() ?? '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') : '').replace(/-/g, ' '))
/** claude/<plan>-<task>, or claude/continue-MMDD when neither is known. */
export function branchFor(planPath?: string, task?: string, now = new Date()): string {
  const all = [...planWords(planPath), ...words(task ?? '')].slice(0, 6)
  if (!all.length) return `claude/continue-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `claude/${all.join('-').slice(0, 40).replace(/-+$/, '')}`
}
