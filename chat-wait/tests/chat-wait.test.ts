import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { checkText, editClash, editDenial, matchTargets, MAX_BLOCKS, outcomeOf, peersOf, resetCache, stopReason, waitStep, waitsOn } from '../hooks/register.ts'

const ME = 'me-0000-1111'
const state = (over: Record<string, unknown> = {}) => ({
  chats: [
    { sessionId: ME, name: 'lead', cwd: '/r/app', project: 'app', live: true, ai: 'claude' },
    { sessionId: 'aaaa-1111', name: 'hub engineer', cwd: '/r/app/ext', project: 'app', live: true, ai: 'claude' },
    { sessionId: 'bbbb-2222', name: 'codex fixer', cwd: '/r/app', project: 'app', live: true, ai: 'codex' },
    { sessionId: 'cccc-3333', name: 'other repo', cwd: '/r/blog', project: 'blog', live: true },
    { sessionId: 'dddd-4444', name: 'closed', cwd: '/r/app', project: 'app', live: false },
  ],
  progress: [
    { sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'working', tasks: [{ id: '1', subject: 'Add link kind', status: 'in_progress' }] },
    { sessionId: 'bbbb-2222', cwd: '/r/app', state: 'done', tasks: [], report: { done: ['Fixed the parser', 'Tests pass'], left: [] }, tests: { command: 'pnpm test', ok: true, at: 1 } },
  ],
  live: [
    { sessionId: 'aaaa-1111', cwd: '/r/app/ext', file: '/r/app/ext/src/hub.ts', fileAt: 1_000_000 },
  ],
  ...over,
})

test('peers are the other live chats of the same project', () => {
  expect(peersOf(state() as never, ME, '/r/app').map(p => p.sessionId)).toEqual(['aaaa-1111', 'bbbb-2222'])
})

test('targets match by name, id or id prefix, and say what did not match', () => {
  const peers = peersOf(state() as never, ME, '/r/app')
  expect(matchTargets(peers, ['Hub Engineer', 'bbbb']).ids).toEqual(['aaaa-1111', 'bbbb-2222'])
  expect(matchTargets(peers, ['bbbb-2222']).ids).toEqual(['bbbb-2222'])
  expect(matchTargets(peers, ['nobody']).missing).toEqual(['nobody'])
  // Too short a prefix matches nothing.
  expect(matchTargets(peers, ['b']).missing).toEqual(['b'])
})

test('decides finished, clean and needs-you', () => {
  expect(outcomeOf({ state: 'working', tasks: [] } as never)).toEqual({ finished: false, clean: false })
  expect(outcomeOf({ state: 'done', tasks: [] } as never)).toEqual({ finished: true, clean: true })
  expect(outcomeOf({ state: 'done', tasks: [], tests: { ok: false } } as never)).toEqual({ finished: true, clean: false })
  expect(outcomeOf({ state: 'needs-you', tasks: [] } as never)).toEqual({ finished: true, clean: false })
  // Idle before any work is not finished; idle after work is.
  expect(outcomeOf({ state: 'idle', tasks: [] } as never)).toEqual({ finished: false, clean: false })
  expect(outcomeOf({ state: 'idle', tasks: [{ status: 'completed' }] } as never)).toEqual({ finished: true, clean: true })
  // Gone from progress: ended with nothing to read.
  expect(outcomeOf(undefined)).toEqual({ finished: true, clean: false })
})

test('an edit clashes with a live chat that edited the same file lately, not with a done one or an old edit', () => {
  const s = state() as never
  expect(editClash(s, ME, '/r/app', '/r/app/ext/src/hub.ts', 1_060_000)?.sessionId).toBe('aaaa-1111')
  expect(editClash(s, ME, '/r/app', '/r/app/ext/src/other.ts', 1_060_000)).toBeUndefined()
  // Past the hub's ten minutes.
  expect(editClash(s, ME, '/r/app', '/r/app/ext/src/hub.ts', 1_000_000 + 600_000)).toBeUndefined()
  // This chat edited it after them.
  expect(editClash(s, ME, '/r/app', '/r/app/ext/src/hub.ts', 1_060_000, 1_050_000)).toBeUndefined()
  const done = state({ progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'done', tasks: [] }] }) as never
  expect(editClash(done, ME, '/r/app', '/r/app/ext/src/hub.ts', 1_060_000)).toBeUndefined()
})

