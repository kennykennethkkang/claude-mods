import { expect, test } from 'claude-code/testing'
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'

import { branchFor, budgetDenial, creditsIn, deliver, poll, dietOf, endsAsking, ensureOpenTasks, handoffDenial, handoffNote, homeOf, jevRun, heldNow, holdDenial, holdLine, holdTick, hubHold, overLimit, untilText, liveShells, maybeHandoff, nearFull, norm, notePlan, noteShell, noteTasks, ownerOf, pausedDenial, redact, restoreFeed, roleModel, shellsDone, summaryOf, targetsOf } from '../hooks/register.ts'

test('reports to every Switchboard window, whatever folder it has open', () => {
  const files = [
    { port: 1, hubToken: 'a', workspace: '/Users/k/Documents/GitHub' },
    { port: 2, hubToken: 'b', workspace: '/Users/k/Documents/GitHub/Armasu' },
    // Agent Flow without Switchboard: no hub token, nothing to report to.
    { port: 3, workspace: '/Users/k/Documents/GitHub/Armasu' },
    { port: 'x', hubToken: 'd', workspace: '/Users/k/Documents/GitHub/Arma' },
  ]
  expect(targetsOf(files).map(t => t.port)).toEqual([1, 2])
  expect(norm('C:\\Users\\k\\proj\\')).toBe('C:/Users/k/proj')
})

test('reads a Jev run from its summary line', () => {
  const run = jevRun('python3 jev.py ask --preset armasu-copy-check --input x.json', 'noise\n[jev] 40 items · 2.1s wall · 0.31s mean latency · $0.0040 · 0 errors · sure 38 / unsure 2\n')
  expect(run).toEqual({ preset: 'armasu-copy-check', items: 40, seconds: 2.1, costUsd: 0.004, errors: 0, sure: 38, unsure: 2 })
  expect(jevRun('jev.py ask --preset=x', '[jev] 3 items · 0.4s wall · 0.1s mean latency · $0.0003 · 1 errors')).toEqual({ preset: 'x', items: 3, seconds: 0.4, costUsd: 0.0003, errors: 1 })
  expect(jevRun('ls', 'nothing here')).toBeUndefined()
})

test('names owners and ranks the diet, listing plugins never used', () => {
  expect(ownerOf('mcp__plugin_bland_bland__create_call')).toBe('bland')
  expect(ownerOf('mcp__openrouter__send-message')).toBe('openrouter')
  const b = {
    totalTokens: 76_400,
    categories: [{ name: 'Skills', tokens: 9_900, kind: 'used', color: '', isDeferred: false }, { name: 'Free space', tokens: 9e5, kind: 'free', color: '', isDeferred: false }],
    skills: { totalSkills: 2, includedSkills: 2, tokens: 300, skillFrontmatter: [
      { name: 'aws-core:aws-security', source: 'plugin', pluginName: 'aws-core', tokens: 250 },
      { name: 'superpowers:writing-plans', source: 'plugin', pluginName: 'superpowers', tokens: 50 },
    ] },
    mcpTools: [{ name: 'mcp__plugin_bland_bland__create_call', serverName: 'plugin_bland_bland', tokens: 474, isLoaded: false }],
    memoryFiles: [{ path: '/x/memory/MEMORY.md', type: 'AutoMem', tokens: 3_300 }],
  } as unknown as SessionContextBreakdown
  const diet = dietOf(b, { superpowers: 2 })
  expect(diet.total).toBe(76_400)
  expect(diet.rows[0]).toEqual({ label: 'Skills', tokens: 9_900 })
  expect(diet.rows.some(r => r.label === 'memory: MEMORY.md')).toBe(true)
  expect(diet.unused).toEqual(['aws-core', 'bland'])
})

test('posts this chat to Switchboard with its token', async ($, on) => {
  const posts: string[] = []
  on('env.get', () => ({ value: '/Users/k' }))
  on('session.cwd', () => ({ value: '/Users/k/Documents/GitHub/Armasu' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { context: { tokens: 82_000, window: 1_000_000, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 41 }], startedAt: 0 } }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [
    { name: 'abc-123.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    { name: 'def-456.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
  ] }))
  on('fs.read', (_, e) => ({ value: JSON.stringify(String(e.path).endsWith('abc-123.json')
    ? { port: 61712, pid: 1, workspace: '/Users/k/Documents/GitHub/Armasu', hubToken: 'tok' }
    : { port: 61713, pid: 2, workspace: '/Users/k/Documents/GitHub/Gemini-Test', hubToken: 'tok2' }) }))
  on('http.fetch', (_, e) => {
    posts.push(`${e.url} ${e.init?.body ?? ''}`)
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/k/Documents/GitHub/Armasu', surface: 'terminal', isInteractive: true })
  const live = posts.filter(p => p.includes('"kind":"live"'))
  expect(live.length).toBe(2)
  expect(live[0]).toContain('http://127.0.0.1:61712/hub')
  expect(live[0]).toContain('"token":"tok"')
  expect(live[0]).toContain('"sessionId":"chat-1"')
  // The other window, with its own token, so Talk works from there too.
  expect(live[1]).toContain('http://127.0.0.1:61713/hub')
  expect(live[1]).toContain('"token":"tok2"')
})

test('an inbox item for Remote Control runs its command', async ($, on) => {
  const commands: string[] = []
  on('command.run', (_, e) => { commands.push(e.command); return { text: '' } })
  // A compaction needs the chat's own messages, which only a live session has; checked end to end instead.
  await deliver($ as unknown as EngineInterface, [{ id: 'i2', kind: 'rc' }])
  expect(commands).toEqual(['remote-control'])
})

test('an inbox message becomes this chat\'s next prompt and tells every window, so the one holding its terminal shows it', async () => {
  const posts: string[] = []
  const prompts: string[] = []
  const $ = {
    prompt: { submit: async ({ text }: { text: string }) => { prompts.push(text); return {} } },
    env: { get: async () => '/u' },
    session: { id: async () => 'chat-1' },
    clock: { now: async () => 9.9e12 },
    fs: {
      list: async () => [{ name: 'a-1.json', kind: 'file' }, { name: 'b-2.json', kind: 'file' }],
      read: async (p: string) => JSON.stringify({ port: p.endsWith('a-1.json') ? 1 : 2, workspace: '/u', hubToken: 't' }),
    },
    http: { fetch: async (url: string, init: { body: string }) => { posts.push(`${url} ${init.body}`); return { status: 204, ok: true } } },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'i1', kind: 'prompt', text: 'run the tests' }])
  expect(prompts).toEqual(['run the tests'])
  expect(posts.filter(p => p.includes('"kind":"prompted"') && p.includes('"sessionId":"chat-1"')).length).toBe(2)
})

test('reads the OpenRouter balance wherever it is printed', () => {
  expect(creditsIn('key:        present\ncredits:    $4.21 left  (bought $10.00, used $5.79)\n')).toBe(4.21)
  expect(Math.round((creditsIn('{"data":{"total_credits":10,"total_usage":5.79}}') ?? 0) * 100) / 100).toBe(4.21)
  expect(creditsIn('credits:    could not read (timeout)')).toBeUndefined()
})

const PLAN = `# Switchboard Implementation Plan

## Decisions

| Question | Pick | Source |
|----------|------|--------|
| Timeline | T1 docked drawer | examples page |
| Build | approved for build at 09:59 | design page |

### Task 6: Timeline

- [x] **Step 1:** ticks
- [x] **Step 2:** drawer

### Task 16: When the context fills

- [x] **Step 1:** note
- [ ] **Step 2:** compact mode
- [ ] **Step 3:** fresh chat mode

### Task 17: Verify and record

- [ ] **Step 1:** two windows
`

test('a handoff note keeps the plan, open tasks, decisions and branch', () => {
  const note = handoffNote({ project: 'Armasu', cwd: '/u/Armasu', branch: 'Social-media-dev', planPath: '/u/Armasu/docs/superpowers/plans/2026-10-23-switchboard.md', planText: PLAN, session: 'abcdef123456', now: Date.parse('2026-10-23T10:15:00Z') })
  expect(note).toContain('Branch: Social-media-dev')
  expect(note).toContain('2026-10-23-switchboard.md')
  expect(note).toContain('Task 16: When the context fills (1 of 3 steps done)')
  expect(note).toContain('Task 17: Verify and record (0 of 1 steps done)')
  expect(note.includes('Task 6: Timeline')).toBe(false)
  expect(note).toContain('| Build | approved for build at 09:59 | design page |')
})

