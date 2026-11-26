import { expect, mock, test } from 'claude-code/testing'

import { answersOf, fit, lineSegs, told, todoOf, width } from '../hooks/register.tsx'
import { bare, classify, modeFiles, questionBucket, questionPick, rate, sha256Hex, smartPick, tail } from '../hooks/smart.ts'

const BAND = {
  plugin: 'smart-select',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } },
} as const

test('classifies a prompt into a task', () => {
  expect(classify('fix a typo in the readme')).toBe('tiny')
  expect(classify('fix the crash when saving')).toBe('fix')
  expect(classify('fix the button layout on mobile')).toBe('ui')
  expect(classify('add a retry to the upload queue')).toBe('feature')
  expect(classify('review the last commit')).toBe('review')
  expect(classify('audit the whole repo for dead code')).toBe('audit')
  expect(classify('compare these two libraries')).toBe('research')
  expect(classify('thanks')).toBe('other')
})

test('hashes the project dir the way ponytail does', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const f = await modeFiles('/u/.claude/', '/u/proj/')
  expect(f.shared).toBe('/u/.claude/.ponytail-active')
  expect(f.project).toBe(`/u/.claude/ponytail-modes/${await sha256Hex('/u/proj')}`)
})

test('the learned table moves a pick only with 5 rows and a 0.15 better rate', () => {
  const opts = ['off', 'lite', 'full', 'ultra']
  const stats = (s: Record<string, { n: number; useful: number }>) => ({ stats: { ponytail: { fix: s } } })
  expect(smartPick('ponytail', 'fix', 'full', 'rule', opts, undefined)).toEqual({ pick: 'full', why: 'rule' })
  // 4 rows: too few
  expect(smartPick('ponytail', 'fix', 'full', 'rule', opts, stats({ lite: { n: 4, useful: 4 } })).pick).toBe('full')
  // full 3/10 vs lite 9/10: 0.33 vs 0.83
  const p = smartPick('ponytail', 'fix', 'full', 'rule', opts, stats({ full: { n: 10, useful: 3 }, lite: { n: 10, useful: 9 } }))
  expect(p).toEqual({ pick: 'lite', why: 'learned: lite kept 90% of 10' })
  // close rates stay with the rule
  expect(smartPick('ponytail', 'fix', 'full', 'rule', opts, stats({ full: { n: 10, useful: 7 }, lite: { n: 10, useful: 8 } })).pick).toBe('full')
  expect(rate(undefined)).toBe(0.5)
  // another task's stats do not count
  expect(smartPick('ponytail', 'ui', 'lite', 'r', opts, stats({ full: { n: 10, useful: 10 } })).pick).toBe('lite')
})

test('a question pick is the Recommended option, else the first', () => {
  const q = { header: 'Side', options: [{ label: 'Left' }, { label: 'Right (Recommended)' }] }
  expect(questionPick(q)).toEqual({ pick: 'Right', options: ['Left', 'Right'], recommended: true })
  expect(questionPick({ options: [{ label: 'A' }, { label: 'B' }] })?.pick).toBe('A')
  expect(questionPick({ options: [] })).toBeUndefined()
  expect(bare('Approve (Recommended) ')).toBe('Approve')
})

test('reads answers from the answers map and from the ask tool text', () => {
  const qs = [{ question: 'Which side?' }, { question: 'Why?' }, { question: 'Skipped?' }]
  expect(answersOf({ answers: { 'Which side?': 'Right (Recommended)', 'Why?': { answers: ['Because'] } } }, undefined, qs)).toEqual(['Right', 'Because', undefined])
  expect(answersOf({}, '"Which side?": Left\n"Why?": Maybe, both', qs)).toEqual(['Left', 'Maybe, both', undefined])
})

test('the tail keeps this session, merges finals, ignores bad lines', () => {
  const text = [
    JSON.stringify({ t: 'pick', session: 's', kind: 'role', task: 'engineer', pick: 'sonnet', key: 'role:1' }),
    'not json',
    JSON.stringify({ t: 'final', session: 's', kind: 'role', key: 'role:1', final: 'opus' }),
    JSON.stringify({ t: 'pick', session: 'other', kind: 'role', task: 'qa', pick: 'haiku', key: 'role:2' }),
  ].join('\n')
  const rows = tail(text, 's', ['role'])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ task: 'engineer', pick: 'sonnet', final: 'opus' })
  expect(told({ task: 'fix', pick: 'off', why: 'x' })).toMatch(/off for this fix task/)
})

