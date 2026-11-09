import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { checkText, editClash, editDenial, matchTargets, outcomeOf, peersOf, resetCache, waitStep, waitsOn } from '../hooks/register.ts'

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
function fakeEngine(hub: { states: unknown[]; posts: Record<string, unknown>[]; now?: number[] }) {
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

test('an unlink in Switchboard ends the wait, and the next chats_wait does not post it again', async () => {
  resetCache()
  const hub = { states: [state(), state({ links: [myLink(['aaaa-1111'])] }), state({ links: [] })], posts: [] as Record<string, unknown>[], now: [0, 0, 1_000, 2_000, 3_000, 4_000] }
  const $ = fakeEngine(hub)
  expect(await waitStep($, { chats: ['aaaa'], reason: 'x' })).toContain('Kenneth removed this wait in Switchboard')
  const links = hub.posts.filter(p => p.kind === 'link').length
  expect(await waitStep($, { chats: ['aaaa'], reason: 'x' })).toContain('Kenneth removed this wait')
  expect(hub.posts.filter(p => p.kind === 'link').length).toBe(links)
})

test('an unlink of one target keeps waiting on the others', async () => {
  resetCache()
  const needs = state({ links: [myLink(['bbbb-2222'])], progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'working', tasks: [] }, { sessionId: 'bbbb-2222', cwd: '/r/app', state: 'working', tasks: [] }] })
  const done = state({ links: [myLink(['bbbb-2222'])], progress: [{ sessionId: 'aaaa-1111', cwd: '/r/app/ext', state: 'working', tasks: [] }] })
  const both = state({ links: [myLink(['aaaa-1111', 'bbbb-2222'])], progress: needs.progress })
  const hub = { states: [needs, both, needs, done], posts: [] as Record<string, unknown>[], now: [0, 0, 1_000, 2_000, 3_000, 4_000] }
  const text = await waitStep(fakeEngine(hub), { chats: ['aaaa', 'bbbb'], reason: 'x' })
  expect(text).toContain('Finished')
  expect(text).not.toContain('hub engineer')
  expect(hub.posts.at(-1)).toMatchObject({ kind: 'link-end', to: ['bbbb-2222'] })
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
