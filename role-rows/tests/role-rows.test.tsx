import { expect, mock, test } from 'claude-code/testing'

import { compactHeader, cut, roleSummary, treeBudget, width as cellWidth, elapsed, keepLines, modelEffort, pctOf, rosterLine, rowText, shouldHide, startsGroup, stateWord, stripAnsi, styleOf, treeBodies, type RowInfo, type TreeAgent } from '../hooks/register.tsx'

const NOW = 1_000_000_000
const base: RowInfo = { type: 'engineer', status: 'running', model: 'claude-sonnet-4-6', effort: 'high', tokenCount: 50_000, contextWindowSize: 200_000, startTime: NOW - 4 * 60_000, label: 'Fix the parser\nsecond line' }
const width = (s: string) => [...stripAnsi(s)].length

test('style comes from the env value, d by default', () => {
  expect(styleOf(undefined)).toBe('d')
  expect(styleOf('a')).toBe('a')
  expect(styleOf('b')).toBe('b')
  expect(styleOf('c')).toBe('c')
  expect(styleOf('d')).toBe('d')
  expect(styleOf('zzz')).toBe('d')
})

test('small formatters', () => {
  expect(elapsed(42_000)).toBe('42s')
  expect(elapsed(4 * 60_000 + 5_000)).toBe('4m')
  expect(elapsed(65 * 60_000)).toBe('1h05m')
  expect(elapsed(-5)).toBe('0s')
  expect(pctOf(50_000, 200_000)).toBe('25%')
  expect(pctOf(5, 0)).toBe('--')
  expect(pctOf(5, undefined)).toBe('--')
  expect(pctOf(9e9, 100)).toBe('999%')
  expect(modelEffort('claude-opus-4-8', 'xhigh')).toBe('opus·xhigh')
  expect(modelEffort('claude-haiku-4-5', undefined)).toBe('haiku')
  expect(modelEffort(undefined, 3)).toBe('-·3')
  expect(modelEffort(undefined, undefined)).toBe('-')
  expect(stateWord('completed')).toBe('done')
  expect(stateWord('weird')).toBe('weird')
})

test('style a is one aligned line, cut to the columns on visible width', () => {
  const a = rowText(base, 'a', NOW, 120)
  expect(a).not.toContain('\n')
  expect(stripAnsi(a)).toBe('engineer       sonnet·high     4m  25% running Fix the parser')
  const other = rowText({ ...base, type: 'qa', model: 'claude-opus-4-8', effort: 'xhigh', label: 'x' }, 'a', NOW, 120)
  // every column starts at the same place whatever the role
  expect(stripAnsi(other).indexOf('opus')).toBe(stripAnsi(a).indexOf('sonnet'))
  for (const cols of [80, 60, 40, 30, 12, 1]) expect(width(rowText(base, 'a', NOW, cols))).toBeLessThanOrEqual(cols)
  expect(stripAnsi(rowText(base, 'a', NOW, 50))).toMatch(/…$/)
})

test('the role is colored, an unknown type is plain', () => {
  expect(rowText(base, 'a', NOW, 120)).toContain('\x1b[')
  expect(rowText({ ...base, type: 'general-purpose' }, 'a', NOW, 120)).not.toMatch(/^\x1b/)
  expect(rowText(base, 'a', NOW, 120).startsWith('\x1b[38;2;')).toBe(true)
})