test('a handoff note never carries anything shaped like a secret', () => {
  const leaky = [
    'key sk-or-v1-0123456789abcdef0123456789abcdef', 'aws AKIAABCDEFGHIJKLMNOP', 'gh ghp_0123456789abcdefghij0123456789ABCD',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlX3ZhbHVl', 'hex 0123456789abcdef0123456789abcdef01234567',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----', 'slack xoxb-1234-5678-abcdefghijkl',
  ].join('\n')
  const clean = redact(leaky)
  for (const bad of ['sk-or-v1-0123', 'AKIAABCDEFGH', 'ghp_0123', 'eyJhbGci', '0123456789abcdef0123456789abcdef', 'b3BlbnNzaC1rZXk', 'xoxb-1234']) expect(clean.includes(bad)).toBe(false)
  expect(clean).toContain('[removed]')
  expect(redact('Task 16: commit abc1234 on Social-media-dev')).toBe('Task 16: commit abc1234 on Social-media-dev')
})

test('a fresh chat branch is named from the task in progress', () => {
  expect(branchFor('/u/docs/superpowers/plans/2026-10-23-switchboard.md', 'When the context fills')).toBe('claude/switchboard-when-context-fills')
  expect(branchFor(undefined, undefined, new Date('2026-10-23T12:00:00'))).toBe('claude/continue-1023')
})

test('only the window holding the chat opens the fresh chat, the deepest one', () => {
  const ts = [{ port: 1, token: 'a', workspace: '/u/GitHub' }, { port: 2, token: 'b', workspace: '/u/GitHub/Armasu' }]
  expect(homeOf(ts, '/u/GitHub/Armasu/app')?.port).toBe(2)
  expect(homeOf(ts, '/elsewhere')).toBeUndefined()
  expect(nearFull(151_000, 167_000)).toBe(true)
  expect(nearFull(100_000, 167_000)).toBe(false)
  expect(nearFull(100_000, undefined)).toBe(false)
})

test('puts each role on its model and leaves other agents alone', () => {
  expect(roleModel('engineer')).toBe('opus')
  expect(roleModel('general-purpose')).toBe('opus')
  expect(roleModel('Explore')).toBe('haiku')
  expect(roleModel('researcher')).toBe('haiku')
  expect(roleModel('growth')).toBe('sonnet')
  expect(roleModel('bland:norm')).toBeUndefined()
})

test('holds a role past its budget for the day', () => {
  expect(budgetDenial('engineer', { engineer: 30 }, { engineer: 30 })).toMatch(/engineer has used its 30/)
  expect(budgetDenial('engineer', { engineer: 29 }, { engineer: 30 })).toBeUndefined()
  expect(budgetDenial('bland:norm', {}, { engineer: 30 })).toBeUndefined()
})

test('lets a paused chat read and nothing else', () => {
  expect(pausedDenial('Read', true)).toBeUndefined()
  expect(pausedDenial('Grep', true)).toBeUndefined()
  expect(pausedDenial('Bash', true)).toMatch(/paused/)
  expect(pausedDenial('Bash', false)).toBeUndefined()
})

test('delivers close and handoff', async () => {
  const ran: string[] = []
  const $ = { command: { run: async ({ command }: { command: string }) => { ran.push(command) } } } as unknown as EngineInterface
  await deliver($, [{ id: '1', kind: 'close' }])
  expect(ran).toEqual(['exit'])
})

test('a handoff item writes the note and tells the hub, whatever the context', async () => {
  const posts: string[] = []
  const written: string[] = []
  const notes: string[] = []
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-handoff', usage: async () => ({ context: { tokens: 1_000 } }) },
    clock: { now: async () => 9.5e12 },
    fs: {
      // The plan changed last, not the last name in the folder.
      list: async (dir: string) => (dir.includes('plans')
        ? [{ name: '2026-10-23-switchboard.md', kind: 'file', mtimeMs: 2 }, { name: 'p4-map.md', kind: 'file', mtimeMs: 1 }]
        : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string, note: string) => { written.push(path); notes.push(note) },
    },
    http: { fetch: async (url: string, init?: { body?: string }) => {
      posts.push(`${url} ${init?.body ?? ''}`)
      return { status: 200, ok: true, text: url.includes('/hub/keep') ? '{"onFull":"compact"}' : '' }
    } },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(written.length).toBe(1)
  expect(written[0]).toBe(`/u/.claude/handoffs/Armasu/${new Date(9.5e12).toISOString().slice(0, 10)}-${new Date(9.5e12).toISOString().slice(11, 16).replace(':', '')}-armasu-switchboard-chat-han.md`)
  expect(notes[0]).toContain('2026-10-23-switchboard.md')
  expect(posts.some(p => p.includes('"kind":"handoff"') && p.includes('"sessionId":"chat-handoff"') && p.includes('"plan":"/u/Armasu/docs/superpowers/plans/2026-10-23-switchboard.md"'))).toBe(true)
})

test('a handoff with no plan or task is named continued, and tells the hub no plan', async () => {
  const written: string[] = []
  const posts: string[] = []
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu/My Proj', id: async () => '602f6c02-aaaa', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => Date.parse('2026-10-27T20:03:00Z') },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async (url: string, init?: { body?: string }) => { posts.push(init?.body ?? ''); return { status: 200, ok: true, text: '{}' } } },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(written).toEqual(['/u/.claude/handoffs/My Proj/2026-10-27-2003-my-proj-continued-602f6c02.md'])
  expect(posts.find(p => p.includes('"kind":"handoff"'))).not.toContain('"plan"')
})

test('a paused chat cannot ask the hub, which is a paid call', async ($, on) => {
  const asked: string[] = []
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9e12 }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('company.json') ? '{"paused":true}' : '' }))
  on('http.fetch', (_, e) => { asked.push(e.url); return { value: { status: 200, ok: true, headers: {}, text: 'answer' } } })
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'mcp__usage-meter__hub_ask', question: 'who is on what?' })
  expect(JSON.stringify(ran)).toContain('Switchboard is paused')
  expect(asked.filter(u => u.includes('/hub/ask'))).toEqual([])
})

test('hub_recall asks the window holding this folder for what memory knows, even while paused, since it is free', async ($, on) => {
  const asked: { url: string; token?: string }[] = []
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9.1e12 }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.id', () => ({ value: 'chat-recall' }))
  on('fs.list', () => ({ value: [{ name: 'w.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : String(e.path).endsWith('company.json') ? '{"paused":true}' : '' }))
  on('http.fetch', (_, e) => { asked.push({ url: e.url, token: (e.init?.headers as Record<string, string> | undefined)?.['X-Switchboard-Token'] }); return { value: { status: 200, ok: true, headers: {}, text: 'hub-recall: how chats query memory' } } })
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'mcp__usage-meter__hub_recall', query: 'hub recall' })
  expect(JSON.stringify(ran)).toContain('hub-recall: how chats query memory')
  const hit = asked.find(a => a.url.includes('/hub/recall'))!
  expect(hit.url).toContain('http://127.0.0.1:7/hub/recall?')
  expect(hit.url).toContain('q=hub%20recall')
  expect(hit.url).not.toContain('token')
  expect(hit.token).toBe('t')
  expect(JSON.stringify(await $.tool.call({ tool: 'mcp__usage-meter__hub_recall', query: ' ' }))).toContain('Give a query')
})

test('an agent start posts the day it counts on, so the hub drops yesterday', async ($, on) => {
  const posts: string[] = []
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-agent' }))
  on('clock.now', () => ({ value: 9.9e12 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'w.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u', hubToken: 't' }) : '' }))
  on('http.fetch', (_, e) => { posts.push(String(e.init?.body ?? '')); return { value: { status: 204, ok: true, headers: {}, text: '' } } })
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'opus' }))
  await $.agent.spawn({ subagentType: 'engineer', prompt: 'x', description: 'x' } as never)
  // Posted off the spawn's path.
  await new Promise(r => setTimeout(r, 20))
  const agent = posts.find(p => p.includes('"kind":"agent"'))
  expect(agent).toContain(`"day":"${new Date(9.9e12).toISOString().slice(0, 10)}"`)
  expect(agent).toContain('"used":{"engineer":1}')
})

test('a handoff names the plan this chat opened, not the one another chat touched last', async () => {
  const notes: string[] = []
  const posts: string[] = []
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-plan', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.6e12 },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [{ name: 'newer.md', kind: 'file', mtimeMs: 9 }] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' })
        : path.endsWith('mine.md') ? '### Task 3: Name the fresh chat\n\n- [ ] **Step 1: x**' : ''),
      write: async (_: string, note: string) => { notes.push(note) },
    },
    http: { fetch: async (url: string, init?: { body?: string }) => { posts.push(init?.body ?? ''); return { status: 200, ok: true, text: '{}' } } },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await restoreFeed($)
  notePlan('/u/Armasu/docs/superpowers/plans/mine.md')
  notePlan('/u/Armasu/app/page.tsx')
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(notes.join('')).toContain('plans/mine.md')
  expect(posts.find(p => p.includes('"kind":"handoff"'))).toContain('"task":"Name the fresh chat"')
})