// A fake engine: one Switchboard window holding /r, and a hub that answers from `hub`.
function fakeEngine(hub: { states: unknown[]; posts: Record<string, unknown>[]; now?: number[]; onPost?: (b: Record<string, unknown>) => void }) {
  let t = 0
  const nows = hub.now ?? [1_060_000]
  const kept: Record<string, unknown> = {}
  const $ = {
    store: { get: async (k: string) => kept[k], set: async (k: string, v: unknown) => { kept[k] = v } },
    env: { get: async () => '/u' },
    session: { id: async () => ME, cwd: async () => '/r/app' },
    clock: { now: async () => nows[Math.min(t++, nows.length - 1)] },
    fs: {
      list: async () => [{ name: 'w.json', kind: 'file' }],
      read: async () => JSON.stringify({ port: 9, workspace: '/r', hubToken: 'tok' }),
    },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    http: {
      fetch: async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
        if (init?.method === 'POST') {
          hub.posts.push(JSON.parse(init.body ?? '{}'))
          hub.onPost?.(hub.posts.at(-1)!)
          // The hub does not know link yet.
          return { status: 400, ok: false, text: '' }
        }
        expect(url).toBe('http://127.0.0.1:9/hub/state')
        expect(init?.headers?.['X-Switchboard-Token']).toBe('tok')
        const s = hub.states.length > 1 ? hub.states.shift() : hub.states[0]
        return { status: 200, ok: true, text: JSON.stringify(s) }
      },
    },
  }
  return $ as unknown as EngineInterface
}

test('chats_check lists peers with AI, state, task, file and last report line', async () => {
  resetCache()
  const text = await checkText(fakeEngine({ states: [state()], posts: [] }))
  expect(text).toContain('hub engineer (aaaa-111')
  expect(text).toContain('working')
  expect(text).toContain('Add link kind')
  expect(text).toContain('/r/app/ext/src/hub.ts')
  expect(text).toContain('codex')
  expect(text).toContain('Tests pass')
  expect(text).not.toContain('other repo')
})

test('chats_wait posts a link, returns at once when clean, and ends the link', async () => {
  resetCache()
  const hub = { states: [state()], posts: [] as Record<string, unknown>[] }
  const text = await waitStep(fakeEngine(hub), { chats: ['codex fixer'], reason: 'needs the parser' })
  expect(hub.posts[0]).toMatchObject({ token: 'tok', kind: 'link', from: ME, to: ['bbbb-2222'], reason: 'needs the parser', auto: false })
  expect(typeof hub.posts[0].since).toBe('number')
  expect(hub.posts.at(-1)).toMatchObject({ kind: 'link-end', from: ME, to: ['bbbb-2222'] })
  expect(text).toContain('Fixed the parser')
  expect(text).toContain('Continue on your own')
})

test('chats_wait polls until the target finishes, and says stop when it needs Kenneth', async () => {
  resetCache()
  const needs = state({ progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'needs-you', tasks: [], question: 'Which port?' }] })
  const hub = { states: [state(), state(), needs], posts: [] as Record<string, unknown>[], now: [0, 0, 5_000, 10_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'same file' })
  expect(text).toContain('needs-you')
  expect(text).toContain('Stop and ask Kenneth')
  expect(hub.posts.at(-1)).toMatchObject({ kind: 'link-end' })
})

test('chats_wait gives up the step after its bound and keeps the link', async () => {
  resetCache()
  const hub = { states: [state()], posts: [] as Record<string, unknown>[], now: [0, 0, 100_000, 300_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['hub engineer'], reason: 'x' })
  expect(text).toContain('Call chats_wait again')
  expect(hub.posts.some(p => p.kind === 'link-end')).toBe(false)
})

