import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { cacheWord, pingIn, statusLine } from '../hooks/register.tsx'

const MIN = 60_000

// Switchboard window, session and fork answers beneath the plugin; reads = cache_read per fork, in order.
function rig($: Engine, on: On, reads: number[] = [], forkRaisesTurn = false, limits?: () => object) {
  const clock = mock.clock(on, { now: 1_000 * MIN })
  const posts: Record<string, unknown>[] = []
  const status: (string | undefined)[] = []
  let forks = 0
  mock.env(on, { HOME: '/u' })
  on('fs.list', () => ({ value: [{ name: 'w1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: JSON.stringify(limits && String(e.path).endsWith('limits.json') ? limits() : { port: 4100, hubToken: 'tok', workspace: '/u/p' }) }))
  let gate: Promise<void> | undefined
  on('http.fetch', async (_, e) => {
    await gate
    posts.push(JSON.parse(String(e.init?.body ?? '{}')))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.cwd', () => ({ value: '/u/p' }))
  on('session.usage', () => ({ value: { context: { tokens: 312_000, window: 1_000_000, percent: 31 }, rateLimits: [], startedAt: 0 } }))
  on('model.fork', async () => {
    // In case the engine runs a fork as a main-loop turn of its own.
    if (forkRaisesTurn) {
      await $.turn.start({ text: 'ping', turnId: `f${forks}` })
      await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `f${forks}`, reason: 'answer' })
    }
    const read = reads[forks++] ?? 300_000
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } } }
  })
  on('ui.status', (_, e) => { status.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const open: (() => void)[] = []
  on('tool.call', () => new Promise(res => open.push(() => res({ result: 'ok' } as never))))
  // A tool that stays open until answered, like a question Kenneth has not picked yet.
  const hold = async (tool = 'AskUserQuestion', agentId?: string) => {
    const p = $.tool.call({ tool, questions: [], ...(agentId ? { agentId } : {}) } as never)
    await clock.settle()
    return async () => { open.shift()!(); await p; await clock.settle() }
  }
  const start = () => $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const turn = async (answer = 'done') => {
    await $.turn.start({ text: 'go', turnId: 't' })
    await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await clock.settle()
  }
  const cache = () => posts.filter(p => p.kind === 'cache')
  return { clock, posts, status, cache, start, turn, hold, forks: () => forks, slowPosts: (p?: Promise<void>) => { gate = p } }
}

test('the band and status line say how long the cache stays warm', () => {
  const now = 0
  const k = (o: object) => ({ state: 'warm', warmUntil: 55 * MIN, tokens: 312_000, pings: 0, idleSince: 0, now, ...o }) as never
  expect(cacheWord(k({}), now)).toBe('warm 55m')
  expect(cacheWord(k({ state: 'cold' }), now)).toBe('cold')
  expect(cacheWord(k({ state: 'off' }), now)).toBeUndefined()
  expect(pingIn(k({ pingAt: 37 * MIN }), now)).toBe(37)
  expect(statusLine({ state: 'warm', warmUntil: 42 * MIN, tokens: 1, pings: 0, idleSince: 0, now }, now)).toBe('cache warm 42m')
  expect(statusLine({ state: 'cold', warmUntil: 0, tokens: 1, pings: 0, idleSince: 0, now }, now)).toBe('cache cold')
  expect(statusLine({ state: 'off', warmUntil: 0, tokens: 1, pings: 0, idleSince: 0, now }, now)).toBeUndefined()
})

test('an idle chat gets a silent ping just before the cache expires, and Switchboard hears it', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn()
  expect(r.cache().at(-1)).toMatchObject({ token: 'tok', kind: 'cache', sessionId: 'chat-1', state: 'warm', tokens: 312_000, pings: 0 })
  await r.clock.advance(54 * MIN)
  expect(r.forks()).toBe(0)
  await r.clock.advance(1 * MIN)
  expect(r.forks()).toBe(1)
  const last = r.cache().at(-1)!
  expect(last).toMatchObject({ state: 'warm', pings: 1 })
  expect(last.warmUntil).toBe(r.clock.now() + 60 * MIN)
  expect(r.status.at(-1)).toBe('cache warm 60m')
})

test('a ping that finds the cache already gone marks it cold and stops', async ($, on) => {
  const r = rig($, on, [0])
  await r.start()
  await r.turn()
  await r.clock.advance(55 * MIN)
  expect(r.cache().at(-1)).toMatchObject({ state: 'cold' })
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(1)
  expect(r.status.at(-1)).toBe('cache cold')
})

test('pinging stops after the idle cap', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn()
  await r.clock.advance(4 * 60 * MIN)
  // 55, 110, 165; the one due at 220 is past three hours.
  expect(r.forks()).toBe(3)
  expect(r.cache().at(-1)).toMatchObject({ state: 'off' })
})

test('a new turn resets the count and never overlaps a ping', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn()
  await r.clock.advance(55 * MIN)
  expect(r.cache().at(-1)).toMatchObject({ pings: 1 })
  await $.turn.start({ text: 'more', turnId: 't2' })
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(1)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await r.clock.settle()
  expect(r.cache().at(-1)).toMatchObject({ state: 'warm', pings: 0 })
})

test('a finished chat, or one cleared, is left to go cold', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn('All set.\n\nCommit message:\n```\nx\n```')
  expect(r.cache().at(-1)).toMatchObject({ state: 'off' })
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(0)

  await r.turn()
  expect(r.cache().at(-1)).toMatchObject({ state: 'warm' })
  await $.session.end({ reason: 'clear', sessionId: 'chat-1', resume: {} as never })
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(0)
  expect(r.cache().at(-1)).toMatchObject({ state: 'off', sessionId: 'chat-1' })
})