// A store the harness keeps between calls, seeded with what an earlier hook wrote.
function storeOn(on: (op: never, fn: never) => void, seed: Record<string, unknown> = {}) {
  const kept = new Map(Object.entries(seed))
  on('store.get' as never, ((_: unknown, e: { key: string }) => ({ value: kept.get(e.key) })) as never)
  on('store.set' as never, ((_: unknown, e: { key: string; value: unknown }) => { kept.set(e.key, e.value); return { value: undefined } }) as never)
  return kept
}

test('a near-full chat starts no new tasks; before the handoff, and in other chats, spawns go through', async ($, on) => {
  let id = 'chat-full-1'
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: id }))
  on('clock.now', () => ({ value: 9.9e12 }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  on('http.fetch', () => ({ value: { status: 204, ok: true, headers: {}, text: '' } }))
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'opus' }))
  const kept = storeOn(on as never, { handoffs: { 'chat-other': { note: '/u/.claude/handoffs/x/other.md', at: 1 } } })
  const spawn = () => $.agent.spawn({ subagentType: 'engineer', prompt: 'x', description: 'x' } as never)
  expect(JSON.stringify(await spawn())).not.toContain('Context is nearly full')
  kept.set('handoffs', { ...(kept.get('handoffs') as object), [id]: { note: '/u/.claude/handoffs/x/mine.md', at: 2 } })
  const held = JSON.stringify(await spawn())
  expect(held).toContain('Context is nearly full: no new tasks here.')
  expect(held).toContain('/u/.claude/handoffs/x/mine.md')
  id = 'chat-full-2'
  expect(JSON.stringify(await spawn())).not.toContain('Context is nearly full')
})

test('after the handoff the lead still reads, edits and runs Bash, but starts no background job', async ($, on) => {
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-full-3' }))
  on('clock.now', () => ({ value: 9e12 }))
  on('fs.read', () => ({ value: '' }))
  on('tool.call', () => ({ result: {} }))
  storeOn(on as never, { handoffs: { 'chat-full-3': { note: '/u/n.md', at: 1 } } })
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never))).toContain('Context is nearly full')
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'git status' } as never))).not.toContain('Context is nearly full')
  expect(JSON.stringify(await $.tool.call({ tool: 'Edit', file_path: '/u/a.ts', old_string: 'a', new_string: 'b' } as never))).not.toContain('Context is nearly full')
})

test('the next prompt after the handoff tells the lead to wrap up into the note', async ($, on) => {
  on('session.id', () => ({ value: 'chat-full-4' }))
  const seen: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => { seen.push(e.context); return { text: e.text } })
  const kept = storeOn(on as never)
  await $.prompt.submit({ text: 'keep going' })
  expect(seen[0]).toBeUndefined()
  kept.set('handoffs', { 'chat-full-4': { note: '/u/.claude/handoffs/x/n.md', at: 1 } })
  await $.prompt.submit({ text: 'keep going' })
  const told = (seen[1] ?? []).join('\n')
  expect(told).toContain('/u/.claude/handoffs/x/n.md')
  expect(told).toMatch(/no new tasks/i)
  expect(told).toMatch(/open tasks, decisions, dead ends \(one line each with why\), results/i)
})

test('the denial says where new tasks go', () => {
  expect(handoffDenial('/n.md')).toBe('Context is nearly full: no new tasks here. Running tasks finish, then this work continues in the next chat. Add new tasks to the handoff note instead (/n.md).')
})

test('a handoff note carries the task list, the last ask, running agents and changed files, and no secrets', () => {
  const note = handoffNote({
    project: 'Armasu', cwd: '/u/Armasu', branch: 'main', session: 'abcdef123456', now: Date.parse('2026-10-23T10:15:00Z'),
    tasks: [{ subject: 'Wire the deny', status: 'completed' }, { subject: 'Write the note', status: 'in_progress' }],
    ask: 'Ship it. Key sk-or-v1-0123456789abcdef0123456789abcdef stays out.\nSecond line.',
    running: ['engineer: fix the hook', 'qa: rerun tests'],
    changed: Array.from({ length: 40 }, (_, i) => ` M src/f${i}.ts`),
  })
  expect(note).toMatch(/read this note fully before acting/i)
  expect(note).toContain('1 task done')
  expect(note).toContain('- [ ] Write the note (in progress)')
  expect(note).toContain('Ship it.')
  expect(note).toContain('Second line.')
  expect(note.includes('sk-or-v1-0123')).toBe(false)
  expect(note).toContain('- engineer: fix the hook')
  expect(note).toContain('src/f0.ts')
  // Under budget the list is carried whole.
  expect(note).toContain('src/f39.ts')
})

test('the trigger remembers the note per session and fills it from the task list, live agents and git', async () => {
  const kept = new Map<string, unknown>()
  const notes: string[] = []
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-full-5', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.7e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    agent: { list: async () => [{ id: 'a', type: 'engineer', description: 'fix the hook', status: 'running' }, { id: 'b', type: 'qa', description: 'old run', status: 'completed' }] },
    process: { run: async () => ({ exitCode: 0, stdout: ' M hooks/register.ts\n?? new.ts\n', stderr: '' }) },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (_: string, note: string) => { notes.push(note) },
    },
    http: { fetch: async () => ({ status: 200, ok: true, text: '{}' }) },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  // The hooks restore this session's feed before they note a task.
  await restoreFeed($)
  noteTasks('TaskCreate', { subject: 'Deny spawns', description: 'x' }, { task: { id: 't1', subject: 'Deny spawns' } })
  noteTasks('TaskCreate', { subject: 'Dropped', description: 'x' }, { task: { id: 't2', subject: 'Dropped' } })
  noteTasks('TaskUpdate', { taskId: 't1', status: 'in_progress' }, {})
  noteTasks('TaskUpdate', { taskId: 't2', status: 'deleted' }, {})
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(notes[0]).toContain('- [ ] Deny spawns (in progress)')
  expect(notes[0]).toContain('- agent a (engineer: fix the hook), output /u/.claude/projects/-u-Armasu/chat-full-5/subagents/agent-a.jsonl')
  expect(notes[0].includes('old run')).toBe(false)
  expect(notes[0].includes('Dropped')).toBe(false)
  expect(notes[0]).toContain('hooks/register.ts')
  expect(notes[0]).toContain('- Old transcript: /u/.claude/projects/-u-Armasu/chat-full-5.jsonl')
  expect((kept.get('handoffs') as Record<string, { note: string }>)['chat-full-5']?.note).toMatch(/\/u\/\.claude\/handoffs\/Armasu\/.*-chat-ful\.md$/)
})

const FULL = { project: 'Armasu', cwd: '/u/Armasu', branch: 'main', session: 'abcdef123456', now: Date.parse('2026-10-23T10:15:00Z'), planPath: '/u/Armasu/docs/superpowers/plans/p.md', transcript: '/u/.claude/projects/-u-Armasu/abcdef123456.jsonl' }

test('a handoff note reads in order: the ask, goal, state, decisions, open tasks, live work, then pointers', () => {
  const note = handoffNote({
    ...FULL, planText: `${PLAN}\n## Dead ends\n\n- Polling the hub every 100ms: burned CPU\n`,
    ask: 'Finish the handoff', tasks: [{ subject: 'Order the note', status: 'pending' }],
    requests: ['never commit', 'Finish the handoff'], errors: ['Bash: exit 1, ENOENT /u/x'], running: ['qa: rerun'], changed: [' M a.ts'],
  })
  const at = (s: string) => { const i = note.indexOf(s); expect(i).toBeGreaterThan(-1); return i }
  const order = ['Read this note fully', '## Last request, verbatim', '## Goal', '## State', '- Folder: /u/Armasu', '## Decisions', '## Open tasks', '## Running work', '## Errors', '## Files touched', '## Next action', '## Earlier requests', '## Dead ends', 'Old transcript: /u/.claude/projects/-u-Armasu/abcdef123456.jsonl']
  order.reduce((prev, s) => { const i = at(s); expect(i).toBeGreaterThan(prev); return i }, -1)
  expect(note).toContain('> never commit')
  // The last request is already above; the list does not repeat it.
  expect(handoffNote({ ...FULL, ask: 'never push', requests: ['never push'] }).includes('## Earlier requests')).toBe(false)
  expect(note).toContain('Bash: exit 1, ENOENT /u/x')
  expect(note).toContain('- Polling the hub every 100ms: burned CPU')
  expect(note).toContain('- [ ] Order the note (pending)')
})

test('a handoff note has the fresh chat run an aar on the old chat after recreating tasks', () => {
  const note = handoffNote(FULL)
  const head = note.split('\n')[2]
  expect(head).toMatch(/Recreate every open task.*if the aar skill is installed, have a subagent run it on the old chat/)
  expect(head).toContain('Old transcript')
  expect(handoffNote({ ...FULL, ask: 'x'.repeat(6_000) }).split('\n')[2]).toBe(head)
})