test('chats_wait with an unknown chat names the live ones', async () => {
  resetCache()
  const text = await waitStep(fakeEngine({ states: [state()], posts: [] }), { chats: ['ghost'], reason: 'x' })
  expect(text).toContain('ghost')
  expect(text).toContain('hub engineer')
})

test('an edit to a file a live chat is editing is denied once with a link posted', async () => {
  resetCache()
  const hub = { states: [state()], posts: [] as Record<string, unknown>[] }
  const $ = fakeEngine(hub)
  const why = await editDenial($, '/r/app/ext/src/hub.ts')
  expect(why).toContain('chats_wait')
  expect(why).toContain('hub engineer')
  expect(hub.posts[0]).toMatchObject({ kind: 'link', from: ME, to: ['aaaa-1111'], auto: true, reason: '/r/app/ext/src/hub.ts' })
  // A retry goes through, so it never deadlocks.
  expect(await editDenial($, '/r/app/ext/src/hub.ts')).toBeUndefined()
  expect(await editDenial($, '/r/app/README.md')).toBeUndefined()
})

test('no Switchboard window: nothing is denied and check says so', async () => {
  resetCache()
  const $ = { ...fakeEngine({ states: [state()], posts: [] }), fs: { list: async () => [], read: async () => '' } } as unknown as EngineInterface
  expect(await editDenial($, '/r/app/ext/src/hub.ts')).toBeUndefined()
  expect(await checkText($)).toContain('No Switchboard window')
})

const myLink = (to: string[]) => ({ from: ME, to, reason: 'x', auto: false, since: 0 })

const unlinked = (to: string) => ({ unlinks: [{ from: ME, to, at: 1_000 }] })

test('a link gone from the hub is not an unlink: a reload or an ended target keeps the wait', async () => {
  resetCache()
  const hub = { states: [state(), state({ links: [myLink(['aaaa-1111'])] }), state({ links: [] }), state({ links: [], chats: [] })], posts: [] as Record<string, unknown>[], now: [0, 0, 100_000, 300_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })
  expect(text).not.toContain('Kenneth removed')
  expect(text).toContain('Call chats_wait again')
})

test('an explicit unlink in Switchboard ends the wait, and the next chats_wait does not post it again', async () => {
  resetCache()
  const hub = { states: [state(), state({ links: [myLink(['aaaa-1111'])] }), state(unlinked('aaaa-1111'))], posts: [] as Record<string, unknown>[], now: [...Array.from({ length: 20 }, (_, i) => i * 1_000), 300_000] }
  const $ = fakeEngine(hub)
  expect(await waitStep($, { chats: ['aaaa'], reason: 'x' })).toContain('Kenneth removed this wait in Switchboard')
  const links = hub.posts.filter(p => p.kind === 'link').length
  expect(await waitStep($, { chats: ['aaaa'], reason: 'x' })).toContain('Kenneth removed this wait')
  expect(hub.posts.filter(p => p.kind === 'link').length).toBe(links)
})

test('an unlink of one target keeps waiting on the others', async () => {
  resetCache()
  const needs = state({ progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'working', tasks: [] }, { sessionId: 'bbbb-2222', cwd: '/r/app', state: 'working', tasks: [] }] })
  const gone = state({ ...unlinked('aaaa-1111'), progress: needs.progress })
  const done = state({ ...unlinked('aaaa-1111'), progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'working', tasks: [] }, { sessionId: 'bbbb-2222', cwd: '/r/app', state: 'done', tasks: [] }] })
  const hub = { states: [needs, gone, done], posts: [] as Record<string, unknown>[], now: [...Array.from({ length: 20 }, (_, i) => i * 1_000), 300_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa', 'bbbb'], reason: 'x' })
  expect(text).toContain('Finished')
  expect(text).not.toContain('hub engineer')
  expect(hub.posts.at(-1)).toMatchObject({ kind: 'link-end', to: ['bbbb-2222'] })
})

