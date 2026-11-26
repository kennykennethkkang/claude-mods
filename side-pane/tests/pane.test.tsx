import { expect, test } from 'claude-code/testing'

import { plain, view } from '../hooks/view.ts'
import { needsSnapUpdate, panePollDue, register as registerPane } from '../hooks/register.tsx'

const NOW = 1795261096312
const MIN = 60_000
const SNAP = {
  at: NOW,
  usage: [
    { who: 'Claude', win: '5h', pct: 50, resetAt: NOW + 134 * MIN },
    { who: 'Claude', win: 'wk', pct: 82, resetAt: NOW + 76 * 60 * MIN },
    { who: 'Codex', win: '5h', pct: 4, resetAt: NOW + 62 * MIN },
    { who: 'Codex', win: 'wk', pct: 8, resetAt: NOW + 5 * 1440 * MIN },
  ],
  agents: [
    { id: '1', type: 'engineer', status: 'running', model: 'claude-opus-5-5', effort: 'high', startTime: NOW - 12 * MIN, label: 'Fix the pane render so the usage bars and the agent rows keep their columns when the terminal is resized' },
    { id: '2', type: 'qa', status: 'waiting', model: 'claude-haiku-4-5', startTime: NOW - 3 * MIN, label: 'Needs a sign-in' },
  ],
  done: { researcher: 2 },
  smart: { ponytail: 'ultra', model: 'opus', effort: 'high', why: 'bug fix: root cause', roles: [{ role: 'engineer', model: 'sonnet' }, { role: 'qa-codex', model: 'gpt-5' }] },
  mods: ['role-rows', 'todo-band', 'usage-meter'],
}

const PANE = {
  plugin: 'side-pane',
  component: 'Pane',
  requestId: 'side',
  props: { title: 'Side', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const KEEP = { state: 'warm', warmUntil: NOW + 42 * MIN, tokens: 184_000, now: NOW, pingAt: NOW + 37 * MIN }
const seed = (_: unknown, e: { key: string }, next: (e: unknown) => unknown) =>
  e.key === 'snap' ? { value: { value: { shape: 'snap-1', value: SNAP }, version: 1 } }
  : e.key === 'keep' ? { value: { value: KEEP, version: 1 } }
  : next(e)

const EXPECT = [
  /^Waiting on you 1 ─/,
  /^! qa: Needs a sign-in$/,
  /^Running 1 ─/,
  /^⏺ engineer opus·high +12m$/,
  /^  Fix the pane render so the usage bars$/,
  /^  and the agent rows keep their columns…$/,
  /^Claude 5h █+░+ +50% +2h14m$/,
  /^Codex wk/,
  /^  ponytail ultra  opus high$/,
  /^  why bug fix: root cause$/,
  /^  engineer sonnet$/,
  /^  qa-codex gpt-5$/,
  /^Cache ─/,
  /^  warm 42m$/,
  /^  184k cached, ping in 37m$/,
  /^Mods 3 on/,
]

test('Focus draws waiting, agents with wrapped tasks, usage, smart and mods on every surface', async ($, on) => {
  on('state.get', seed as never)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const re of EXPECT) expect((await ui.find({ type: 'Text', text: re }))?.text).toMatch(re)
    await ui.unmount()
  }
})

test('the mods button shows the mods list', async ($, on) => {
  on('state.get', seed as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'mods' })
  expect((await ui.find({ type: 'Text', text: /role-rows +todo-band/ }))?.text).toMatch(/usage-meter/)
  await ui.unmount()
})

test('an empty snapshot draws without agents', async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /No agents running/ }))?.text).toBe('No agents running.')
  await ui.unmount()
})

test('role names take the new hex, codex roles their base role\'s', async ($, on) => {
  on('state.get', seed as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^  engineer$/ }))?.props).toMatchObject({ color: '#bf4340' })
  expect((await ui.find({ type: 'Text', text: /^  qa-codex$/ }))?.props).toMatchObject({ color: '#37a953' })
  await ui.unmount()
})

test('a cold cache says so in the warning color', () => {
  const v = view({ ...SNAP, smart: {} } as never, [], 40, NOW, false, { state: 'cold', warmUntil: 0, tokens: 1_200_000, now: NOW })
  expect(plain(v)).toMatch(/Cache ─+\n  cold\n  next prompt re-reads 1.2M/)
  expect(v.lines.flat().find(g => g.t === '  cold')?.c).toBe('warning')
})

test('the rows above the prompt: pane open keeps the to-do row, closed keeps smart-select\'s one row', async ($, on) => {
  const rows = ['role-rows', 'todo-band', 'smart-select', 'cache-keeper', 'other'].map(plugin => ({ plugin, tree: { type: 'Text', props: {}, children: [plugin] } }))
  let open = true
  on('clock.now', () => ({ value: NOW }))
  on('state.get', ((_: unknown, e: { key: string }, next: (e: unknown) => unknown) => (e.key === 'placed' ? { value: { value: open, version: 1 } } : next(e))) as never)
  const shown = async (placed: boolean) => {
    open = placed
    const ui = await $.ui.mount({ plugin: 'side-pane', component: 'AbovePromptList', surface: 'terminal', props: { rows, hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } } } as never)
    const out = []
    for (const r of rows) if (await ui.find({ type: 'Text', text: r.plugin })) out.push(r.plugin)
    await ui.unmount()
    return out
  }
  expect(await shown(true)).toEqual(['todo-band', 'other'])
  expect(await shown(false)).toEqual(['role-rows', 'smart-select', 'other'])
  // smart-select off: nothing carries the to-do and cache, so their rows stay
  rows.splice(2, 1)
  expect(await shown(false)).toEqual(['role-rows', 'todo-band', 'cache-keeper', 'other'])
})