test('a long note trims dead ends and changed files, never the verbatim tier', () => {
  const ask = 'x'.repeat(6_000)
  const dead = Array.from({ length: 80 }, (_, i) => `- Dead end ${i}: tried and failed for a long reason that goes on`).join('\n')
  const note = handoffNote({
    ...FULL, planText: `## Dead ends\n\n${dead}\n`, ask,
    tasks: Array.from({ length: 20 }, (_, i) => ({ subject: `Task number ${i}`, status: 'pending' })),
    changed: Array.from({ length: 500 }, (_, i) => ` M src/some/deep/file-${i}.ts`),
  })
  expect(note).toContain(ask)
  for (let i = 0; i < 20; i++) expect(note).toContain(`Task number ${i} (pending)`)
  expect(note).toContain('Dead end 79')
  expect(note.includes('Dead end 0:')).toBe(false)
  expect(note).toMatch(/and \d+ more/)
  expect(note.length).toBeLessThan(10_000 + ask.length)
})

test('every unfinished task in the store ends up under open tasks', () => {
  const note = handoffNote({ ...FULL, tasks: [{ subject: 'Listed', status: 'pending' }] })
  const tasks = [{ subject: 'Listed', status: 'pending' }, { subject: 'Missed one', status: 'in_progress' }, { subject: 'Shipped', status: 'completed' }]
  const fixed = ensureOpenTasks(note, tasks)
  const open = fixed.slice(fixed.indexOf('## Open tasks'))
  expect(open).toContain('- [ ] Missed one (in progress)')
  expect(open.split('\n').filter(l => l.includes('Listed')).length).toBe(1)
  expect(open.includes('Shipped')).toBe(false)
  // No open tasks section yet: one is made.
  expect(ensureOpenTasks(handoffNote(FULL), tasks)).toContain('## Open tasks')
  expect(ensureOpenTasks(fixed, tasks)).toBe(fixed)
})

test('the fresh chat is told to restate the goal and tick the open tasks against the note', async ($, on) => {
  on('session.id', () => ({ value: 'chat-fresh-1' }))
  const seen: Array<readonly string[] | undefined> = []
  on('prompt.submit', (_, e) => { seen.push(e.context); return { text: e.text } })
  storeOn(on as never)
  await $.prompt.submit({ text: 'Continue from /u/.claude/handoffs/My Proj/n-abcdef12.md: read it first, then carry on with the open tasks.' })
  const told = (seen[0] ?? []).join('\n')
  expect(told).toContain('/u/.claude/handoffs/My Proj/n-abcdef12.md')
  expect(told).toMatch(/restate the goal/i)
  expect(told).toMatch(/tick each open task/i)
})

