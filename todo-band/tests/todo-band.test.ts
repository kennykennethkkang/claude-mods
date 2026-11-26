import { expect, mock, test } from 'claude-code/testing'

import { bandParts, bandText, cut, parseTodo, width } from '../hooks/register.tsx'

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
  expect(bandText(item, 200)).toBe('To-do 3 auto  Fix the stuck chat card  left by aar')
  expect(bandText({ ...item, auto: false }, 200)).toBe('To-do 3  Fix the stuck chat card  left by aar')
  expect(bandText({ ...item, total: 4 }, 200)).toBe('To-do 3 auto  Fix the stuck chat card  +3 more  left by aar')
  // bold head, dim labels, plain text
  expect(bandParts({ ...item, auto: false }, 200).map(s => [s.b, s.dim])).toEqual([[true, undefined], [undefined, undefined], [undefined, true]])
})

test('a long item drops the source first, then is cut to the width', () => {
  const long = { ...item, text: 'word '.repeat(60).trim() }
  const out = bandText({ ...long, total: 2 }, 60)
  expect(out.length).toBe(60)
  expect(out.startsWith('To-do 3 auto  word')).toBe(true)
  expect(out.endsWith('…  +1 more')).toBe(true)
  expect(bandText(item, 40)).toBe('To-do 3 auto  Fix the stuck chat card')
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
    expect((await ui.find({ type: 'Text', text: /To-do/ }))?.text).toBe('To-do 3 auto  Fix the stuck chat card  +1 more  left by aar')
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

test('a short terminal gets "To-do N: item (+M)" on one line', () => {
  expect(bandText({ ...item, total: 4 }, 120, true)).toBe('To-do 3 auto  Fix the stuck chat card +3')
  expect(bandText({ ...item, auto: false }, 120, true)).toBe('To-do 3  Fix the stuck chat card')
  const out = bandText({ ...item, text: 'word '.repeat(40), total: 2 }, 50, true)
  expect(width(out)).toBe(50)
  expect(out.endsWith('… +1')).toBe(true)
})

test('wide characters are cut on cells, never over the width', () => {
  expect(width('漢字')).toBe(4)
  expect(cut('漢字漢字', 5)).toBe('漢字…')
  for (const cols of [60, 30, 12, 5, 1]) expect(width(bandText({ ...item, text: '漢字🚀'.repeat(20) }, cols))).toBeLessThanOrEqual(cols)
})

test('the band goes compact below 20 rows', async ($, on) => {
  mock.env(on, { SWITCHBOARD_TODO: JSON.stringify({ ...item, total: 2 }) })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 100, rows: 16 } } as any)
  expect((await ui.find({ type: 'Text', text: /To-do/ }))?.text).toBe('To-do 3 auto  Fix the stuck chat card +1')
  await ui.unmount()
})