test('role colors are the shared hex set, codex roles use their base role\'s', () => {
  const rgb = (type: string) => /^\x1b\[38;2;(\d+;\d+;\d+)m/.exec(rowText({ ...base, type }, 'a', NOW, 120))?.[1]
  expect(rgb('engineer')).toBe('191;67;64')
  expect(rgb('engineer-codex')).toBe('191;67;64')
  expect(rgb('qa-codex')).toBe(rgb('qa'))
  expect(rgb('qa')).toBe('55;169;83')
  expect(rgb('growth')).toBe('171;91;184')
})

test('a label cannot smuggle escape sequences', () => {
  const out = rowText({ ...base, label: 'x\x1b[31mred\x1b]8;;http://e\x07' }, 'a', NOW, 120)
  expect(out.split('\x1b').length).toBe(rowText(base, 'a', NOW, 120).split('\x1b').length)
  expect(out).not.toContain('\x07')
})

test('role, model and effort cannot smuggle escape sequences either', () => {
  const bad = { ...base, type: 'x\x1b]0;pwned\x07', model: 'a\x1b[2J', effort: 'hi\x1b[31m' }
  expect(rowText(bad, 'a', NOW, 120)).not.toMatch(/\x07|\x1b\]|\x1b\[2J|\x1b\[31m/)
  const h = compactHeader({ subagent_type: 'x\x1b]0;pwned\x07', model: 'a\x1b[2J', effort: 'hi\x1b[31m', description: 'd' }, true, false)
  expect(h?.text).not.toMatch(/[\u0000-\u001f]/)
  expect(keepLines('Status: ok\x1b[2J\x07')).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/)
})

test('style b puts the label on its own line', () => {
  const lines = rowText(base, 'b', NOW, 100).split('\n')
  expect(lines.length).toBe(2)
  expect(stripAnsi(lines[0] ?? '')).toBe('engineer       sonnet·high     4m  25% running')
  expect(stripAnsi(lines[1] ?? '')).toBe('  Fix the parser')
  for (const l of rowText(base, 'b', NOW, 10).split('\n')) expect(width(l)).toBeLessThanOrEqual(10)
})

test('style c drops the state column and heads a new group', () => {
  const plain = stripAnsi(rowText(base, 'c', NOW, 120))
  expect(plain).not.toContain('running')
  expect(plain).toBe('engineer       sonnet·high     4m  25% Fix the parser')
  const head = rowText(base, 'c', NOW, 120, true).split('\n')
  expect(stripAnsi(head[0] ?? '')).toBe('running')
  expect(head.length).toBe(2)
})

test('a group starts where the neighbour above has another state', () => {
  const st = { a: 'running', b: 'running', c: 'completed', d: 'running' }
  expect(startsGroup(['a', 'b', 'c', 'd'], 'a', st)).toBe(true)
  expect(startsGroup(['a', 'b', 'c', 'd'], 'b', st)).toBe(false)
  expect(startsGroup(['a', 'b', 'c', 'd'], 'c', st)).toBe(true)
  expect(startsGroup(['a', 'b', 'c', 'd'], 'd', st)).toBe(true)
  expect(startsGroup(['a'], 'zz', st)).toBe(true)
})

test('a finished row hides after a minute, a running one never', () => {
  expect(shouldHide('completed', NOW - 61_000, NOW)).toBe(true)
  expect(shouldHide('completed', NOW - 30_000, NOW)).toBe(false)
  expect(shouldHide('completed', undefined, NOW)).toBe(false)
  expect(shouldHide('running', NOW - 999_000, NOW)).toBe(false)
  expect(shouldHide('failed', NOW - 61_000, NOW)).toBe(true)
  expect(shouldHide('killed', NOW - 61_000, NOW)).toBe(true)
  expect(shouldHide('failed', NOW - 30_000, NOW)).toBe(false)
})

test('a finished row shows the time it ran, not the time since', () => {
  const done = rowText({ ...base, status: 'completed' }, 'a', NOW, 120, false, NOW - 60_000)
  expect(stripAnsi(done)).toContain(' 3m ')
  for (const status of ['failed', 'killed']) expect(stripAnsi(rowText({ ...base, status }, 'a', NOW, 120, false, NOW - 60_000))).toContain(' 3m ')
})

test('the compact Agent header', () => {
  expect(compactHeader({ subagent_type: 'engineer', description: 'Fix parser', model: 'sonnet', effort: 'high' }, true, false)?.text).toBe('● engineer  sonnet·high  Fix parser')
  expect(compactHeader({ subagent_type: 'qa', description: 'Check' }, false, false)?.text).toBe('✓ qa  Check')
  expect(compactHeader({ subagent_type: 'qa', description: 'Check' }, false, true)?.text).toBe('✗ qa  Check')
  expect(compactHeader({ description: 'Think' }, true, false)?.text).toBe('● general-purpose  Think')
  expect(compactHeader('nonsense', true, false)).toBeUndefined()
  expect(compactHeader(null, true, false)).toBeUndefined()
})

test('the report keeps only Status and Open lines', () => {
  const text = 'Did stuff.\n\nStatus: done with concerns\nChanged: a.ts\nChecked: tests\nOpen: the docs\nmore\n'
  expect(keepLines(text)).toBe('Status: done with concerns\nOpen: the docs')
  expect(keepLines('**Status:** done\n- Open: none')).toBe('**Status:** done\n- Open: none')
  expect(keepLines('no markers here')).toBeUndefined()
  expect(keepLines('')).toBeUndefined()
})

test('the roster line', () => {
  const rows: RowInfo[] = [base, { ...base, type: 'qa', status: 'waiting' }, { ...base, type: 'researcher', status: 'completed' }]
  expect(rosterLine(rows, NOW, 200)).toBe('3 roles: qa waiting · engineer 4m · researcher done')
  expect(rosterLine([], NOW, 200)).toBeUndefined()
  expect(rosterLine(rows, NOW, 20)?.length).toBe(20)
})

const ROW = (props: object, plugin = 'role-rows') => ({ plugin, component: 'AgentRow', props: { id: 'a1', rowIds: ['a1'], columns: 90, isHidden: false, ...base, ...props } }) as const

test('the AgentRow hook sets the body, on every surface', async ($, on) => {
  mock.env(on, { ROLE_ROWS_STYLE: 'a' })
  on('clock.now', () => ({ value: NOW }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let seen: any
  on('ui.render', ($, e) => { seen = e.props; const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    seen = undefined
    const ui = await $.ui.mount({ ...ROW({}), surface } as any)
    expect(stripAnsi(seen.body)).toContain('engineer')
    expect(seen.isHidden).toBe(false)
    await ui.unmount()
  }
})

test('a bad prop never breaks the row: the engine draws it', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('agent.list', () => { throw new Error('boom') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let seen: any
  on('ui.render', ($, e) => { seen = e.props; const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...ROW({ label: undefined, startTime: 'x' as any }), surface: 'terminal' } as any)
  expect(seen).toBeDefined()
  await ui.unmount()
})

const USE = (props: object) => ({ plugin: 'role-rows', component: 'ToolUse', requestId: 't1', props: { tool_use_id: 't1', tool: 'Agent', input: { subagent_type: 'engineer', description: 'Fix parser', model: 'sonnet', effort: 'high' }, isRunning: true, isErrored: false, isInterrupted: false, isExpanded: false, ...props } }) as any

async function engineUp($: any, on: any, env: Record<string, string> = {}) {
  mock.env(on, env)
  on('clock.now', () => ({ value: NOW }))
  on('agent.list', () => ({ value: [{ ...base, id: 'a1', hasRow: true }] }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
}

test('an Agent call draws the compact header only while collapsed', async ($, on) => {
  await engineUp($, on)
  let ui = await $.ui.mount({ ...USE({}), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engineer/ }))?.text).toBe('● engineer  sonnet·high  Fix parser')
  await ui.unmount()
  for (const props of [{ isExpanded: true }, { tool: 'Bash' }]) {
    ui = await $.ui.mount({ ...USE(props), surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('the report shrinks to Status and Open only when asked', async ($, on) => {
  const RES = (extra: object = {}) => ({ plugin: 'role-rows', component: 'ToolResult', requestId: 't1', props: { tool_use_id: 't1', tool: 'Agent', output: { content: [{ type: 'text', text: 'Did it.\nStatus: done\nOpen: docs\n' }] }, isErrored: false, isExpanded: false, ...extra } }) as any
  await engineUp($, on, { ROLE_ROWS_RESULT: '1' })
  let ui = await $.ui.mount({ ...RES(), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Status/ }))?.text).toBe('Status: done\nOpen: docs')
  await ui.unmount()
  ui = await $.ui.mount({ ...RES({ output: 'plain words' }), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('result and band are off unless the env turns them on', async ($, on) => {
  await engineUp($, on)
  const ui = await $.ui.mount({ plugin: 'role-rows', component: 'ToolResult', requestId: 't1', props: { tool_use_id: 't', tool: 'Agent', output: 'Status: done', isErrored: false }, surface: 'terminal' } as any)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
  const band = await $.ui.mount({ plugin: 'role-rows', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } }, surface: 'terminal' } as any)
  expect(await band.find({ type: 'Text', text: /roles?:/ })).toBeUndefined()
  await band.unmount()
})

test('the roster band shows when on', async ($, on) => {
  await engineUp($, on, { ROLE_ROWS_BAND: '1' })
  const band = await $.ui.mount({ plugin: 'role-rows', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } }, surface: 'terminal' } as any)
  expect((await band.find({ type: 'Text', text: /role/ }))?.text).toBe('1 role: engineer 4m')
  await band.unmount()
})

const AG = (id: string, type: string, status: string, extra: Partial<TreeAgent> = {}): TreeAgent => ({ ...base, id, type, status, ...extra })
const plain = (m: Map<string, string>, id: string) => stripAnsi(m.get(id) ?? '').split('\n')

test('style d groups every agent under its role, header counts and tree lines', () => {
  const out = treeBodies([
    AG('r1', 'researcher', 'completed', { doneAt: NOW - 60_000, model: 'claude-opus-4-8', tokenCount: 82_000, startTime: NOW - 3 * 60_000, label: 'Find the band API' }),
    AG('e1', 'engineer', 'running'),
    AG('q1', 'qa', 'failed', { doneAt: NOW - 10_000 }),
    AG('e2', 'engineer', 'completed', { doneAt: NOW - 30_000, label: 'Wire the band' }),
  ], NOW, 120)
  expect([...out.keys()]).toEqual(['r1', 'e1', 'q1'])
  expect(plain(out, 'e1')).toEqual([
    'engineer  1 running, 1 done',
    ' ├─ ⏺ sonnet·high    4m  25%  Fix the parser',
    ' └─ ✔ sonnet·high    3m  25%  Wire the band',
  ])
  expect(plain(out, 'r1')).toEqual(['researcher  1 done', ' └─ ✔ opus·high      2m  41%  Find the band API'])
  expect(plain(out, 'q1')[1]).toStartWith(' └─ ✘ ')
  // role colored bold, a finished line dimmed, a running one not
  expect(out.get('e1')).toStartWith('\x1b[1;38;2;')
  const [, run, done] = (out.get('e1') ?? '').split('\n')
  expect(run).not.toContain('\x1b[2m sonnet')
  expect(done).toContain('\x1b[2m sonnet')
})

test('style d: the first running agent of a role hosts it, else its first row', () => {
  const out = treeBodies([AG('e2', 'engineer', 'completed', { doneAt: NOW }), AG('e1', 'engineer', 'running')], NOW, 120)
  expect([...out.keys()]).toEqual(['e1'])
  expect(plain(out, 'e1')[0]).toBe('engineer  1 running, 1 done')
  const idle = treeBodies([AG('e2', 'engineer', 'completed', { doneAt: NOW }), AG('e1', 'engineer', 'completed', { doneAt: NOW })], NOW, 120)
  expect([...idle.keys()]).toEqual(['e2'])
})

test('style d keeps a finished line five minutes, then folds it, then hides the role', () => {
  const out = treeBodies([
    AG('e1', 'engineer', 'running'),
    AG('e2', 'engineer', 'completed', { doneAt: NOW - 6 * 60_000 }),
    AG('e3', 'engineer', 'completed', { doneAt: NOW - 4 * 60_000, label: 'Kept' }),
    AG('r1', 'researcher', 'completed', { doneAt: NOW - 6 * 60_000 }),
    AG('q1', 'qa', 'completed'),
  ], NOW, 120)
  expect(out.has('r1')).toBe(false)
  expect(plain(out, 'e1')).toEqual([
    'engineer  1 running, 2 done',
    ' ├─ ⏺ sonnet·high    4m  25%  Fix the parser',
    ' ├─ ✔ sonnet·high    0s  25%  Kept',
    ' └─ ✔ +1 finished',
  ])
  // no doneAt yet counts as just finished
  expect(plain(out, 'q1')[0]).toBe('qa  1 done')
})

test('style d short on height folds finished agents, never a running one', () => {
  const agents = [
    AG('e1', 'engineer', 'running'), AG('e2', 'engineer', 'running'), AG('e3', 'engineer', 'running'),
    AG('e4', 'engineer', 'completed'), AG('e5', 'engineer', 'completed'), AG('e6', 'engineer', 'failed'),
    AG('q1', 'qa', 'completed'), AG('q2', 'qa', 'completed'), AG('r1', 'researcher', 'killed'),
  ]
  expect(plain(treeBodies(agents, NOW, 120, 12), 'e1').length).toBe(7)
  const fold = treeBodies(agents, NOW, 120, 9)
  expect(plain(fold, 'e1')).toEqual([
    'engineer  3 running, 2 done, 1 failed',
    ' ├─ ⏺ sonnet·high    4m  25%  Fix the parser',
    ' ├─ ⏺ sonnet·high    4m  25%  Fix the parser',
    ' ├─ ⏺ sonnet·high    4m  25%  Fix the parser',
    ' ├─ ✘ sonnet·high    4m  25%  Fix the parser',
    ' └─ ✔ +2 finished',
  ])
  expect(plain(fold, 'q1')).toEqual(['qa  2 done'])
  const one = treeBodies(agents, NOW, 120, 7)
  expect([...one.keys()]).toEqual(['e1'])
  expect(plain(one, 'e1').at(-1)).toBe('✔ +3 finished · qa 2, researcher 1')
  // still too tall: one line per role, the waiting one first, then a single roster line
  const roles = treeBodies(agents, NOW, 120, 3)
  expect(plain(roles, 'e1')).toEqual(['engineer  1 failed, 3 running 4m', '✔ +3 finished · qa 2, researcher 1'])
  const roster = treeBodies(agents, NOW, 120, 1)
  expect([...roster.keys()]).toEqual(['e1'])
  expect(plain(roster, 'e1')).toEqual(['engineer 1 failed, 3 running 4m · qa 2 done · researcher done'])
})

test('style d: more roles than the five row slots, the fifth row carries the rest', () => {
  const roles = ['researcher', 'engineer', 'qa', 'designer', 'ops', 'growth', 'Explore']
  const out = treeBodies(roles.map((r, i) => AG(`x${i}`, r, 'running')), NOW, 120)
  expect([...out.keys()]).toEqual(['x0', 'x1', 'x2', 'x3', 'x4'])
  expect(plain(out, 'x4').filter((l) => !l.startsWith(' '))).toEqual(['ops  1 running', 'growth  1 running', 'Explore  1 running'])
})

test('style d lines fit the columns and carry no smuggled escapes', () => {
  const agents = [AG('e1', 'engineer', 'running'), AG('e2', 'x\x1b]0;pwned\x07', 'running', { model: 'a\x1b[2J', effort: 'hi\x1b[31m', label: 'x\x1b[31mred\x07' }), AG('e3', 'engineer', 'completed')]
  for (const cols of [120, 80, 40, 12, 1]) for (const body of treeBodies(agents, NOW, cols).values()) for (const l of body.split('\n')) expect(width(l)).toBeLessThanOrEqual(cols)
  for (const body of treeBodies(agents, NOW, 120).values()) expect(body).not.toMatch(/\x07|\x1b\]|\x1b\[2J|\x1b\[31m/)
})

test('style d row hook: the host draws its role, the rest hide, a status change redraws them', async ($, on) => {
  mock.env(on, {})
  on('clock.now', () => ({ value: NOW }))
  let list = [{ ...base, id: 'e1', status: 'completed', hasRow: true }, { ...base, id: 'e2', hasRow: true }, { ...base, id: 'q1', type: 'qa', hasRow: true }]
  on('agent.list', () => ({ value: list as any }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const seen = new Map<string, any>()
  on('ui.render', ($, e) => { seen.set((e.props as any).id, e.props); const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const rowIds = ['e1', 'e2', 'q1']
  const mount = (a: object) => $.ui.mount({ plugin: 'role-rows', component: 'AgentRow', surface: 'terminal', props: { rowIds, columns: 100, isHidden: false, ...a } } as any)
  const ui = await Promise.all(list.map(mount))
  expect(seen.get('e1').isHidden).toBe(true)
  expect(seen.get('e2').isHidden).toBe(false)
  expect(stripAnsi(seen.get('e2').body).split('\n')[0]).toBe('engineer  1 running, 1 done')
  expect(stripAnsi(seen.get('q1').body).split('\n')[0]).toBe('qa  1 running')
  list = list.map((a) => (a.id === 'e2' ? { ...a, status: 'completed' } : a))
  await ui[1]!.redraw({ ...list[1], rowIds, columns: 100, isHidden: false } as any)
  expect(seen.get('e2').isHidden).toBe(true)
  expect(seen.get('e1').isHidden).toBe(false)
  expect(stripAnsi(seen.get('e1').body).split('\n')[0]).toBe('engineer  2 done')
  for (const u of ui) await u.unmount()
})

test('role summary keeps what is waiting and how long agents run', () => {
  const w = { ...base, status: 'waiting' }
  expect(roleSummary([base], NOW)).toBe('4m')
  expect(roleSummary([base, base], NOW)).toBe('2 running 4m')
  expect(roleSummary([w, base], NOW)).toBe('1 waiting, 4m')
  expect(roleSummary([{ ...base, status: 'completed' }, { ...base, status: 'completed' }], NOW)).toBe('2 done')
  expect(roleSummary([{ ...base, status: 'waiting' }], NOW)).toBe('waiting')
})

test('the roster puts a waiting role first and survives a narrow cut with it in view', () => {
  const rows = [base, { ...base, type: 'qa', status: 'waiting' }, { ...base, type: 'researcher', status: 'completed' }]
  const ag = rows.map((r, i) => ({ ...r, id: 'x' + i }))
  for (const cols of [80, 40, 20, 8]) {
    const body = [...treeBodies(ag, NOW, cols, 1).values()][0]!
    expect(cellWidth(stripAnsi(body))).toBeLessThanOrEqual(cols)
  }
  expect(stripAnsi([...treeBodies(ag, NOW, 30, 1).values()][0]!)).toStartWith('qa waiting · engineer')
})

test('the budget is a third of the rows, three at least, less what the other bands take', () => {
  expect(treeBudget(16)).toBe(5)
  expect(treeBudget(24)).toBe(8)
  expect(treeBudget(40)).toBe(13)
  expect(treeBudget(12)).toBe(4)
  expect(treeBudget(16, 1)).toBe(4)
  expect(treeBudget(12, 5)).toBe(1)
  expect(treeBudget(undefined, 1)).toBe(20)
})

test('every fold level fits 80x16, 100x24, 120x40 in a third of the rows without wrapping', () => {
  const roles = ['engineer', 'qa', 'researcher', 'designer']
  for (const n of [3, 6, 10]) {
    const ag = Array.from({ length: n }, (_, i) => AG('a' + i, roles[i % 4]!, i % 5 === 3 ? 'completed' : i === 1 ? 'waiting' : 'running', { startTime: NOW - (i + 1) * 70_000, label: 'Implement the parser and wire the roster band into the prompt area' }))
    for (const [cols, rows] of [[80, 16], [100, 24], [120, 40]] as const) {
      const lines = [...treeBodies(ag, NOW, cols, treeBudget(rows, 1)).values()].flatMap((b) => b.split('\n'))
      expect(lines.length).toBeLessThanOrEqual(Math.max(3, Math.floor(rows / 3)) - 1)
      for (const l of lines) expect(cellWidth(stripAnsi(l))).toBeLessThanOrEqual(cols)
      expect(stripAnsi(lines.join('\n'))).toContain('waiting')
    }
  }
})

test('wide glyphs count two cells and cut cleanly', () => {
  expect(cellWidth('ab')).toBe(2)
  expect(cellWidth('漢字')).toBe(4)
  expect(cellWidth('🚀x')).toBe(3)
  expect(cut('漢字漢字', 5)).toBe('漢字…')
  expect(cellWidth(cut('🚀🚀🚀🚀', 5))).toBeLessThanOrEqual(5)
  expect(cut('abcdef', 4)).toBe('abc…')
  const out = treeBodies([AG('e1', 'engineer', 'running', { label: '漢字🚀'.repeat(30) })], NOW, 40).get('e1')!
  for (const l of out.split('\n')) expect(cellWidth(stripAnsi(l))).toBeLessThanOrEqual(40)
})