test('a usage-limited or paused target is still working', async () => {
  const limited = { sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'needs-you', tasks: [], question: 'Usage limit', limited: { at: 1, error: 'rate_limit' } }
  expect(outcomeOf(limited as never).finished).toBe(false)
  resetCache()
  const hub = { states: [state({ progress: [limited] })], posts: [] as Record<string, unknown>[], now: [0, 0, 100_000, 300_000] }
  expect(await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
  resetCache()
  const paused = state({ progress: [{ ...limited, limited: undefined }], pause: { chats: [{ sessionId: 'aaaa-1111' }] } })
  const hub2 = { states: [paused], posts: [] as Record<string, unknown>[], now: [0, 0, 100_000, 300_000] }
  expect(await waitStep(fakeEngine(hub2), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
})

test('a live target with no progress yet, as after a window reload, is still working', async () => {
  resetCache()
  const hub = { states: [state({ progress: [] })], posts: [] as Record<string, unknown>[], now: [0, 0, 100_000, 300_000] }
  expect(await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
})

test('a live target that never posts progress counts as ended after ten minutes of waiting', async () => {
  resetCache()
  const quiet = state({ progress: [] })
  expect(await waitStep(fakeEngine({ states: [quiet], posts: [], now: [0, 0, 100_000, 300_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
  expect(await waitStep(fakeEngine({ states: [quiet], posts: [], now: [900_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('AskUserQuestion')
})

test('QA: a reload late in a long wait still waits', async () => {
  resetCache()
  expect(await waitStep(fakeEngine({ states: [state()], posts: [], now: [0, 0, 100_000, 300_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
  expect(await waitStep(fakeEngine({ states: [state({ progress: [] })], posts: [], now: [900_000, 900_000, 905_000, 1_200_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
})
test('QA: since from an unlinked wait does not leak into a later wait', async () => {
  resetCache()
  const quiet = state({ progress: [] }), unl = state({ progress: [], unlinks: [{ from: ME, to: 'aaaa-1111' }] })
  expect(await waitStep(fakeEngine({ states: [quiet, unl], posts: [], now: [0, 0, 5_000, 10_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('removed')
  expect(await waitStep(fakeEngine({ states: [quiet], posts: [], now: [900_000, 900_000, 905_000, 1_200_000] }), { chats: ['aaaa'], reason: 'x' })).toContain('Call chats_wait again')
})

test('a handoff that moves the wait onto a chat waiting on this one is refused', async () => {
  resetCache()
  const chats = state().chats.map(c => (c.sessionId === 'aaaa-1111' ? { ...c, chain: 'k1', live: false } : c)).concat({ sessionId: 'eeee-5555', name: 'hub engineer v2', cwd: '/r/app/ext', project: 'app', live: true, ai: 'claude', chain: 'k1' })
  const start = state().chats.map(c => (c.sessionId === 'aaaa-1111' ? { ...c, chain: 'k1' } : c))
  const moved = state({ chats, links: [{ from: 'eeee-5555', to: [ME], reason: 'x', auto: false, since: 0 }] })
  const hub = { states: [state({ chats: start }), state({ chats: start }), moved], posts: [] as Record<string, unknown>[], now: [...Array.from({ length: 20 }, (_, i) => i * 1_000), 300_000] }
  expect(await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })).toContain('already waits on this chat')
})

test('a handed-off target is followed to its next chat', async () => {
  resetCache()
  const chats = state().chats.map(c => (c.sessionId === 'aaaa-1111' ? { ...c, chain: 'k1' } : c))
  const handing = state({ chats, waits: [{ sessionId: 'aaaa-1111', tasks: 1, next: 'v2', since: 0 }], progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'done', tasks: [] }] })
  const moved = chats.map(c => (c.sessionId === 'aaaa-1111' ? { ...c, live: false } : c)).concat({ sessionId: 'eeee-5555', name: 'hub engineer v2', cwd: '/r/app/ext', project: 'app', live: true, ai: 'claude', chain: 'k1' })
  const working = state({ chats: moved, progress: [{ sessionId: 'eeee-5555', cwd: '/r/app/ext', state: 'working', tasks: [] }] })
  const done = state({ chats: moved, progress: [{ sessionId: 'eeee-5555', cwd: '/r/app/ext', state: 'done', tasks: [], report: { done: ['Link kind added'], left: [] } }] })
  const hub = { states: [handing, handing, working, done], posts: [] as Record<string, unknown>[], now: [...Array.from({ length: 20 }, (_, i) => i * 1_000), 300_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })
  expect(text).toContain('hub engineer v2')
  expect(text).toContain('Link kind added')
  expect(text).toContain('Continue on your own')
})

test('a target that needs Kenneth says to ask him with AskUserQuestion', async () => {
  resetCache()
  const hub = { states: [state({ progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'done', tasks: [], tests: { ok: false, command: 'pnpm test' } }] })], posts: [] as Record<string, unknown>[] }
  expect(await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })).toContain('AskUserQuestion')
})

test('chats_wait refuses a wait that closes a cycle', async () => {
  resetCache()
  const hub = { states: [state({ links: [{ from: 'aaaa-1111', to: ['bbbb-2222'], reason: 'x', auto: false, since: 0 }, { from: 'bbbb-2222', to: [ME], reason: 'x', auto: false, since: 0 }] })], posts: [] as Record<string, unknown>[] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa'], reason: 'x' })
  expect(text).toContain('already waits on this chat')
  expect(hub.posts.length).toBe(0)
  expect(waitsOn([myLink(['a'])], ME, 'a')).toBe(true)
  expect(waitsOn(undefined, ME, 'a')).toBe(false)
})

test('a lead whose turn ended with subagents or background shells is still working', () => {
  const busy = (o: Record<string, unknown>) => outcomeOf({ state: 'idle', tasks: [{ status: 'completed' }], ...o } as never)
  expect(busy({}).finished).toBe(true)
  expect(busy({ running: ['a'] }).finished).toBe(false)
  expect(busy({ waiting: true }).finished).toBe(false)
  expect(busy({ jobs: [{ id: 'j' }] }).finished).toBe(false)
  // Sub-shells go stale once their subagent stops, and open tasks on an idle chat do not hold it.
  expect(busy({ subJobs: [{ id: 'j' }] }).finished).toBe(true)
  expect(busy({ tasks: [{ status: 'pending' }] }).finished).toBe(true)
  expect(busy({ tasks: [{ status: 'in_progress' }] }).finished).toBe(true)
  expect(outcomeOf({ state: 'done', tasks: [{ status: 'pending' }], running: ['a'] } as never)).toEqual({ finished: true, clean: true })
})

test('a target at its Approve question is finished and clean unless its tests fail', () => {
  const ask = (o: Record<string, unknown> = {}) => outcomeOf({ state: 'needs-you', tasks: [], question: 'Approve this chat as finished?', ...o } as never)
  expect(ask()).toEqual({ finished: true, clean: true })
  expect(ask({ tests: { ok: false } })).toEqual({ finished: true, clean: false })
  expect(ask({ question: 'Which port?' })).toEqual({ finished: true, clean: false })
})

test('chats_wait counts an approved archived target as finished clean, with no progress or row', async () => {
  resetCache()
  const live = state({ chats: [...state().chats, { sessionId: 'zzzz-9999', name: 'old', cwd: '/r/app', project: 'app', live: true }], progress: [], archive: [{ sessionId: 'zzzz-9999', approvedAt: 5 }] })
  const hub = { states: [live], posts: [] as Record<string, unknown>[] }
  const text = await waitStep(fakeEngine(hub), { chats: ['zzzz-9999'], reason: 'x' })
  expect(text).toContain('Continue on your own')
})

const myLinkAuto = (to: string[], auto = false) => ({ from: ME, to, reason: 'x', auto, since: 0 })
const stopState = (over: Record<string, unknown> = {}) => state({ links: [myLinkAuto(['aaaa-1111'])], ...over })

test('stop is blocked while a waited-on chat still works, and names it', async () => {
  resetCache()
  const why = await stopReason(fakeEngine({ states: [stopState()], posts: [] }), false)
  expect(why).toContain('hub engineer')
  expect(why).toContain('still working')
  expect(why).toContain('chats_wait')
  expect(why).toContain('aaaa-1111')
})

test('stop with every target finished is blocked once to read the report', async () => {
  resetCache()
  const hub = { states: [stopState({ links: [myLinkAuto(['bbbb-2222'])] })], posts: [] as Record<string, unknown>[] }
  const why = await stopReason(fakeEngine(hub), false)
  expect(why).toContain('Finished:')
  expect(why).toContain('Fixed the parser')
  expect(why).not.toContain('chats_wait')
  expect(hub.posts.at(-1)).toMatchObject({ kind: 'link-end', from: ME, to: ['bbbb-2222'] })
})

// The hub drops a link once link-end arrives; a second stop must not block.
async function stopsOnce(s: Record<string, unknown>, stored: string[]) {
  resetCache()
  const hub = { states: [s], posts: [] as Record<string, unknown>[], onPost: (b: Record<string, unknown>) => { if (b.kind === 'link-end') hub.states[0] = { ...(hub.states[0] as object), links: [] } } }
  const $ = fakeEngine(hub)
  const why = await stopReason($, false)
  expect(why).toContain('Finished:')
  expect(hub.posts.filter(p => p.kind === 'link-end')).toEqual([expect.objectContaining({ from: ME, to: stored })])
  expect(await stopReason($, true)).toBeUndefined()
}

test('an ended target ends the link with its stored ids and blocks once', async () => {
  await stopsOnce(stopState({ links: [myLinkAuto(['dddd-4444'])] }) as never, ['dddd-4444'])
  await stopsOnce(stopState({ links: [myLinkAuto(['dddd-4444'])], archive: [{ sessionId: 'dddd-4444', approvedAt: 5 }] }) as never, ['dddd-4444'])
})

test('a handed-off target ends the link with the old stored id', async () => {
  const chats = [...state().chats.map(c => c.sessionId === 'dddd-4444' ? { ...c, chain: 'c1' } : c), { sessionId: 'eeee-5555', name: 'next', cwd: '/r/app', project: 'app', live: true, chain: 'c1' }]
  const progress = [{ sessionId: 'eeee-5555', cwd: '/r/app', state: 'done', tasks: [], report: { done: ['Moved on'], left: [] } }]
  await stopsOnce(stopState({ chats, progress, links: [myLinkAuto(['dddd-4444'])] }) as never, ['dddd-4444'])
})

test('stop is never blocked for an auto link, no link, pause, a usage limit or an unreadable hub', async () => {
  resetCache()
  expect(await stopReason(fakeEngine({ states: [state()], posts: [] }), false)).toBeUndefined()
  resetCache()
  expect(await stopReason(fakeEngine({ states: [state({ links: [myLinkAuto(['aaaa-1111'], true)] })], posts: [] }), false)).toBeUndefined()
  resetCache()
  expect(await stopReason(fakeEngine({ states: [stopState({ pause: { chats: [{ sessionId: ME }] } })], posts: [] }), false)).toBeUndefined()
  resetCache()
  const limited = stopState({ progress: [{ sessionId: ME, cwd: '/r/app', state: 'idle', tasks: [], limited: { at: 1, error: 'x' } }] })
  expect(await stopReason(fakeEngine({ states: [limited], posts: [] }), false)).toBeUndefined()
  resetCache()
  const dead = { ...fakeEngine({ states: [], posts: [] }), fs: { list: async () => [], read: async () => '' } } as unknown as EngineInterface
  expect(await stopReason(dead, false)).toBeUndefined()
})

test('stop blocks at most MAX_BLOCKS times in a row', async () => {
  resetCache()
  const $ = fakeEngine({ states: [stopState()], posts: [] })
  expect(MAX_BLOCKS).toBeGreaterThan(30)
  expect(await stopReason($, false)).toMatch(/^You are waiting on/)
  for (let i = 1; i < MAX_BLOCKS; i++) expect(await stopReason($, true)).toMatch(/^You are waiting on/)
  expect(await stopReason($, true)).toBeUndefined()
  expect(await stopReason($, false)).toMatch(/^You are waiting on/)
})