type Rig = { files: Map<string, string>; contexts: Array<readonly string[] | undefined> }
function rig(on: never, init: Record<string, string> = {}, env: Record<string, string> = {}): Rig {
  const files = new Map(Object.entries(init))
  const contexts: Rig['contexts'] = []
  const h = on as (ev: string, fn: (...a: never[]) => unknown) => void
  mock.env(on, { HOME: '/u', CLAUDE_PROJECT_DIR: '/u/proj', ...env })
  h('session.id', () => ({ value: 's1' }))
  h('session.cwd', () => ({ value: '/u/proj' }))
  h('clock.now', (() => ({ value: 1_000 })) as never)
  h('fs.read', ((_: unknown, e: { path: string }) => (files.has(e.path) ? { value: files.get(e.path) } : Promise.reject(new Error('missing')))) as never)
  h('fs.list', ((_: unknown, e: { path: string }) => ({ value: [...files.keys()].filter(k => k.startsWith(`${e.path}/`)).map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) })) as never)
  h('fs.write', ((_: unknown, e: { path: string; text: string }) => { files.set(e.path, e.text); return { value: undefined } }) as never)
  h('prompt.submit', ((_: unknown, e: { text: string; context?: readonly string[] }) => { contexts.push(e.context); return { text: e.text } }) as never)
  return { files, contexts }
}
const OWN = '/u/.claude/switchboard/smart-picks.d/s1-select.jsonl'
const rows = (r: Rig) => (r.files.get(OWN) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))

test('the first prompt picks a level, writes ponytail files, tells the model, logs a pick', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const hash = await sha256Hex('/u/proj')
  expect(r.files.get(`/u/.claude/ponytail-modes/${hash}`)).toBe('full')
  expect(r.files.get('/u/.claude/.ponytail-active')).toBe('full')
  expect((r.contexts[0] ?? []).join('\n')).toMatch(/ponytail level full for this fix task/)
  expect(rows(r)).toEqual([expect.objectContaining({ t: 'pick', kind: 'ponytail', task: 'fix', pick: 'full', session: 's1', cwd: '/u/proj', key: 'ponytail:1000', options: ['off', 'lite', 'full', 'ultra'] })])
})

test('a later switch logs a final, and Kenneth\'s level holds until the Smart button', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const hash = await sha256Hex('/u/proj')
  // /ponytail ultra rewrote the flag
  r.files.set(`/u/.claude/ponytail-modes/${hash}`, 'ultra')
  await $.prompt.submit({ text: 'now redesign the settings page layout completely please' })
  expect(rows(r).map(x => [x.t, x.final ?? x.pick])).toEqual([['pick', 'full'], ['final', 'ultra']])
  expect(r.files.get(`/u/.claude/ponytail-modes/${hash}`)).toBe('ultra')
  expect(r.contexts[1]).toBeUndefined()
})

test('a new task prompt picks again, a short follow up does not', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  await $.prompt.submit({ text: 'and the other one' })
  await $.prompt.submit({ text: 'now redesign the settings page layout completely please' })
  expect(rows(r).map(x => `${x.task}:${x.pick}`)).toEqual(['fix:full', 'ui:lite'])
})

test('learned stats change the pick and say why', async ($, on) => {
  const learned = { stats: { ponytail: { fix: { full: { n: 10, useful: 2 }, lite: { n: 8, useful: 8 } } } } }
  const r = rig(on as never, { '/u/.claude/switchboard/smart-learned.json': JSON.stringify(learned) })
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  expect(rows(r)[0]).toMatchObject({ pick: 'lite', why: 'learned: lite kept 100% of 8' })
})