test('redact catches cloud keys, live and test keys, passwords and bearer tokens', () => {
  const cases: Array<[string, string]> = [
    ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
    ['AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
    ['stripe sk_live_51HabcdefGHIJKLmnop', 'sk_live_51H'],
    ['stripe sk_test_51HabcdefGHIJKLmnop', 'sk_test_51H'],
    ['stripe rk_live_51HabcdefGHIJKLmnop', 'rk_live_51H'],
    ['google AIzaSyA1234567890abcdefghijklmnopqrstu', 'AIzaSyA123'],
    ['PASSWORD=hunter2secret', 'hunter2secret'],
    ['DB_PASSWORD=hunter2', 'hunter2'],
    ['export MYSQL_PASSWORD="hunter2"', 'hunter2'],
    ['{"password": "hunter2"}', 'hunter2'],
    ['password: hunter2secret', 'hunter2'],
    ['password = hunter2', 'hunter2'],
    ['PGPASSWORD=hunter2 psql', 'hunter2'],
    ['password = "correct horse"', 'horse'],
    ['passwd=hunter2', 'hunter2'],
    ['pwd=hunter2', 'hunter2'],
    ["password: 'hunter2 x'", 'hunter2'],
    ['Authorization: Bearer 9f8e7d6c5b4a3210.ZYX-wvu/tsr', '9f8e7d6c5b4a3210'],
    ['mysql --password hunter2x -u root', 'hunter2x'],
    ['psql --pass=hunter2x', 'hunter2x'],
    ['OPENAI_API_KEY=abc123def', 'abc123def'],
    ['GITHUB_TOKEN: "tok en 9"', 'tok en 9'],
    ["CLIENT_SECRET = 'shhh'", 'shhh'],
    ['DB_PASSWORD: hunter', 'hunter'],
    ['{"api_key": "plainvalue"}', 'plainvalue'],
    ['hf hf_abcdefghijklmnopqrstuvwxyz12', 'hf_abcdefgh'],
    ['gitlab glpat-abcdefghij1234567890', 'glpat-abcd'],
    ['npm npm_abcdefghijklmnopqrstuvwxyz0123456789', 'npm_abcdefgh'],
    ['gh gho_0123456789abcdefghij0123456789ABCD', 'gho_0123'],
    ['pat github_pat_11ABCDEFG0123456789_abcdefghij', 'github_pat_11'],
    ['slack xoxp-1234-5678-abcdefghijkl', 'xoxp-1234'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7'],
    ['git clone https://kenneth:s3cretpass@github.com/x/y.git', 's3cretpass'],
    ['mysql -u root -pS3cret db', 'S3cret'],
  ]
  for (const [text, bad] of cases) {
    const clean = redact(text)
    expect(clean.includes(bad)).toBe(false)
    expect(clean).toContain('[removed]')
  }
  for (const words of ['sort_key: name', 'primary_key: id', 'next_token: null', 'cache_key = build(x)', 'KEY: press enter', 'fix the API_KEY: it is read twice', 'const { API_KEY: key } = env', 'route /reset_password: page', 'mkdir -p src/x', 'MAX_TOKENS=4096 is the cap', 'the key: value pairs', 'https://github.com/x/y', 'the token: it expired', 'the password field is required', 'Use Bearer authentication for the API', 'The password: field must be required', 'Reset password: done', 'the password = field']) expect(redact(words)).toBe(words)
})

test('the completeness check never brings a secret back', () => {
  const tasks = [{ subject: 'Rotate sk-or-v1-0123456789abcdef0123456789abcdef', status: 'pending' }]
  const note = handoffNote({ ...FULL, tasks })
  expect(ensureOpenTasks(note, tasks)).toBe(note)
  const fixed = ensureOpenTasks(handoffNote(FULL), tasks)
  expect(fixed.includes('sk-or-v1-0123')).toBe(false)
  expect(fixed).toContain('- [ ] Rotate [removed] (pending)')
})

test('a late task goes under Open tasks, replacing none, before errors', () => {
  const note = handoffNote({ ...FULL, ask: 'go', requests: ['first', 'go'], errors: ['Bash: boom'] })
  const fixed = ensureOpenTasks(note, [{ subject: 'Late task', status: 'pending' }])
  const open = fixed.indexOf('## Open tasks')
  expect(open).toBeGreaterThan(fixed.indexOf('## State'))
  expect(open).toBeLessThan(fixed.indexOf('## Errors'))
  expect(fixed).toContain('## Open tasks\n\n- [ ] Late task (pending)')
  expect(fixed.includes('- none')).toBe(false)
})

test('a long chat keeps the newest earlier requests, each cut short, the rest in the transcript', () => {
  const requests = Array.from({ length: 40 }, (_, i) => `Request ${i}: ${'y'.repeat(400)}`)
  const note = handoffNote({ ...FULL, ask: 'the end', requests })
  // The first request still names the goal.
  expect(note).toContain('## Goal\n\nRequest 0: ')
  for (let i = 35; i < 40; i++) expect(note).toContain(`Request ${i}: ${'y'.repeat(288)} (cut, see transcript)`)
  expect(note.includes('Request 34: ')).toBe(false)
  expect(note).toContain('35 older, see transcript')
})

test('the note keeps every request whole, the last one uncut, and marks cut errors', async ($, on) => {
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-capture' }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('clock.now', () => ({ value: 9e12 }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  on('tool.call', () => ({ result: {}, isError: true, text: `boom ${'z'.repeat(600)}` }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  let told = ''
  on('session.compact', (_, e) => { told = String((e as { instructions?: string }).instructions ?? ''); return { messages: (e as { messages: unknown }).messages } as never })
  storeOn(on as never)
  await $.prompt.submit({ text: 'please look at the login page' })
  const long = `fix it ${'w'.repeat(3_000)} end-of-ask`
  await $.prompt.submit({ text: long })
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(told).toContain('> please look at the login page')
  expect(told).toContain('end-of-ask')
  expect(told).toContain('(truncated, see transcript)')
})

test('a reloaded mod does not hand off a session twice', async () => {
  const written: string[] = []
  const kept = new Map<string, unknown>([['handoffs', { 'chat-reloaded': { note: '/u/.claude/handoffs/Armasu/old.md', at: 1 } }]])
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-reloaded', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.8e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async () => ({ status: 200, ok: true, text: '{}' }) },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(written).toEqual([])
})

test('a handoff asked for again posts the kept note once more, forced, without a second note', async () => {
  const written: string[] = []
  const posts: string[] = []
  const kept = new Map<string, unknown>([['handoffs', { 'chat-again': { note: '/u/.claude/handoffs/Armasu/old.md', at: 1 } }]])
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-again', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.9e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async (url: string, init?: { body?: string }) => { posts.push(`${url} ${init?.body ?? ''}`); return { status: 200, ok: true, text: '{"onFull":"fresh"}' } } },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(written).toEqual([])
  const sent = posts.filter(p => p.includes('"kind":"handoff"'))
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('"note":"/u/.claude/handoffs/Armasu/old.md"')
  expect(sent[0]).toContain('"force":true')
})

test('reads the wrap-up reply into goal, tests, decisions and next action', () => {
  const s = summaryOf('Done.\nGoal: Ship the handoff\nTests: pnpm test, 40 pass\nDecisions:\n- wait for shells: they do not carry over\n- 5k budget: tokens\nNext: run qa')
  expect(s).toEqual({ goal: 'Ship the handoff', tests: 'pnpm test, 40 pass', decisions: ['wait for shells: they do not carry over', '5k budget: tokens'], next: 'run qa' })
  expect(summaryOf('no fields here')).toBeUndefined()
})

test('tracks background shells from start to TaskStop or their notification', () => {
  noteShell('Bash', { command: 'npm run dev', run_in_background: true }, { backgroundTaskId: 'b1' }, 'Command running in background with ID: b1. Output is being written to: /t/b1.output')
  noteShell('Bash', { command: 'sleep 9', run_in_background: true }, { backgroundTaskId: 'b2' }, '')
  noteShell('Bash', { command: 'ls' }, {}, '')
  expect(liveShells()).toEqual([{ id: 'b1', command: 'npm run dev', output: '/t/b1.output' }, { id: 'b2', command: 'sleep 9' }])
  noteShell('TaskStop', { task_id: 'b1' }, {}, '')
  shellsDone('<task-notification>\n<task-id>b2</task-id>\n<status>completed</status>\n</task-notification>')
  expect(liveShells()).toEqual([])
})

test('a handoff note has short fixed fields, done tasks as a count, and the old session', () => {
  const note = handoffNote({
    ...FULL, planText: PLAN, ask: 'Finish it', requests: ['never commit', 'Finish it'],
    tasks: [{ subject: 'Wire it', status: 'completed' }, { subject: 'Test it', status: 'in_progress' }],
    summary: { goal: 'Ship the handoff', tests: 'pnpm test, 40 pass', decisions: ['wait for shells: they do not carry over'], next: 'run qa' },
    running: ['shell b1: npm run dev, output /t/b1.output'], results: ['qa: 3 problems found (/u/sub/agent-q1.jsonl)'], changed: [' M src/a.ts', '?? src/b.ts'],
  })
  const order = ['Recreate every open task', '## Last request, verbatim', '## Goal', 'Ship the handoff', '## State', 'Tests last run: pnpm test, 40 pass', '## Decisions', '- wait for shells: they do not carry over', '## Open tasks', '- [ ] Test it (in progress)', '## Running work', '- shell b1: npm run dev, output /t/b1.output', '## Subagent results', '## Files touched', 'src/a.ts', '## Next action', 'run qa', '## Earlier requests', '> never commit', 'Old transcript: /u/.claude/projects/-u-Armasu/abcdef123456.jsonl']
  order.reduce((prev, s) => { const i = note.indexOf(s); expect(i).toBeGreaterThan(prev); return i }, -1)
  expect(note).toContain('Old session: abcdef123456')
  expect(note).toContain('1 task done')
  expect(note.includes('Wire it')).toBe(false)
  expect(note.includes(' M src/a.ts')).toBe(false)
  expect(note.includes('Social-media-dev')).toBe(false)
})

test('a long note stays near 5,000 characters and never cuts open tasks, running work or the last request', () => {
  const ask = 'x'.repeat(3_000)
  const note = handoffNote({
    ...FULL, ask, requests: Array.from({ length: 30 }, (_, i) => `Request ${i}: ${'y'.repeat(400)}`).concat(ask),
    planText: `## Dead ends\n\n${Array.from({ length: 80 }, (_, i) => `- Dead end ${i}: a long reason that goes on`).join('\n')}\n`,
    tasks: Array.from({ length: 30 }, (_, i) => ({ subject: `Task number ${i}`, status: 'pending' })),
    running: Array.from({ length: 10 }, (_, i) => `agent a${i} (engineer: job ${i}), output /u/sub/agent-a${i}.jsonl`),
    changed: Array.from({ length: 500 }, (_, i) => ` M src/some/deep/file-${i}.ts`),
  })
  expect(note).toContain(ask)
  for (let i = 0; i < 30; i++) expect(note).toContain(`Task number ${i} (pending)`)
  for (let i = 0; i < 10; i++) expect(note).toContain(`agent a${i} (engineer`)
  const fixed = ask.length + 30 * 30 + 10 * 60
  expect(note.length).toBeLessThan(5_000 + fixed)
})

test('near full, the chat first wraps up; the handoff waits until no subagent or shell runs', async ($, on) => {
  const posts: string[] = []
  const prompts: string[] = []
  const notes: string[] = []
  let agents = [{ id: 'e9', type: 'engineer', description: 'fix it', status: 'running' }]
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-pause-1' }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.root', () => ({ value: '/u/Armasu' }))
  on('session.usage', () => ({ value: { context: { tokens: 152_000, breakdown: { autoCompactThreshold: 167_000 } }, rateLimits: [], startedAt: 0 } }))
  on('clock.now', () => ({ value: 9.91e12 }))
  on('agent.list', () => ({ value: agents }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'w.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  on('fs.write', (_, e) => { notes.push(String(e.text)); return { value: undefined } })
  on('http.fetch', (_, e) => { posts.push(`${e.url} ${e.init?.body ?? ''}`); return { value: { status: 200, ok: true, headers: {}, text: String(e.url).includes('/hub/keep') ? '{"onFull":"fresh"}' : '' } } })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => { prompts.push(e.text); return { text: e.text } })
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'opus' }))
  storeOn(on as never)
  let ranResult: unknown = { backgroundTaskId: 'bz' }
  on('tool.call', () => ({ result: ranResult }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  const end = (answer = 'ok') => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  const handedOff = () => posts.some(p => p.includes('"kind":"handoff"'))
  expect(handedOff()).toBe(false)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toMatch(/clean pause/i)
  expect(prompts[0]).toContain('TaskStop')
  expect(prompts[0]).toContain('bz')
  // Spawns are held while it wraps up.
  expect(JSON.stringify(await $.agent.spawn({ subagentType: 'engineer', prompt: 'x', description: 'x' } as never))).toContain('Context is nearly full')
  await end('still waiting')
  expect(handedOff()).toBe(false)
  agents = []
  ranResult = { message: 'stopped', task_id: 'bz', task_type: 'local_bash' }
  await $.tool.call({ tool: 'TaskStop', task_id: 'bz' } as never)
  await end('Paused.\nGoal: Ship the pause\nTests: none run\nDecisions:\n- wait first: no leaks\nNext: run qa')
  expect(handedOff()).toBe(true)
  expect(prompts.length).toBe(1)
  expect(notes.join('')).toContain('Ship the pause')
  expect(notes.join('')).toContain('- wait first: no leaks')
})

test('at the hard limit the handoff goes anyway and lists what still runs', async ($, on) => {
  const posts: string[] = []
  const notes: string[] = []
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-pause-2' }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.root', () => ({ value: '/u/Armasu' }))
  let tokens = 152_000
  on('session.usage', () => ({ value: { context: { tokens, breakdown: { autoCompactThreshold: 167_000 } }, rateLimits: [], startedAt: 0 } }))
  on('clock.now', () => ({ value: 9.92e12 }))
  on('agent.list', () => ({ value: [{ id: 'q7', type: 'qa', description: 'rerun', status: 'running' }] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'w.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  on('fs.write', (_, e) => { notes.push(String(e.text)); return { value: undefined } })
  on('http.fetch', (_, e) => { posts.push(String(e.init?.body ?? '')); return { value: { status: 200, ok: true, headers: {}, text: String(e.url).includes('/hub/keep') ? '{"onFull":"fresh"}' : '' } } })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  storeOn(on as never)
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  tokens = 165_000
  await end()
  expect(posts.some(p => p.includes('"kind":"handoff"'))).toBe(true)
  expect(notes.join('')).toContain('agent q7 (qa: rerun), output /u/.claude/projects/-u-Armasu/chat-pause-2/subagents/agent-q7.jsonl')
})

test('a reload keeps the task list, last request and errors from the store', async () => {
  const notes: string[] = []
  const kept = new Map<string, unknown>([['feeds', { 'chat-reload-2': { tasks: [['k1', { subject: 'Kept task', status: 'pending' }]], ask: 'the kept ask', errors: ['Bash: kept error'], requests: ['the kept ask'], at: 1 } }]])
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-reload-2', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.93e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (_: string, note: string) => { notes.push(note) },
    },
    http: { fetch: async () => ({ status: 200, ok: true, text: '{}' }) },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(notes[0]).toContain('- [ ] Kept task (pending)')
  expect(notes[0]).toContain('> the kept ask')
  expect(notes[0]).toContain('Bash: kept error')
})

test('the task list is saved to the store as it changes', async ($, on) => {
  on('session.id', () => ({ value: 'chat-save-1' }))
  on('clock.now', () => ({ value: 9e12 }))
  on('env.get', () => ({ value: '/u' }))
  on('fs.read', () => ({ value: '' }))
  on('tool.call', () => ({ result: { task: { id: 's1', subject: 'Saved task' } } }))
  const kept = storeOn(on as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Saved task', description: 'x' } as never)
  const saved = (kept.get('feeds') as Record<string, { tasks: Array<[string, { subject: string }]> }>)['chat-save-1']
  expect(saved.tasks.some(([, t]) => t.subject === 'Saved task')).toBe(true)
})

test('the fresh chat is told which open tasks from the note it has not recreated', async ($, on) => {
  const prompts: string[] = []
  on('session.id', () => ({ value: 'chat-fresh-9' }))
  on('clock.now', () => ({ value: 9e12 }))
  on('env.get', () => ({ value: '/u' }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('n-abcdef99.md') ? '## Open tasks\n\n- [ ] Alpha (pending)\n- [ ] Beta (in progress)\n\n## Running work\n' : '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => { prompts.push(e.text); return { text: e.text } })
  on('tool.call', () => ({ result: { task: { id: 'f1', subject: 'Alpha' } } }))
  on('turn.complete', () => ({ text: '' }))
  storeOn(on as never)
  await $.prompt.submit({ text: 'Continue from /u/.claude/handoffs/A/n-abcdef99.md: read it first, recreate every open task in it with the task tools before any other work, then carry on.' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Alpha', description: 'x' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('Beta')
  expect(prompts[1].includes('Alpha')).toBe(false)
})

// The harness pieces the pause tests share: one window at port 7, a chat in /u/Armasu.
function pauseRig(on: (op: never, fn: never) => void, id: string, o: { tokens: () => number; keep: () => { status: number; text: string }; agents?: () => unknown[]; prompts: string[]; posts: string[]; notes: string[] }) {
  const h = on as unknown as (op: string, fn: (_: unknown, e: Record<string, any>) => unknown) => void
  h('env.get', () => ({ value: '/u' }))
  h('session.id', () => ({ value: id }))
  h('session.cwd', () => ({ value: '/u/Armasu' }))
  h('session.root', () => ({ value: '/u/Armasu' }))
  h('session.usage', () => ({ value: { context: { tokens: o.tokens(), breakdown: { autoCompactThreshold: 167_000 } }, rateLimits: [], startedAt: 0 } }))
  h('clock.now', () => ({ value: 9.95e12 }))
  h('agent.list', () => ({ value: o.agents?.() ?? [] }))
  h('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  h('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'w.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  h('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  h('fs.write', (_, e) => { o.notes.push(String(e.text)); return { value: undefined } })
  h('http.fetch', (_, e) => {
    o.posts.push(String(e.init?.body ?? ''))
    const k = o.keep()
    return { value: String(e.url).includes('/hub/keep') ? { status: k.status, ok: k.status === 200, headers: {}, text: k.text } : { status: 200, ok: true, headers: {}, text: '' } }
  })
  h('ui.toast', () => ({ value: undefined }))
  h('prompt.submit', (_, e) => { o.prompts.push(String(e.text)); return { text: e.text } })
  h('turn.complete', () => ({ text: '' }))
  h('agent.spawn', (_, e) => ({ model: e.model ?? 'opus' }))
  storeOn(on as never)
}

test('a pause ends when the window says compact, or the context drops after a compaction', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  let tokens = 152_000
  let keep = { status: 200, text: '{"onFull":"fresh"}' }
  pauseRig(on as never, 'chat-pause-3', { ...o, tokens: () => tokens, keep: () => keep })
  on('tool.call', () => ({ result: {} }))
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  const spawn = async () => JSON.stringify(await $.agent.spawn({ subagentType: 'engineer', prompt: 'x', description: 'x' } as never))
  await end()
  expect(o.prompts.length).toBe(1)
  keep = { status: 500, text: '' }
  tokens = 40_000
  for (let i = 0; i < 4; i++) await end()
  expect(o.posts.some(p => p.includes('"kind":"handoff"'))).toBe(false)
  expect(await spawn()).not.toContain('Context is nearly full')
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never))).not.toContain('Context is nearly full')
})

test('a pause in compact mode never hands off, even past the hard limit', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  let tokens = 152_000
  let keep = { status: 200, text: '{"onFull":"fresh"}' }
  pauseRig(on as never, 'chat-pause-4', { ...o, tokens: () => tokens, keep: () => keep })
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  keep = { status: 200, text: '{"onFull":"compact"}' }
  tokens = 166_000
  await end()
  expect(o.posts.some(p => p.includes('"kind":"handoff"'))).toBe(false)
})

test('a shell left after the wrap-up gets one follow-up, then the handoff lists it', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-pause-5', { ...o, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }) })
  on('tool.call', () => ({ result: { backgroundTaskId: 'dev1' } }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  await end()
  expect(o.prompts.length).toBe(2)
  expect(o.prompts[1]).toContain('dev1')
  expect(o.prompts[1]).toContain('TaskStop')
  expect(o.posts.some(p => p.includes('"kind":"handoff"'))).toBe(false)
  await end()
  expect(o.posts.filter(p => p.includes('"kind":"handoff"')).length).toBe(1)
  expect(o.notes.join('')).toContain('- shell dev1: npm run dev')
})

test('two handoffs at once write one note and post once', async () => {
  const written: string[] = []
  const posts: string[] = []
  const kept = new Map<string, unknown>()
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-twice', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.96e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async (url: string, init?: { body?: string }) => { posts.push(init?.body ?? ''); return { status: 200, ok: true, text: '{}' } } },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await Promise.all([deliver($, [{ id: 'a', kind: 'handoff' }]), deliver($, [{ id: 'b', kind: 'handoff' }])])
  expect(written.length).toBe(1)
  expect(posts.filter(p => p.includes('"kind":"handoff"')).length).toBe(1)
})

test('a new session in the same process forgets the last one\'s plan, file and prompt', async () => {
  const notes: string[] = []
  let id = 'chat-old-plan'
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => id, usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.97e12 },
    store: { get: async () => undefined, set: async () => undefined },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (_: string, note: string) => { notes.push(note) },
    },
    http: { fetch: async () => ({ status: 200, ok: true, text: '{}' }) },
    ui: { toast: async () => undefined },
  } as unknown as EngineInterface
  await restoreFeed($)
  notePlan('/u/Armasu/docs/superpowers/plans/old.md')
  id = 'chat-new-plan'
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(notes[0].includes('plans/old.md')).toBe(false)
})

test('a failed keep fetch leaves the pause on: no spawn, no second wrap-up', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  let keep = { status: 200, text: '{"onFull":"fresh"}' }
  pauseRig(on as never, 'chat-pause-6', { ...o, tokens: () => 152_000, keep: () => keep, agents: () => [{ id: 'r1', type: 'qa', description: 'x', status: 'running' }] })
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  keep = { status: 500, text: '' }
  await end()
  expect(JSON.stringify(await $.agent.spawn({ subagentType: 'engineer', prompt: 'x', description: 'x' } as never))).toContain('Context is nearly full')
  keep = { status: 200, text: '{"onFull":"fresh"}' }
  await end()
  expect(o.prompts.length).toBe(1)
})

