import { expect, test } from 'claude-code/testing'

import { denial } from '../hooks/register.ts'

const ASK = { questions: [{ question: 'Which layout?', header: 'Layout', options: [{ label: 'Cards', preview: '<div/>' }, { label: 'List' }] }] }

test('the denial says push first, call per question, carry on', () => {
  const d = denial(ASK)
  expect(d).toMatch(/SendUserFile|PushNotification/)
  expect(d).toMatch(/call\.py "Which layout\? Options: Cards, List\."/)
  expect(d).toMatch(/look at/i)
  expect(d).toMatch(/exit 2/i)
  expect(d).toMatch(/not re-ask/i)
})

let now = 0
const rig = (on: unknown, phone: unknown) => {
  const h = on as (op: string, fn: (_: unknown, e: Record<string, any>) => unknown) => void
  now += 60_000
  h('env.get', () => ({ value: '/u' }))
  h('clock.now', () => ({ value: now }))
  h('fs.read', (_, e) => ({ value: String(e.path).endsWith('/u/.claude/switchboard/limits.json') ? JSON.stringify({ phone }) : '' }))
  h('tool.call', () => ({ result: 'asked' }))
}

test('phone on denies AskUserQuestion', async ($, on) => {
  rig(on, true)
  const ran = await $.tool.call({ tool: 'AskUserQuestion', ...ASK } as never)
  expect(JSON.stringify(ran)).toMatch(/call\.py/)
})

test('phone off lets AskUserQuestion through', async ($, on) => {
  rig(on, false)
  const ran = await $.tool.call({ tool: 'AskUserQuestion', ...ASK } as never)
  expect(JSON.stringify(ran)).not.toMatch(/call\.py/)
})

test('other tools pass with phone on', async ($, on) => {
  rig(on, true)
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(JSON.stringify(ran)).not.toMatch(/call\.py/)
})