test('a question logs a pick, then the chosen answer', async ($, on) => {
  const r = rig(on as never)
  ;(on as never as (ev: string, fn: () => unknown) => void)('tool.call', () => ({ result: { answers: { 'Which side?': 'Left' } } }))
  const questions = [{ question: 'Which side?', header: 'Side', multiSelect: false, options: [{ label: 'Left' }, { label: 'Right (Recommended)' }] }]
  await $.tool.call({ tool: 'AskUserQuestion', questions } as never)
  expect(rows(r)).toEqual([
    expect.objectContaining({ t: 'pick', kind: 'question', task: 'scope', pick: 'Right', why: 'marked (Recommended) in the question', options: ['Left', 'Right'], key: 'question:1000' }),
    expect.objectContaining({ t: 'final', kind: 'question', key: 'question:1000', final: 'Left' }),
  ])
})

test('the ask tool reports through its text', async ($, on) => {
  const r = rig(on as never)
  ;(on as never as (ev: string, fn: () => unknown) => void)('tool.call', () => ({ result: {}, text: '"Go?": Yes' }))
  await $.tool.call({ tool: 'mcp__switchboard__ask', questions: [{ question: 'Go?', options: [{ label: 'Yes' }, { label: 'No' }] }] } as never)
  expect(rows(r).map(x => [x.t, x.task, x.pick ?? x.final])).toEqual([['pick', 'other', 'Yes'], ['final', undefined, 'Yes']])
})

test('the band shows the pick with a Smart button and stacks over another mod\'s row', async ($, on) => {
  const r = rig(on as never)
  const ledger = [{ t: 'pick', at: 1, session: 's1', kind: 'role', task: 'fix', pick: 'engineer', key: 'role:1' }, { t: 'pick', at: 1, session: 's1', kind: 'model', task: 'fix', pick: 'sonnet', key: 'model:1' }].map(x => JSON.stringify(x)).join('\n')
  r.files.set('/u/.claude/switchboard/smart-picks.d/s1-meter.jsonl', `${ledger}\n`)
  // the extension's own rows for the chat's model and effort stay in the shared file
  r.files.set('/u/.claude/switchboard/smart-picks.jsonl', [{ t: 'pick', at: 5, session: 's1', kind: 'model', task: 'fix', pick: 'opus', key: 'model:5' }, { t: 'pick', at: 6, session: 's1', kind: 'effort', task: 'fix', pick: 'high', key: 'effort:6' }].map(x => JSON.stringify(x)).join('\n') + '\n')
  ;(on as never as (ev: string, fn: (...a: never[]) => unknown) => void)('ui.render', (($: never, e: never) => {
    const { Text } = ($ as { ui: { resolve: (e: unknown) => { Text: never } } }).ui.resolve(e)
    return <Text>other row</Text>
  }) as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /ponytail full/ })
  expect(row?.text).toContain('opus high')
  expect(row?.text).not.toContain('roles')
  expect(row?.text).not.toContain('why')
  expect(await ui.find({ type: 'Button', label: 'Smart' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /other row/ }))?.text).toBe('other row')
  await ui.unmount()
})

test('no pick yet, no band', async ($, on) => {
  rig(on as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', label: 'Smart' })).toBeUndefined()
  await ui.unmount()
})

test('the Smart button re-applies the pick over Kenneth\'s level and tells the next turn', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const hash = await sha256Hex('/u/proj')
  r.files.set(`/u/.claude/ponytail-modes/${hash}`, 'ultra')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'smart' })
  await ui.unmount()
  expect(r.files.get(`/u/.claude/ponytail-modes/${hash}`)).toBe('full')
  await $.prompt.submit({ text: 'carry on' })
  expect((r.contexts[1] ?? []).join('\n')).toMatch(/ponytail level full/)
})

test('the row is one line cut to the columns, and stays on a short terminal', async ($, on) => {
  rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 18 }, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /pony/ })
  expect(row?.text).not.toContain('\n')
  expect((row?.text ?? '').length + 'Smart'.length).toBeLessThanOrEqual(18)
  expect(row?.text.endsWith('…')).toBe(true)
  await ui.unmount()
  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 10 }, surface: 'terminal' })
  expect(await short.find({ type: 'Button', label: 'Smart' })).toBeDefined()
  await short.unmount()
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abc', 4)).toBe('abc')
})