test('usage rows: short bar on a wide pane, whole reset time on a narrow one', () => {
  const times = ['2h14m', '3d4h', '1h02m', '5d']
  for (const cols of [181, 60, 40, 30, 24, 22]) {
    const rows = plain(view(SNAP as never, [], cols, NOW)).split('\n').filter(l => /^(Claude|Codex) (5h|wk)/.test(l))
    expect(rows.length).toBe(4)
    rows.forEach((r, i) => {
      expect(r.endsWith(' ' + times[i])).toBe(true)
      expect([...r].length <= cols).toBe(true)
      expect((/[█░]+/.exec(r)?.[0].length ?? 0) <= 24).toBe(true)
    })
  }
})

test('snap refreshes only for changes, active agents, or the 30 second countdown', () => {
  const old = { ...SNAP, agents: [], at: NOW }
  expect(needsSnapUpdate(old as never, { ...old, at: NOW + 1 }, NOW + 1)).toBe(false)
  expect(needsSnapUpdate(old as never, { ...old, done: { researcher: 1 }, at: NOW + 1 }, NOW + 1)).toBe(true)
  expect(needsSnapUpdate(old as never, { ...old, agents: SNAP.agents, at: NOW + 1 }, NOW + 1)).toBe(true)
  expect(needsSnapUpdate(old as never, { ...old, at: NOW + 30_000 }, NOW + 30_000)).toBe(true)
  expect(panePollDue(19, false)).toBe(true)
  expect(panePollDue(20, false)).toBe(true)
  expect(panePollDue(21, false)).toBe(false)
  expect(panePollDue(25, true)).toBe(true)
})

function pollHarness(initialAgents: object[]) {
  const hooks = new Map<string, (...args: any[]) => unknown>()
  const values = new Map<string, unknown>([['placed', false], ['snap', SNAP]])
  let timer: (() => void) | undefined, polls = 0, panesPresent = true, agents = initialAgents
  const $ = {
    clock: { now: async () => NOW, every: (_ms: number, fn: () => void) => { timer = fn } },
    command: { register: async () => undefined },
    ui: { open: () => new Promise(() => {}), panes: async () => panesPresent ? [{ id: 'side', isPlaced: false }] : [] },
    env: { get: async () => '/u' }, session: { id: async () => 'chat' },
    fs: { stat: async () => ({ size: 0, mtimeMs: 0 }), read: async () => '', list: async () => [] },
    agent: { list: async () => { polls++; return agents } },
    state: {
      get: async (a: { key: string }) => ({ value: a.key === 'snap' ? { shape: 'snap-1', value: values.get(a.key) } : { value: values.get(a.key) }, version: 1 }),
      set: async (a: { key: string }, value: unknown) => { values.set(a.key, value); return { isSet: true } },
      update: async (a: { key: string }, fn: (value: unknown) => unknown) => { values.set(a.key, fn(values.get(a.key))) },
    },
  }
  registerPane(((event: string, hook: (...args: any[]) => unknown) => { hooks.set(event, hook) }) as never)
  return {
    $,
    get polls() { return polls },
    set panesPresent(value: boolean) { panesPresent = value },
    set agents(value: object[]) { agents = value },
    timer: () => timer!,
    start: () => hooks.get('session.start')!($, { cwd: '/u' }, async () => undefined),
    activity: () => hooks.get('tool.call')!($, { tool: 'Bash' }, async () => ({ result: {} })),
  }
}

const flushPoll = () => new Promise(r => setTimeout(r, 0))

test('activity polls only when quiet, then wakes one poll', async () => {
  const h = pollHarness([])
  await h.start()
  await h.activity()
  await flushPoll()
  expect(h.polls).toBe(0)
  for (let i = 0; i < 20; i++) { h.timer()(); await flushPoll() }
  const before = h.polls
  h.timer()()
  await flushPoll()
  expect(h.polls).toBe(before)
  await h.activity()
  await flushPoll()
  expect(h.polls).toBe(before + 1)
})

test('failed and idle agents do not keep quiet polling awake or survive pane close', async () => {
  const h = pollHarness([
    { id: 'running', type: 'engineer', status: 'running' },
    { id: 'pending', type: 'qa', status: 'pending' },
    { id: 'waiting', type: 'researcher', status: 'waiting' },
  ])
  await h.start()
  for (let i = 0; i < 20; i++) { h.timer()(); await flushPoll() }
  const beforeClose = h.polls
  h.panesPresent = false
  h.timer()()
  await flushPoll()
  expect(h.polls).toBe(beforeClose)
  h.panesPresent = true
  h.agents = [{ id: 'failed', type: 'engineer', status: 'failed' }, { id: 'idle', type: 'qa', status: 'idle' }]
  h.timer()()
  await flushPoll()
  expect(h.polls).toBe(beforeClose)
  for (let i = 0; i < 7; i++) { h.timer()(); await flushPoll() }
  const before = h.polls
  h.timer()()
  await flushPoll()
  expect(h.polls).toBe(before + 1)
  const afterPoll = h.polls
  h.timer()()
  await flushPoll()
  expect(h.polls).toBe(afterPoll)
})