test('a subagent turn neither starts nor stops the keeper', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await $.turn.start({ text: 'x', turnId: 'a', agentId: 'ag1' })
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 'a', agentId: 'ag1', reason: 'answer' })
  await r.clock.advance(120 * MIN)
  expect(r.cache().length).toBe(0)
  expect(r.forks()).toBe(0)
})

test('the band shows once the chat has activity, and steps aside while it works', async ($, on) => {
  const r = rig($, on)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return h(Text, {}, 'engine') as RenderElement })
  await r.start()
  const band = (isWorking: boolean, surface: 'terminal' | 'desktop') => $.ui.mount({
    plugin: 'cache-keeper', surface, component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const before = await band(false, surface)
    expect(await before.find({ type: 'Text', text: /warm|cold/ })).toBeUndefined()
    await before.unmount()
  }
  await r.turn()
  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await band(false, surface)
    expect((await idle.find({ type: 'Text', text: /^warm/ }))?.text).toBe('warm 60m')
    expect((await idle.find({ type: 'Text', text: /^cache $/ }))?.text).toBe('cache ')
    // stacks over what is beneath instead of hiding it
    expect((await idle.find({ type: 'Text', text: /^engine$/ }))?.text).toBe('engine')
    await idle.unmount()
    const working = await band(true, surface)
    expect(await working.find({ type: 'Text', text: /warm|cold/ })).toBeUndefined()
    await working.unmount()
  }
})

test('a ping that raises turn events of its own neither resets the idle clock nor stops the keeper', async ($, on) => {
  const r = rig($, on, [], true)
  await r.start()
  await r.turn()
  await r.clock.advance(55 * MIN)
  expect(r.cache().at(-1)).toMatchObject({ state: 'warm', pings: 1 })
  await r.clock.advance(4 * 60 * MIN)
  expect(r.forks()).toBe(3)
  expect(r.cache().at(-1)).toMatchObject({ state: 'off' })
})

test('a turn running when the mod reloads is still a turn: no ping fires into it', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn()
  await $.turn.start({ text: 'more', turnId: 't2' })
  // A reload runs session.start again; the running turn is known only from $.state.
  await r.start()
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(0)
})

test('a chat that exits tells Switchboard it is off', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await r.turn()
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'chat-1', resume: {} as never })
  expect(r.cache().at(-1)).toMatchObject({ state: 'off', sessionId: 'chat-1' })
})

test('no ping while Switchboard holds the chat at its usage limit; the keep goes off', async ($, on) => {
  let limits: object = { windows: [] }
  const r = rig($, on, [], false, () => limits)
  await r.start()
  await r.turn()
  limits = { windows: [], paused: true, pause: { kind: 'five_hour', percent: 99, resumeAt: r.clock.now() + 120 * MIN, chats: [] } }
  await r.clock.advance(55 * MIN)
  expect(r.forks()).toBe(0)
  expect(r.cache().at(-1)).toMatchObject({ state: 'off' })
  // A pause past its resumeAt holds nothing.
  limits = { windows: [], paused: true, pause: { kind: 'five_hour', percent: 99, resumeAt: r.clock.now() - 1, chats: [] } }
  await r.turn()
  await r.clock.advance(55 * MIN)
  expect(r.forks()).toBe(1)
})

test('a question left open past the cache lifetime is pinged, first turn included', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await $.turn.start({ text: 'go', turnId: 't' })
  const answer = await r.hold()
  await r.clock.advance(54 * MIN)
  expect(r.forks()).toBe(0)
  await r.clock.advance(1 * MIN)
  expect(r.forks()).toBe(1)
  expect(r.cache().at(-1)).toMatchObject({ state: 'warm', pings: 1, tokens: 312_000 })
  await r.clock.advance(55 * MIN)
  expect(r.forks()).toBe(2)
  await answer()
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(2)
})

test('an open tool is pinged until the wait cap, not the idle cap', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await $.turn.start({ text: 'go', turnId: 't' })
  const answer = await r.hold()
  await r.clock.advance(12 * 60 * MIN)
  // 55 min apart; the ninth lands at 495, past eight hours.
  expect(r.forks()).toBe(8)
  expect(r.cache().at(-1)).toMatchObject({ state: 'off' })
  await answer()
})

test('quick tools never ping or post, and the last of several open ones ends the wait', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await $.turn.start({ text: 'go', turnId: 't' })
  const a = await r.hold('Bash')
  await a()
  expect(r.cache().length).toBe(0)
  const b = await r.hold('Bash')
  const c = await r.hold('Read')
  await b()
  await r.clock.advance(55 * MIN)
  expect(r.forks()).toBe(1)
  await c()
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(1)
})

test('a subagent\'s open tool is not the chat waiting', async ($, on) => {
  const r = rig($, on)
  await r.start()
  const done = await r.hold('Bash', 'ag1')
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(0)
  await done()
})

test('a wait whose cache was already gone goes cold and stops', async ($, on) => {
  const r = rig($, on, [0])
  await r.start()
  await $.turn.start({ text: 'go', turnId: 't' })
  const answer = await r.hold()
  await r.clock.advance(300 * MIN)
  expect(r.forks()).toBe(1)
  expect(r.cache().at(-1)).toMatchObject({ state: 'cold' })
  await answer()
})

test('a ping still posting when the tool ends schedules nothing more', async ($, on) => {
  const r = rig($, on)
  await r.start()
  await $.turn.start({ text: 'go', turnId: 't' })
  const answer = await r.hold()
  let free = () => {}
  r.slowPosts(new Promise(res => { free = res }))
  await r.clock.advance(55 * MIN)
  expect(r.forks()).toBe(1)
  await answer()
  r.slowPosts()
  free()
  await r.clock.settle()
  await r.clock.advance(120 * MIN)
  expect(r.forks()).toBe(1)
})
