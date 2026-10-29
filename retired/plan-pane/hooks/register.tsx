// /progress: the newest superpowers plan beside the chat, refreshed after every turn.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PlanTask, PlanView } from '../types'

const PANE = 'plan-pane'
const DIR = 'docs/superpowers/plans'
// A plan touched this recently opens its pane at session start.
const FRESH_MS = 12 * 60 * 60 * 1000
const plan = atom({ plugin: 'plan-pane', key: 'plan' } as const, null)

export const parsePlan = (name: string, text: string): PlanView => {
  const tasks: PlanTask[] = []
  for (const row of text.split('\n')) {
    const head = /^###\s+Task\s+(\d+):\s*(.+)$/.exec(row)
    if (head) {
      tasks.push({ title: `${head[1] ?? ''} ${(head[2] ?? '').trim()}`, done: 0, total: 0 })
      continue
    }
    const box = /^\s*- \[( |x|X)\]/.exec(row)
    const task = tasks[tasks.length - 1]
    if (box && task) {
      task.total += 1
      if (box[1] !== ' ') task.done += 1
    }
  }
  return { name, tasks }
}

const newest = async ($: EngineInterface) => {
  const dir = `${await $.session.root()}/${DIR}`
  if (!(await $.fs.exists(dir))) return undefined
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
  const top = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  return top && { path: `${dir}/${top.name}`, name: top.name, mtimeMs: top.mtimeMs }
}

const refresh = async ($: EngineInterface) => {
  const top = await newest($)
  const view = top ? parsePlan(top.name, String(await $.fs.read(top.path))) : null
  await update($, plan, () => view)
  return top
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'Show the newest superpowers plan beside the chat' })
    const top = await refresh($).catch(() => undefined)
    if (top && (await $.clock.now()) - top.mtimeMs < FRESH_MS) void $.ui.open({ id: PANE, title: 'Plan' })
    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Plan' })
    return { text: opened.isPlaced ? 'Plan pane opened.' : `Plan pane not shown: ${opened.reason}` }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = await read($, plan)
    if (view === null) return <Text dimColor>No plan in {DIR} yet.</Text>
    const isDone = (t: PlanTask) => t.total > 0 && t.done === t.total
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">{view.name}  {view.tasks.filter(isDone).length}/{view.tasks.length}</Text>
        {view.tasks.map(t => (
          <Text dimColor={isDone(t)} wrap="truncate">
            {isDone(t) ? '✓' : t.done > 0 ? '▸' : '○'} {t.title}{!isDone(t) && t.total ? `  ${t.done}/${t.total}` : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