test('a turn that ends with open tasks and nothing running is asked to keep going, three times at most without progress', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  let agents: unknown[] = []
  pauseRig(on as never, 'chat-keep-1', { ...o, tokens: () => 40_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }), agents: () => agents })
  let result: unknown = { task: { id: 'k1', subject: 'Wire the hook' } }
  on('tool.call', () => ({ result }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Wire the hook', description: 'x' } as never)
  const end = (answer = 'Step one done.') => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  expect(o.prompts.length).toBe(1)
  expect(o.prompts[0].startsWith('Switchboard: ')).toBe(true)
  expect(o.prompts[0]).toContain('Wire the hook')
  expect(o.prompts[0]).toContain('AskUserQuestion')
  await end()
  await end()
  await end()
  expect(o.prompts.length).toBe(3)
  // Progress on a task starts the count over.
  result = {}
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'k1', status: 'in_progress' } as never)
  await end()
  expect(o.prompts.length).toBe(4)
  // A question, a commit block or a running subagent ends the turn as is.
  await end('Should I also bump the version?')
  await end('Done.\n\nCommit message:\n```\nfeat: x\n```')
  agents = [{ id: 'q1', type: 'qa', description: 'x', status: 'running' }]
  await end()
  expect(o.prompts.length).toBe(4)
  // Kenneth's own prompt starts the count over too.
  agents = []
  await end()
  await end()
  expect(o.prompts.length).toBe(6)
  await $.prompt.submit({ text: 'carry on' })
  await end()
  expect(o.prompts.length).toBe(8)
})