test('/smart re-applies the pick and tells the next turn', async ($, on) => {
  const r = rig(on as never)
  ;(on as never as (ev: string, fn: () => unknown) => void)('command.register', () => ({ value: { command: 'smart' } }))
  ;(on as never as (ev: string, fn: (_: unknown, e: { cwd: string }) => unknown) => void)('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/u/proj', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'smart' })).text).toBe('Smart select: no task picked yet.')
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  const hash = await sha256Hex('/u/proj')
  r.files.set(`/u/.claude/ponytail-modes/${hash}`, 'ultra')
  expect((await $.command.run({ command: 'smart' })).text).toBe('Smart: ponytail full (bug fix: root cause, short diff)')
  expect(r.files.get(`/u/.claude/ponytail-modes/${hash}`)).toBe('full')
})

test('question tasks use the hub bucket, from the header else the question text', () => {
  expect(questionBucket('Names', 'x')).toBe('naming')
  expect(questionBucket(undefined, 'Which name should the tab use?')).toBe('naming')
  expect(questionBucket('design', '')).toBe('design')
  expect(questionBucket('', 'Go?')).toBe('other')
})

test('a headerless question files under its bucket', async ($, on) => {
  const r = rig(on as never)
  ;(on as never as (ev: string, fn: () => unknown) => void)('tool.call', () => ({ result: {}, text: '"Rename the tab?": Yes' }))
  await $.tool.call({ tool: 'mcp__switchboard__ask', questions: [{ question: 'Rename the tab?', options: [{ label: 'Yes' }, { label: 'No' }] }] } as never)
  expect(rows(r)[0]).toMatchObject({ kind: 'question', task: 'naming' })
})

test('rows go to this session\'s own file and never rewrite the shared ledger', async ($, on) => {
  const r = rig(on as never, { '/u/.claude/switchboard/smart-picks.jsonl': '{"t":"pick","session":"x"}\n' })
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  expect(r.files.get('/u/.claude/switchboard/smart-picks.jsonl')).toBe('{"t":"pick","session":"x"}\n')
  expect(rows(r)).toHaveLength(1)
})

const MODE = async () => `/u/.claude/ponytail-modes/${await sha256Hex('/u/proj')}`

test('another live chat that wrote the level in the last 10 minutes keeps it', async ($, on) => {
  const r = rig(on as never)
  r.files.set(await MODE(), 'ultra')
  r.files.set(`${await MODE()}.smart`, JSON.stringify({ session: 'other', at: 1_000 - 60_000 }))
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  expect(r.files.get(await MODE())).toBe('ultra')
  expect(r.files.get('/u/.claude/.ponytail-active')).toBeUndefined()
  // the pick is still logged and told, just not written
  expect(rows(r)[0]).toMatchObject({ pick: 'full' })
  // their later change is not Kenneth's switch here
  r.files.set(await MODE(), 'lite')
  await $.prompt.submit({ text: 'now redesign the settings page layout completely please' })
  expect(rows(r).filter(x => x.t === 'final')).toEqual([])
})

test('a stale stamp from another chat does not block, and ours is stamped after a write', async ($, on) => {
  const r = rig(on as never)
  r.files.set(`${await MODE()}.smart`, JSON.stringify({ session: 'other', at: 1_000 - 11 * 60_000 }))
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  expect(r.files.get(await MODE())).toBe('full')
  expect(JSON.parse(r.files.get(`${await MODE()}.smart`) ?? '{}')).toEqual({ session: 's1', at: 1_000 })
})

test('once Kenneth sets a level, switching back does not hand control to the mod', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  r.files.set(await MODE(), 'ultra')
  await $.prompt.submit({ text: 'carry on with that please' })
  r.files.set(await MODE(), 'full')
  await $.prompt.submit({ text: 'now redesign the settings page layout completely please' })
  expect(r.files.get(await MODE())).toBe('full')
  expect(rows(r).filter(x => x.t === 'pick')).toHaveLength(1)
})

test('/smart writes over a hand level', async ($, on) => {
  const r = rig(on as never)
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  r.files.set(await MODE(), 'lite')
  // /smart re-applies on purpose, even over a hand level
  await $.command.run({ command: 'smart' })
  expect(r.files.get(await MODE())).toBe('full')
})

test('a typed /ponytail before any pick holds his level', async ($, on) => {
  const r = rig(on as never)
  const hash = await sha256Hex('/u/proj')
  r.files.set(`/u/.claude/ponytail-modes/${hash}`, 'ultra')
  await $.prompt.submit({ text: '/ponytail ultra' })
  await $.prompt.submit({ text: 'fix the crash when saving a draft' })
  expect(r.files.get(`/u/.claude/ponytail-modes/${hash}`)).toBe('ultra')
  expect(rows(r)).toEqual([])
})

