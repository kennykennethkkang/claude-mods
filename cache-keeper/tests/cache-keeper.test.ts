import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bandLine, statusLine } from '../hooks/register.tsx'

const MIN = 60_000

// Switchboard window, session and fork answers beneath the plugin; reads = cache_read per fork, in order.
function rig($: Engine, on: On, reads: number[] = [], forkRaisesTurn = false) {
  const clock = mock.clock(on, { now: 1_000 * MIN })
  const posts: Record<string, unknown>[] = []
  const status: (string | undefined)[] = []
  let forks = 0
  mock.env(on, { HOME: '/u' })
  on('fs.list', () => ({ value: [{ name: 'w1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: JSON.stringify({ port: 4100, hubToken: 'tok', workspace: '/u/p' }) }))
  on('http.fetch', (_, e) => {
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
  const start = () => $.session.start({ cwd: '/u/p', surface: 'terminal', isInteractive: true })
  const turn = async (answer = 'done') => {
    await $.turn.start({ text: 'go', turnId: 't' })
    await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await clock.settle()
  }
  const cache = () => posts.filter(p => p.kind === 'cache')
  return { clock, posts, status, cache, start, turn, forks: () => forks }
}

test('the band and status line say how long the cache stays warm', () => {
  const now = 0
  expect(bandLine({ state: 'warm', warmUntil: 55 * MIN, tokens: 312_000, pings: 0, idleSince: 0, now }, now))
    .toBe('cache-keeper · 312k tokens cached · warm 55m · keep-alive ping in 50m')
  expect(bandLine({ state: 'warm', warmUntil: 55 * MIN, tokens: 312_000, pings: 2, idleSince: 0, now }, now))
    .toBe('cache-keeper · 312k tokens cached · warm 55m · 2 pings sent · next in 50m')
  expect(bandLine({ state: 'cold', warmUntil: 0, tokens: 1_200_000, pings: 1, idleSince: 0, now }, now))
    .toBe('cache-keeper · cache went cold · the next prompt re-reads 1.2M tokens')
  expect(bandLine({ state: 'off', warmUntil: 55 * MIN, tokens: 312_000, pings: 0, idleSince: 0, now }, now)).toBeUndefined()
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
    expect(await before.find({ type: 'Text', text: /cache-keeper/ })).toBeUndefined()
    await before.unmount()
  }
  await r.turn()
  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await band(false, surface)
    expect((await idle.find({ type: 'Text', text: /cache-keeper/ }))?.text).toBe('cache-keeper · 312k tokens cached · warm 60m · keep-alive ping in 55m')
    await idle.unmount()
    const working = await band(true, surface)
    expect(await working.find({ type: 'Text', text: /cache-keeper/ })).toBeUndefined()
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