test('no open tasks, or a background shell still running, ends the turn as is', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-keep-2', { ...o, tokens: () => 40_000, keep: () => ({ status: 200, text: '{}' }) })
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'dev2' } : { task: { id: 'k2', subject: 'A' } } }))
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  expect(o.prompts.length).toBe(0)
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'x' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  await end()
  expect(o.prompts.length).toBe(0)
})

test('every chat is told to ask with AskUserQuestion and not to stop with open tasks', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const got = await $.prompt.compose({ sections: [], promptModel: 'opus', outputStyle: null, tools: [], traits: [], surfaces: [] } as never)
  expect(JSON.stringify(got)).toContain('AskUserQuestion')
})

test('a compaction from Switchboard leaves no idle chat with open tasks: it is told to carry on', async () => {
  const prompts: string[] = []
  let skip = false
  const $ = {
    prompt: { submit: async ({ text }: { text: string }) => { prompts.push(text); return {} } },
    session: { id: async () => 'compact-chat', compact: async () => ({ skip }) },
    store: { get: async () => undefined, set: async () => undefined },
    agent: { list: async () => [] },
  } as unknown as EngineInterface
  await restoreFeed($)
  noteTasks('TaskCreate', { subject: 'Wire the retry', description: 'x' }, { task: { id: 'c1', subject: 'Wire the retry' } })
  await deliver($, [{ id: 'c', kind: 'compact' }])
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Wire the retry')
  skip = true
  await deliver($, [{ id: 'c', kind: 'compact' }])
  expect(prompts.length).toBe(1)
})

// Same table as switchboard extension/test/progress.test.ts (askedQuestion); keep the two in step.
const ENDS_ASKING: [string, boolean][] = [
  ['Which one?\n\n```\nnpm test\n```\n', true],
  ['Change:\n\n```diff\n-a\n+b\n```\n\nApply it to main too?\n\n```bash\ngit apply x\n```', true],
  ['Should I bump the version? I left it at 1.2 for now.', false],
  ['Is this ok?\n\nDone.', false],
  ['Fixed the build. Tests pass. Should I also bump the version?', true],
  ['Here you go.', false],
  ['', false],
]

test('endsAsking: the shared ends-on-a-question table', () => {
  for (const [text, asks] of ENDS_ASKING) expect(endsAsking(text)).toBe(asks)
})

test('a frozen window holds no chat: session start ends and the other window still gets the post', async ($, on) => {
  const posts: string[] = []
  on('env.get', () => ({ value: '/Users/k' }))
  on('session.cwd', () => ({ value: '/Users/k/Frozen' }))
  on('session.id', () => ({ value: 'chat-frozen' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [], startedAt: 0 } }))
  on('clock.now', () => ({ value: 2_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [
    { name: 'a.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    { name: 'b.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
  ] }))
  on('fs.read', (_, e) => ({ value: JSON.stringify({ port: String(e.path).endsWith('a.json') ? 1 : 2, workspace: '/Users/k/Frozen', hubToken: 't' }) }))
  on('http.fetch', (_, e) => {
    posts.push(`${e.url} ${e.init?.body ?? ''}`)
    // Port 1 is a window that never answers.
    return String(e.url).includes(':1/') ? new Promise(() => {}) : { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/k/Frozen', surface: 'terminal', isInteractive: true })
  expect(posts.some(p => p.startsWith('http://127.0.0.1:2/hub ') && p.includes('"kind":"live"'))).toBe(true)
})

test('an agent start never waits on the hub post', async ($, on) => {
  on('env.get', () => ({ value: '/u' }))
  on('session.id', () => ({ value: 'chat-agent-frozen' }))
  on('clock.now', () => ({ value: 9.9e12 }))
  on('clock.sleep', () => new Promise(() => {}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'w.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u', hubToken: 't' }) : '' }))
  on('http.fetch', () => new Promise(() => {}))
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'opus' }))
  const started = await $.agent.spawn({ subagentType: 'researcher', prompt: 'x', description: 'x' } as never)
  expect(started.deny).toBeUndefined()
})

test('sends the window token in a header, never in the URL', async () => {
  const asked: Array<{ url: string; token?: string }> = []
  const $ = {
    env: { get: async () => '/u' },
    session: { id: async () => 'chat-header' },
    clock: { now: async () => 9.98e12, sleep: () => new Promise(() => {}) },
    fs: { list: async () => [{ name: 'a-1.json', kind: 'file' }], read: async () => JSON.stringify({ port: 1, workspace: '/u', hubToken: 'sekrit' }) },
    http: { fetch: (url: string, init?: { headers?: Record<string, string> }) => { asked.push({ url, token: init?.headers?.['X-Switchboard-Token'] }); return Promise.resolve({ status: 404, ok: false, headers: {}, text: '' }) } },
  } as unknown as EngineInterface
  void poll($)
  await new Promise(r => setTimeout(r, 20))
  expect(asked.length).toBe(1)
  expect(asked[0].url).not.toContain('sekrit')
  expect(asked[0].token).toBe('sekrit')
})

test('a slow poll is not run again until it ends, and asks every window at once', async () => {
  const asked: string[] = []
  const $ = {
    env: { get: async () => '/u' },
    session: { id: async () => 'chat-poll' },
    clock: { now: async () => 9.99e12, sleep: () => new Promise(() => {}) },
    fs: {
      list: async () => [{ name: 'a-1.json', kind: 'file' }, { name: 'b-2.json', kind: 'file' }],
      read: async (p: string) => JSON.stringify({ port: p.endsWith('a-1.json') ? 1 : 2, workspace: '/u', hubToken: 't' }),
    },
    http: { fetch: (url: string) => { asked.push(url); return new Promise(() => {}) } },
  } as unknown as EngineInterface
  void poll($)
  void poll($)
  await new Promise(r => setTimeout(r, 20))
  expect(asked.map(u => u.split('/hub')[0]).sort()).toEqual(['http://127.0.0.1:1', 'http://127.0.0.1:2'])
})

test('a handoff the window refused is not remembered, says so, and can be tried again', async () => {
  const written: string[] = []
  const toasts: string[] = []
  const kept = new Map<string, unknown>()
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-refused', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 9.7e12 },
    store: { get: async (k: string) => kept.get(k), set: async (k: string, v: unknown) => { kept.set(k, v) } },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async (url: string) => (url.includes('/hub/keep') ? { status: 200, ok: true, text: '{"onFull":"fresh"}' } : { status: 500, ok: false, text: '' }) },
    ui: { toast: async (t: string) => { toasts.push(t) } },
  } as unknown as EngineInterface
  await deliver($, [{ id: 'h', kind: 'handoff' }])
  expect(kept.get('handoffs')).toBeUndefined()
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('failed')
  await deliver($, [{ id: 'h2', kind: 'handoff' }])
  expect(written.length).toBe(2)
})

test('after a refused handoff, settles wait before writing another note; a forced one still goes', async () => {
  const written: string[] = []
  let up = false
  const $ = {
    env: { get: async () => '/u' },
    session: { cwd: async () => '/u/Armasu', id: async () => 'chat-backoff', usage: async () => ({ context: { tokens: 1 } }) },
    clock: { now: async () => 1e13 },
    store: { get: async () => undefined, set: async () => {} },
    fs: {
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'w.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
      write: async (path: string) => { written.push(path) },
    },
    http: { fetch: async (url: string) => (url.includes('/hub/keep') ? { status: 200, ok: true, text: '{"onFull":"fresh"}' } : up ? { status: 200, ok: true, text: '' } : { status: 500, ok: false, text: '' }) },
    ui: { toast: async () => {} },
  } as unknown as EngineInterface
  await maybeHandoff($, true)
  await maybeHandoff($)
  expect(written.length).toBe(1)
  up = true
  await maybeHandoff($, true)
  expect(written.length).toBe(2)
})