const text = (g: { t: string }[]) => g.map(x => x.t).join('')
const full = { todo: { n: 3, text: 'Fix the stuck chat card now', total: 4 }, ponytail: 'lite', model: 'opus high', cache: 'warm 42m' }

test('layout A folds model, then cache, then to-do text, then ponytail', () => {
  expect(text(lineSegs(full, 200))).toBe('To-do 3 Fix the stuck chat card now +3  │  ponytail lite  opus high  │  cache warm 42m')
  expect(text(lineSegs(full, 78))).toBe('To-do 3 Fix the stuck chat card now +3  │  ponytail lite  │  cache warm 42m')
  expect(text(lineSegs(full, 60))).toBe('To-do 3 Fix the stuck chat card now +3  │  ponytail lite')
  expect(text(lineSegs(full, 45))).toBe('To-do 3 Fix the stuck c… +3  │  ponytail lite')
  expect(text(lineSegs(full, 30))).toMatch(/^To-do 3 Fix the stuck chat.*…$/)
  expect(lineSegs(full, 30).reduce((n, g) => n + g.t.length, 0)).toBeLessThanOrEqual(30)
})

test('a cold cache is colored and never folds; styles are bold head, dim labels', () => {
  const g = lineSegs({ ponytail: 'lite', model: 'opus high', cache: 'cold' }, 30)
  expect(text(g)).toBe('ponytail lite  │  cache cold')
  expect(g.find(x => x.t === 'cold')?.c).toBe('warning')
  expect(g.find(x => x.t === 'ponytail ')?.dim).toBe(true)
  expect(lineSegs(full, 200)[0]).toEqual({ t: 'To-do 3', b: true })
})

test('todoOf reads the env JSON', () => {
  expect(todoOf('{"n":3,"text":" a  b ","total":2}')).toEqual({ n: 3, text: 'a b', total: 2 })
  expect(todoOf('nope')).toBeUndefined()
})

test('the row carries cache-keeper\'s state and the to-do when there is no pane', async ($, on) => {
  rig(on as never, {}, { SWITCHBOARD_TODO: JSON.stringify({ n: 3, text: 'Fix the card', total: 1 }) })
  ;(on as never as (ev: string, fn: (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => unknown) => void)('state.get', (_, e, next) =>
    e.key === 'keep' ? { value: { value: { state: 'warm', warmUntil: 42 * 60_000, now: 0 }, version: 1 } } : next(e))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /To-do 3/ }))?.text).toBe('To-do 3 Fix the card  │  cache warm 42m')
  expect(await ui.find({ type: 'Button', label: 'Smart' })).toBeUndefined()
  await ui.unmount()
})

test('a cold cache never folds: the to-do text is cut instead', () => {
  const o = { todo: { n: 3, text: 'Fix the stuck chat card when the hub reloads twice', total: 4 }, ponytail: 'lite', model: 'opus high', cache: 'cold' }
  for (const room of [90, 60, 49, 40, 30, 20, 16]) {
    const t = text(lineSegs(o, room))
    expect(t.endsWith('cache cold')).toBe(true)
    expect(width(t)).toBeLessThanOrEqual(room)
  }
  expect(text(lineSegs(o, 49))).toMatch(/^To-do 3 Fix .*… \+3  │  cache cold$/)
  // no to-do: ponytail goes before the cold cache does
  expect(text(lineSegs({ ponytail: 'lite', model: 'opus high', cache: 'cold' }, 12))).toBe('cache cold')
})

test('widths count terminal cells, not characters', () => {
  const o = { todo: { n: 3, text: '修复卡住的聊天卡片并且重新加载中心服务器', total: 1 }, ponytail: 'lite', model: 'opus high', cache: 'warm 42m' }
  for (const room of [80, 60, 40, 25]) expect(width(text(lineSegs(o, room)))).toBeLessThanOrEqual(room)
  expect(width('漢字')).toBe(4)
  expect(fit('漢字漢字', 5)).toBe('漢字…')
})
