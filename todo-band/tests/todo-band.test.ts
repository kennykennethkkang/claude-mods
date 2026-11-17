import { expect, mock, test } from 'claude-code/testing'

import { bandText, parseTodo } from '../hooks/register.tsx'

const BAND = {
  plugin: 'todo-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } },
} as const

const item = { n: 3, auto: true, text: 'Fix the stuck chat card', from: 'aar', project: 'agent-flow', total: 1 }

test('bad or missing SWITCHBOARD_TODO shows nothing', () => {
  expect(parseTodo(undefined)).toBeUndefined()
  expect(parseTodo('')).toBeUndefined()
  expect(parseTodo('{not json')).toBeUndefined()
  expect(parseTodo('[1,2]')).toBeUndefined()
  expect(parseTodo('{"n":"3","text":"x"}')).toBeUndefined()
  expect(parseTodo(JSON.stringify(item))).toEqual(item)
})

test('the band names the item, auto, and where it came from', () => {
  expect(bandText(item, 200)).toBe('To-do 3 · auto · Fix the stuck chat card · from aar')
  expect(bandText({ ...item, auto: false }, 200)).toBe('To-do 3 · Fix the stuck chat card · from aar')
  expect(bandText({ ...item, total: 4 }, 200)).toBe('To-do 3 · auto · Fix the stuck chat card (+3 more) · from aar')
})

test('a long item is cut to the width, keeping the source visible', () => {
  const long = { ...item, text: 'word '.repeat(60).trim() }
  const out = bandText(long, 60)
  expect(out.length).toBe(60)
  expect(out.startsWith('To-do 3 · auto · word')).toBe(true)
  expect(out.endsWith('… · from aar')).toBe(true)
  expect(bandText(item, 10).length).toBe(10)
})

test('the band and status line show for a to-do chat', async ($, on) => {
  mock.env(on, { SWITCHBOARD_TODO: JSON.stringify({ ...item, total: 2 }) })
  const status: (string | undefined)[] = []
  on('ui.status', (_, e) => { status.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  expect(status.at(-1)).toBe('To-do 3')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /To-do/ }))?.text).toBe('To-do 3 · auto · Fix the stuck chat card (+1 more) · from aar')
    await ui.unmount()
  }
})

test('no env, no band', async ($, on) => {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /To-do/ })).toBeUndefined()
  await ui.unmount()
})