test('an edit counts as the chat file only once it ran, never when denied', async ($, on) => {
  const posts: string[] = []
  let now = 5e12
  on('env.get', () => ({ value: '/u' }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.id', () => ({ value: 'chat-edit-file' }))
  on('clock.now', () => ({ value: now }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'w.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('w.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  on('http.fetch', (_, e) => { posts.push(String(e.init?.body ?? '')); return { value: { status: 204, ok: true, headers: {}, text: '' } } })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [], startedAt: 0 } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => (String((e as { file_path?: unknown }).file_path).endsWith('held.ts') ? { deny: 'another chat edited it' } : { result: {} }))
  // A start posts the live row now; the clock moves past the post interval each time.
  const measure = async () => { now += 10_000; await $.session.start({ cwd: '/u/Armasu', surface: 'terminal', isInteractive: true }) }
  const lastLive = () => posts.filter(p => p.includes('"kind":"live"')).at(-1) ?? ''
  await $.tool.call({ tool: 'Edit', file_path: '/u/Armasu/held.ts', old_string: 'a', new_string: 'b' } as never)
  await measure()
  expect(lastLive()).not.toContain('held.ts')
  await $.tool.call({ tool: 'Edit', file_path: '/u/Armasu/ok.ts', old_string: 'a', new_string: 'b' } as never)
  await measure()
  expect(lastLive()).toContain('"file":"/u/Armasu/ok.ts"')
})

test('holds at pauseAt or over, 99 by default, never when off, and not past a reset', () => {
  const at = Date.parse('2026-11-08T12:00:00Z')
  const w = [{ kind: 'five_hour', percentUsed: 99.4, resetsAt: '2026-11-08T12:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-11-10T00:00:00Z' }]
  expect(overLimit(w, undefined, at - 1)).toEqual({ kind: 'five_hour', percent: 99, resetsAt: at })
  expect(overLimit(w, 100, at - 1)).toBeUndefined()
  expect(overLimit(w, 40, at - 1)?.kind).toBe('five_hour')
  expect(overLimit(w, null, at - 1)).toBeUndefined()
  expect(overLimit(w, undefined, at)).toBeUndefined()
  // Resumed by hand in Switchboard: that window no longer holds.
  expect(overLimit(w, undefined, at - 1, at + 60_000)).toBeUndefined()
  expect(hubHold({ kind: 'five_hour', percent: 99, resumeAt: at }, at - 1)).toEqual({ kind: 'five_hour', percent: 99, resetsAt: at })
  expect(hubHold({ kind: 'five_hour', percent: 99, resumeAt: at }, at)).toBeUndefined()
  expect(hubHold(undefined, at)).toBeUndefined()
})

test('counts down to the reset', () => {
  expect(untilText(4 * 3_600_000 + 12 * 60_000 + 5_000)).toBe('4h 12m')
  expect(untilText(12 * 60_000 + 1)).toBe('12m')
  expect(untilText(45_000)).toBe('45s')
  expect(untilText(-5)).toBe('0s')
  const h = { kind: 'five_hour', percent: 99, resetsAt: 3_600_000 }
  expect(holdLine(h, 0)).toBe('Paused: five-hour limit at 99%, resumes in 1h 0m')
  expect(holdDenial(h, 0)).toBe('Paused by usage-meter: five-hour usage at 99%. Stop here; this chat resumes by itself when the limit resets, in 1h 0m.')
})

// Each test starts later than the last, past the 10 s limits.json cache.
let hb = 3e13
const holdDouble = (o: { windows: unknown[]; pause?: unknown; id: string }) => {
  const s = { now: hb, status: [] as Array<string | undefined>, toasts: [] as string[], prompts: [] as string[], posts: [] as string[], store: {} as Record<string, unknown>, limits: { windows: o.windows, ...(o.pause ? { paused: true, pause: o.pause } : {}) } as Record<string, unknown> }
  const $ = {
    clock: { now: async () => s.now },
    session: { id: async () => o.id },
    env: { get: async () => '/u' },
    store: { get: async (k: string) => s.store[k], set: async (k: string, v: unknown) => { s.store[k] = JSON.parse(JSON.stringify(v)) } },
    fs: {
      list: async () => [{ name: 'a-1.json', kind: 'file' }],
      read: async (p: string) => (p.endsWith('limits.json') ? JSON.stringify(s.limits) : p.endsWith('company.json') ? '{}' : JSON.stringify({ port: 1, workspace: '/u', hubToken: 't' })),
    },
    http: { fetch: async (_: string, init?: { body?: string }) => { if (init?.body) s.posts.push(init.body); return { status: 204, ok: true, text: '' } } },
    ui: { status: async (t?: string) => { s.status.push(t) }, toast: async (t: string) => { s.toasts.push(t) } },
    prompt: { submit: async ({ text }: { text: string }) => { s.prompts.push(text); return {} } },
  } as unknown as EngineInterface
  return { $, s }
}

test('a chat cut off mid-work holds until the reset, then gets one prompt from the timer while idle', async () => {
  const reset = (hb += 1e9) + 3_600_000
  const { $, s } = holdDouble({ id: 'hold-1', windows: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] })
  await holdTick($)
  expect(s.status.at(-1)).toBe('Paused: five-hour limit at 99%, resumes in 1h 0m')
  expect(s.posts.some(p => p.includes('"kind":"hold"') && p.includes('"sessionId":"hold-1"') && p.includes('"percent":99'))).toBe(true)
  expect(await heldNow($)).toBe('Paused by usage-meter: five-hour usage at 99%. Stop here; this chat resumes by itself when the limit resets, in 1h 0m.')
  s.now = reset - 30_000
  await holdTick($)
  expect(s.status.at(-1)).toBe('Paused: five-hour limit at 99%, resumes in 30s')
  expect(s.prompts).toEqual([])
  // limits.json still says 99% for the old window: past its reset that counts as empty.
  s.now = reset + 1_000
  await holdTick($)
  await holdTick($)
  s.now += 20_000
  await holdTick($)
  expect(s.prompts.length).toBe(1)
  expect(s.prompts[0]).toMatch(/^Switchboard: usage limit reset\. Carry on from where you stopped/)
  expect(s.status.at(-1)).toBeUndefined()
  expect(s.toasts).toEqual(['Resumed: limit reset'])
  expect(s.posts.at(-1)).toContain('"hold":null')
  expect(await heldNow($)).toBeUndefined()
  // Switchboard's own resume prompt for the same pause comes after: dropped, so the turn runs once.
  await deliver($, [{ id: 'r1', kind: 'prompt', text: 'Usage limit reset. Continue where you stopped; resume any subagents cut off with SendMessage.' }])
  expect(s.prompts.length).toBe(1)
})

test('an idle chat is unpaused at the reset but sent no prompt', async () => {
  const reset = (hb += 1e9) + 600_000
  const { $, s } = holdDouble({ id: 'hold-2', windows: [], pause: { kind: 'five_hour', percent: 99, resumeAt: reset, chats: [] } })
  await holdTick($)
  expect(s.status.at(-1)).toBe('Paused: five-hour limit at 99%, resumes in 10m')
  s.now = reset + 11_000
  await holdTick($)
  expect(s.prompts).toEqual([])
  expect(s.status.at(-1)).toBeUndefined()
})

test('Switchboard resuming first lifts the hold and the mod sends nothing more', async () => {
  const reset = (hb += 1e9) + 600_000
  const { $, s } = holdDouble({ id: 'hold-3', windows: [], pause: { kind: 'five_hour', percent: 99, resumeAt: reset, chats: [] } })
  await holdTick($)
  await heldNow($)
  await deliver($, [{ id: 'r2', kind: 'prompt', text: 'Usage limit reset. Continue where you stopped; resume any subagents cut off with SendMessage.' }])
  expect(s.prompts.length).toBe(1)
  s.limits = { windows: [] }
  s.now = reset + 11_000
  await holdTick($)
  expect(s.prompts.length).toBe(1)
})

test('a hand resume inside the limits.json cache is not undone by the next tick', async () => {
  const reset = (hb += 1e9) + 600_000
  const { $, s } = holdDouble({ id: 'hold-3b', windows: [], pause: { kind: 'five_hour', percent: 99, resumeAt: reset, chats: [] } })
  await holdTick($)
  s.limits = { windows: [], pauseOff: reset }
  s.now += 2_000
  await deliver($, [{ id: 'r3', kind: 'prompt', text: 'Usage limit reset. Continue where you stopped; resume any subagents cut off with SendMessage.' }])
  await holdTick($)
  const holds = s.posts.map(p => JSON.parse(p)).filter(p => p.kind === 'hold').map(p => (p.hold ? 'hold' : 'lift'))
  expect(holds).toEqual(['hold', 'lift'])
  expect(await heldNow($)).toBeUndefined()
})
