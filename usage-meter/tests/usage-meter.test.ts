import { expect, test } from 'claude-code/testing'
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'

import { budgetDenial, pausedDenial } from '../hooks/company.ts'
import { creditsIn, deliver, dietOf, jevRun, ownerOf, poll } from '../hooks/feed.ts'
import { branchFor } from '../hooks/branch-name.ts'
import { endsAsking, handoffDenial, maybeHandoff, nearFull, notePlan, noteTasks, restoreFeed } from '../hooks/handoff.ts'
import { ensureOpenTasks, handoffNote, summaryOf } from '../hooks/handoff-note.ts'
import { discover, homeOf, norm, targetsOf } from '../hooks/hub.ts'
import { carryGoal, gateShell, indefiniteAsk, indefiniteDenial, indefiniteOn, indefiniteStop } from '../hooks/indefinite.ts'
import { heldNow, holdDenial, holdLine, holdTick, hubHold, noteActive, overLimit, untilText } from '../hooks/limits.ts'
import { agentFileModel, cleanReport, debugBrief, escalationNote, learnRun, memoryDir, pickModel, spawnModel, type Learned, type Run } from '../hooks/model.ts'
import { redact } from '../hooks/redact.ts'
import { liveShells, noteShell, shellsDone } from '../hooks/shells.ts'
import { codexDenial } from '../hooks/codex-first.ts'
import { register, timerWork } from '../hooks/register.ts'
import { st } from '../hooks/state.ts'

test('routes eligible engineer and qa starts to Codex once per brief', () => {
  const seen = new Set<string>(), windows = [
    { kind: 'codex_seven_day', percentUsed: 10, resetsAt: '2030-01-08T00:00:00.000Z' },
    { kind: 'codex_five_hour', percentUsed: 20, resetsAt: '2030-01-01T05:00:00.000Z' },
  ], claude = [{ kind: 'seven_day', percentUsed: 90 }]
  const input = { role: 'engineer', prompt: 'fix bug', session: 's1', enabled: true, roleFile: true, codex: windows, claude, now: 1_800_000_000_000, seen }
  expect(codexDenial(input)).toContain('Codex has 90% of its week left, Claude has 10% left')
  expect(codexDenial(input)).toBeUndefined()
  expect(codexDenial({ ...input, prompt: 'Claude only: browser needed' })).toBeUndefined()
  expect(codexDenial({ ...input, prompt: 'new brief', seen: new Set(), codex: windows.map(w => ({ ...w, percentUsed: 86 })) })).toBeUndefined()
  expect(codexDenial({ ...input, prompt: 'new brief', seen: new Set(), codex: windows.map(w => ({ ...w, resetsAt: '2000-01-01T00:00:00.000Z' })) })).toContain('Codex has 100% of its week left')
  expect(codexDenial({ ...input, prompt: 'new brief', seen: new Set(), codex: [] })).toBeUndefined()
})

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

test('discovery reads only workspace-hash and pid window files', async () => {
  const read: string[] = []
  const $ = {
    clock: { now: async () => 100_000 }, env: { get: async () => '/u' },
    fs: {
      list: async () => ['abc-123.json', 'workspaces.json', 'limits.json', 'bad-2x.json'].map(name => ({ name, kind: 'file', mtimeMs: 0 })),
      read: async (path: string) => { read.push(path); return JSON.stringify({ port: 1, workspace: '/u', hubToken: 't' }) },
    },
  } as unknown as EngineInterface
  const targets = await discover($)
  expect(targets.map(t => t.port)).toEqual([1])
  expect(read).toEqual(['/u/.claude/switchboard/abc-123.json'])
})

test('idle timer backs off, activity wakes it, and held ticks keep checking', async () => {
  expect(timerWork(29, false)).toEqual({ poll: true, hold: true })
  expect(timerWork(30, false)).toEqual({ poll: true, hold: true })
  expect(timerWork(31, false)).toEqual({ poll: false, hold: false })
  expect(timerWork(33, false)).toEqual({ poll: true, hold: false })
  expect(timerWork(31, true).hold).toBe(true)
  st.quietTicks = 40
  await noteActive({ clock: { now: async () => 123 } } as unknown as EngineInterface)
  expect(st.quietTicks).toBe(0)
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  register(((name: string, a: unknown, b: unknown) => { handlers.set(name, (b ?? a) as never); return { catch: () => undefined } }) as never)
  st.quietTicks = 40
  await handlers.get('agent.spawn')!({}, { resume: 'a1' }, async () => ({}))
  expect(st.quietTicks).toBe(0)
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

test('takes each role model from its agent file frontmatter', () => {
  expect(agentFileModel('---\nname: engineer\nmodel: opus\n---\nbody')).toBe('opus')
  expect(agentFileModel('---\nname: qa\nmodel: "sonnet" # cheap\n---\n')).toBe('sonnet')
  expect(agentFileModel('---\nname: x\nmodel: inherit\n---\n')).toBeUndefined()
  expect(agentFileModel('---\nname: x\n---\nmodel: opus in the body is no setting')).toBeUndefined()
  expect(agentFileModel('no frontmatter')).toBeUndefined()
})

test('reads a Report as clean only on a plain done, and spots debugging briefs', () => {
  expect(cleanReport('Report\nStatus: done\nChanged: a.ts')).toBe(true)
  expect(cleanReport('**Status:** done.')).toBe(true)
  expect(cleanReport('Status: done with concerns')).toBe(false)
  expect(cleanReport('Status: blocked')).toBe(false)
  expect(cleanReport('no report at all')).toBe(false)
  expect(debugBrief('Fix the failing test in board.tsx')).toBe(true)
  expect(debugBrief('Stack trace below')).toBe(true)
  expect(debugBrief('Redesign the card layout')).toBe(false)
  expect(debugBrief('Debugging the layout')).toBe(true)
  expect(debugBrief('errors in the console')).toBe(true)
  expect(debugBrief('tests fail on CI')).toBe(true)
  expect(debugBrief('two bugs in the parser')).toBe(true)
  expect(debugBrief('redesign the error banner')).toBe(false)
  expect(debugBrief('rework the crash screen look')).toBe(false)
})

const run = (o: Partial<Run> & { files: string[] }): Omit<Run, 'round'> => ({ role: 'designer', brief: 'Redesign board.tsx', model: 'sonnet', clean: false, ...o })

test('three redesign rounds on one component raise the role a step, then resolve and cool down', () => {
  const P = '/u/App'
  const runs: Run[] = []
  let learned: Learned[] = []
  const step = (r: Omit<Run, 'round'>, now = 1) => {
    const out = learnRun(runs, learned, r, P, now)
    runs.push({ ...r, round: out.round })
    learned = out.learned
    return out
  }
  step(run({ files: ['/u/App/web/board.tsx'] }))
  expect(step(run({ files: ['/u/App/web/board.tsx', '/u/App/web/board.css'] })).round).toBe(2)
  const third = step(run({ files: ['/u/App/web/board.css'] }), 5)
  expect(third.changed).toBe(true)
  expect(learned).toEqual([{ project: P, role: 'designer', files: ['web/board.css'], from: 'sonnet', to: 'opus', reason: '3 redesign rounds without a clean Report', at: 5 }])
  expect(pickModel('sonnet', 'designer', 'Polish web/board.css spacing', learned, P)).toBe('opus')
  expect(pickModel('sonnet', 'designer', 'Polish board.css spacing', learned, P)).toBe('sonnet')
  expect(pickModel('sonnet', 'designer', 'New login page', learned, P)).toBe('sonnet')
  expect(pickModel('sonnet', 'engineer', 'board.css', learned, P)).toBe('sonnet')
  expect(pickModel(undefined, 'designer', 'web/board.css', learned, P)).toBe('opus')
  expect(pickModel('fable', 'designer', 'board.css', learned, P)).toBe('fable')
  // The raised run ends clean: it is the fix.
  step(run({ files: ['/u/App/web/board.css'], model: 'claude-opus-5-5', clean: true }))
  expect(learned[0].resolvedBy).toBe('opus')
  for (let i = 0; i < 4; i++) step(run({ files: ['/u/App/web/board.css'], model: 'opus', clean: true }))
  expect(learned.length).toBe(1)
  // Fifth clean run at the raised level drops it back to where it started.
  step(run({ files: ['/u/App/web/board.css'], model: 'opus', clean: true }))
  expect(learned).toEqual([])
})

test('a brief names a component by its project-relative path, never a bare basename', () => {
  const learned: Learned[] = [{ project: '/u/App', role: 'engineer', files: ['src/x/index.ts'], from: 'sonnet', to: 'opus', reason: 'r', at: 1 }]
  expect(pickModel('sonnet', 'engineer', 'Rework src/x/index.ts exports', learned, '/u/App')).toBe('opus')
  expect(pickModel('sonnet', 'engineer', 'Rework index.ts exports', learned, '/u/App')).toBe('sonnet')
  expect(pickModel('sonnet', 'engineer', 'Rework src/y/index.ts exports', learned, '/u/App')).toBe('sonnet')
})

test('debugging, clean runs and other files never count as redesign churn', () => {
  const P = '/u/App'
  const chain = (rs: Omit<Run, 'round'>[]) => {
    const runs: Run[] = []
    let learned: Learned[] = []
    for (const r of rs) { const o = learnRun(runs, learned, r, P, 1); runs.push({ ...r, round: o.round }); learned = o.learned }
    return { runs, learned }
  }
  const f = ['/u/App/a.ts']
  expect(chain([run({ files: f }), run({ files: f, brief: 'fix the crash in a.ts' }), run({ files: f })]).learned).toEqual([])
  expect(chain([run({ files: f }), run({ files: f, clean: true }), run({ files: f }), run({ files: f })]).learned).toEqual([])
  expect(chain([run({ files: f }), run({ files: ['/u/App/b.ts'] }), run({ files: f })]).learned).toEqual([])
  // A qa run that found problems in between makes a clean run count as not clean.
  const qa = (clean: boolean) => run({ role: 'qa', files: [], clean })
  const done = run({ files: f, clean: true })
  expect(chain([done, qa(false), done, qa(false), run({ files: f })]).learned.length).toBe(1)
  expect(chain([done, qa(true), done, qa(true), run({ files: f })]).learned).toEqual([])
})

test('writes the escalations note with frontmatter for the project memory', () => {
  const note = escalationNote([{ project: '/u/App', role: 'designer', files: ['web/board.css'], from: 'sonnet', to: 'opus', reason: 'r', at: Date.parse('2026-11-11T00:00:00Z'), resolvedBy: 'opus' }])
  expect(note).toMatch(/^---\nname: Model escalations\ndescription: .+\nmetadata:\n {2}type: project\n---\n/)
  expect(note).toContain('- web/board.css: designer, sonnet failed 3 redesign rounds, opus fixed it (2026-11-11)')
  expect(memoryDir('/u', '/u/Documents/App')).toBe('/u/.claude/projects/-u-Documents-App/memory')
  expect(memoryDir('/u', '/u/my_app.v2')).toBe('/u/.claude/projects/-u-my-app-v2/memory')
})

test('a spawn runs on its agent file model, raised by what this project learned, and learns from reports', async ($, on) => {
  const files = new Map<string, string>([
    ['/u/.claude/agents/designer.md', '---\nname: designer\nmodel: sonnet\n---\n'],
    ['/u/.claude/agents/ops.md', '---\nname: ops\nmodel: inherit\n---\n'],
  ])
  let company = {}
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
  on('session.id', () => ({ value: 'chat-learn' }))
  on('session.cwd', () => ({ value: '/u/App' }))
  let now = Date.parse('2026-11-11T00:00:00Z')
  on('clock.now', () => ({ value: now }))
  on('clock.sleep', () => new Promise(() => {}))
  storeOn(on as never)
  on('fs.stat', (_, e) => (files.has(String(e.path)) ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } : Promise.reject(new Error('missing'))))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = String(e.path)
    if (p.endsWith('company.json')) return { value: JSON.stringify(company) }
    return files.has(p) ? { value: files.get(p) } : Promise.reject(new Error('missing'))
  })
  on('fs.write', (_, e) => { files.set(String(e.path), String(e.text)); return { value: undefined } })
  on('http.fetch', () => new Promise(() => {}))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'inherited', agentId: `a${++n}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (subagentType: string, prompt: string) => $.agent.spawn({ subagentType, prompt, description: 'x' } as never)
  const round = async (answer: string) => {
    const s = await spawn('designer', 'Redesign web/board.tsx')
    await $.tool.call({ tool: 'Edit', file_path: '/u/App/web/board.tsx', old_string: 'a', new_string: 'b', agentId: s.agentId } as never)
    await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: s.agentId } as never)
    return s
  }
  expect((await spawn('ops', 'notes')).model).toBe('inherited')
  expect((await spawn('bland:norm', 'x')).model).toBe('inherited')
  expect((await round('Status: done with concerns')).model).toBe('sonnet')
  // a sent-back round reruns a step up, so the third failed round is on opus
  expect((await round('Status: blocked')).model).toBe('opus')
  await round('Status: done with concerns')
  const learned = JSON.parse(files.get('/u/.claude/switchboard/model-learn.json') ?? '[]')
  expect(learned[0]).toMatchObject({ project: '/u/App', role: 'designer', files: ['web/board.tsx'], from: 'opus', to: 'fable' })
  expect(files.get('/u/.claude/projects/-u-App/memory/model-escalations.md')).toContain('web/board.tsx: designer, opus failed 3 redesign rounds')
  expect(files.get('/u/.claude/projects/-u-App/memory/MEMORY.md')).toContain('(model-escalations.md)')
  const ledger = (files.get('/u/.claude/switchboard/smart-picks.d/chat-learn-meter.jsonl') ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const fin = ledger.find(r => r.t === 'final' && r.kind === 'model')
  expect(fin).toMatchObject({ final: 'fable', session: 'chat-learn' })
  expect(ledger.some(r => r.t === 'pick' && r.key === fin.key)).toBe(true)
  expect((await spawn('designer', 'Tidy web/board.tsx')).model).toBe('fable')
  // Smart switch off: the agent file alone.
  company = { smartModelSwitch: false }
  now += 11_000
  expect((await spawn('designer', 'Tidy web/board.tsx')).model).toBe('sonnet')
})

test('a spawn logs role and model picks; an escalation logs the model final', async ($, on) => {
  const files = new Map<string, string>([['/u/.claude/agents/designer.md', '---\nname: designer\nmodel: sonnet\n---\n']])
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
  on('session.id', () => ({ value: 'chat-smart' }))
  on('session.cwd', () => ({ value: '/u/App' }))
  on('clock.now', () => ({ value: Date.parse('2026-11-11T00:00:00Z') }))
  on('clock.sleep', () => new Promise(() => {}))
  storeOn(on as never)
  on('fs.stat', (_, e) => (files.has(String(e.path)) ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } : Promise.reject(new Error('missing'))))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => (files.has(String(e.path)) ? { value: files.get(String(e.path)) } : Promise.reject(new Error('missing'))))
  on('fs.write', (_, e) => { files.set(String(e.path), String(e.text)); return { value: undefined } })
  on('http.fetch', () => new Promise(() => {}))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'inherited', agentId: `a${++n}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  const rows = () => (files.get('/u/.claude/switchboard/smart-picks.d/chat-smart-meter.jsonl') ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))
  files.set('/u/.claude/switchboard/smart-picks.jsonl', '{"t":"pick","session":"ext"}\n')
  const s = await $.agent.spawn({ subagentType: 'designer', prompt: 'Fix the crash in web/board.tsx', description: 'x' } as never)
  expect(rows()).toEqual([
    expect.objectContaining({ t: 'pick', kind: 'role', task: 'fix', pick: 'designer', session: 'chat-smart', cwd: '/u/App' }),
    expect.objectContaining({ t: 'pick', kind: 'model', task: 'fix', pick: 'sonnet', why: expect.stringContaining('Auto: ') }),
  ])
  // the shared ledger is the extension's: never rewritten from here
  expect(files.get('/u/.claude/switchboard/smart-picks.jsonl')).toBe('{"t":"pick","session":"ext"}\n')
  // a model the Agent call sets is logged as such, with the platform's swap as a final
  await $.agent.spawn({ subagentType: 'ops', prompt: 'notes', description: 'x', model: 'haiku' } as never)
  expect(rows().slice(2).map(r => [r.kind, r.pick ?? r.final, r.why])).toEqual([['role', 'ops', 'ops for a other task'], ['model', 'haiku', 'set by the Agent call']])
  // learned stats move the model pick
  files.set('/u/.claude/switchboard/smart-learned.json', JSON.stringify({ stats: { model: { fix: { sonnet: { n: 10, useful: 2 }, opus: { n: 8, useful: 8 } } } } }))
  const learned = await $.agent.spawn({ subagentType: 'designer', prompt: 'Fix the crash in web/board.tsx', description: 'x' } as never)
  expect(learned.model).toBe('opus')
  expect(rows().filter(r => r.kind === 'model').at(-1)).toMatchObject({ pick: 'opus', why: 'learned: opus kept 100% of 8' })
  void s
})

test('keeps another chat\'s learned entry when its write lands over ours', async ($, on) => {
  const files = new Map<string, string>([
    ['/u/.claude/agents/designer.md', '---\nname: designer\nmodel: sonnet\n---\n'],
    ['/u/.claude/agents/ops.md', '---\nname: ops\nmodel: inherit\n---\n'],
  ])
  let company = {}
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
  on('session.id', () => ({ value: 'chat-learn' }))
  on('session.cwd', () => ({ value: '/u/App' }))
  let now = Date.parse('2026-11-11T00:00:00Z')
  on('clock.now', () => ({ value: now }))
  on('clock.sleep', () => new Promise(() => {}))
  storeOn(on as never)
  on('fs.stat', (_, e) => (files.has(String(e.path)) ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } : Promise.reject(new Error('missing'))))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = String(e.path)
    if (p.endsWith('company.json')) return { value: JSON.stringify(company) }
    return files.has(p) ? { value: files.get(p) } : Promise.reject(new Error('missing'))
  })
  const other = { project: '/u/Other', role: 'qa', files: ['x.ts'], from: 'sonnet', to: 'opus', reason: 'r', at: 1 }
  let clobbered = false
  on('fs.write', (_, e) => {
    const p = String(e.path)
    files.set(p, String(e.text))
    // another chat's stale write lands once, after ours, holding only its own entry
    if (p.endsWith('model-learn.json') && !clobbered) { clobbered = true; files.set(p, JSON.stringify([other])) }
    return { value: undefined }
  })
  on('http.fetch', () => new Promise(() => {}))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'inherited', agentId: `a${++n}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  const spawn = (subagentType: string, prompt: string) => $.agent.spawn({ subagentType, prompt, description: 'x' } as never)
  const round = async (answer: string) => {
    const s = await spawn('designer', 'Redesign web/board.tsx')
    await $.tool.call({ tool: 'Edit', file_path: '/u/App/web/board.tsx', old_string: 'a', new_string: 'b', agentId: s.agentId } as never)
    await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: s.agentId } as never)
    return s
  }
  await round('Status: done with concerns')
  await round('Status: blocked')
  await round('Status: done with concerns')
  const learned = JSON.parse(files.get('/u/.claude/switchboard/model-learn.json') ?? '[]')
  expect(learned.map((l: { project: string }) => l.project).sort()).toEqual(['/u/App', '/u/Other'])
})

test('advanced mode for this project tells the lead to follow the stages skill', async ($, on) => {
  on('session.id', () => ({ value: 'chat-stage-1' }))
  let company: unknown = {}
  let now = 1e12
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
  on('session.cwd', () => ({ value: '/u/App' }))
  on('clock.now', () => ({ value: now }))
  on('fs.read', (_, e) => (String(e.path).endsWith('company.json') ? { value: JSON.stringify(company) } : Promise.reject(new Error('missing'))))
  on('prompt.compose', () => ({ sections: [] }))
  const compose = async () => JSON.stringify(await $.prompt.compose({ sections: [], promptModel: 'opus', outputStyle: null, tools: [], traits: [], surfaces: [] } as never))
  expect(await compose()).not.toContain('stages')
  company = { advancedMode: { '/u/Other': true } }
  now += 11_000
  expect(await compose()).not.toContain('stages')
  company = { advancedMode: { '/u/App': true } }
  now += 11_000
  expect(await compose()).toContain('`stages` skill')
  expect(await compose()).toContain("this chat's id is chat-stage-1")
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
        : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : String(e.path).endsWith('company.json') ? '{"paused":true}' : '' }))
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
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u', hubToken: 't' }) : '' }))
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
      list: async (dir: string) => (dir.includes('plans') ? [{ name: 'newer.md', kind: 'file', mtimeMs: 9 }] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' })
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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

test('redact covers Authorization, Basic, url passwords with @, short stripe keys and two-part JWTs', () => {
  const cases: Array<[string, string]> = [
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpw'],
    ['Authorization: Token abcdefgh123', 'abcdefgh123'],
    ['curl -H "Authorization: abcdefgh123"', 'abcdefgh123'],
    ['Basic dXNlcjpwYXNzd29yZA== sent', 'dXNlcjpw'],
    ['postgres://admin:p@ss@word@db.local/app', 'word'],
    ['pk' + '-abcdefghijklmnop1234', 'abcdefghijklmnop'],
    ['pay ' + 'pk' + '_live_abc123', 'abc123'],
    ['jwt ' + 'eyJ' + 'abcdefghij.klmnopqrst', 'klmnopqrst'],
  ]
  for (const [text, bad] of cases) {
    const clean = redact(text)
    expect(clean.includes(bad)).toBe(false)
    expect(clean).toContain('[removed]')
  }
  expect(redact('Basic authentication is old')).toBe('Basic authentication is old')
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
    ['gh gh' + 'o_0123456789abcdefghij0123456789ABCD', 'gho_0123'],
    ['pat github_pat_11ABCDEFG0123456789_abcdefghij', 'github_pat_11'],
    ['slack xo' + 'xp-1234-5678-abcdefghijkl', 'xoxp-1234'],
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
  noteShell('Bash', { command: 'pnpm dev', timeout: 3000 }, { backgroundTaskId: 'b3' }, '')
  expect(liveShells()).toEqual([{ id: 'b1', command: 'npm run dev', output: '/t/b1.output' }, { id: 'b2', command: 'sleep 9' }, { id: 'b3', command: 'pnpm dev' }])
  noteShell('TaskStop', { task_id: 'b1' }, {}, '')
  noteShell('TaskStop', { task_id: 'b3' }, {}, '')
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
  const order = ['Recreate every open task', '## Last request, verbatim', '## Goal', 'Ship the handoff', '## State', 'Tests last run: pnpm test, 40 pass', '## Decisions', '- wait for shells: they do not carry over', '## Open tasks', '- [ ] Test it (in progress)', '## Running work', 'The old chat may still be running these', '- shell b1: npm run dev, output /t/b1.output', '## Subagent results', '## Files touched', 'src/a.ts', '## Next action', 'run qa', '## Earlier requests', '> never commit', 'Old transcript: /u/.claude/projects/-u-Armasu/abcdef123456.jsonl']
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
  on('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
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
  on('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
function pauseRig(on: (op: never, fn: never) => void, id: string, o: { tokens: () => number; keep: () => { status: number; text: string }; agents?: () => unknown[]; transcript?: string; store?: Record<string, unknown>; now?: () => number; prompts: string[]; posts: string[]; notes: string[] }) {
  const h = on as unknown as (op: string, fn: (_: unknown, e: Record<string, any>) => unknown) => void
  h('env.get', () => ({ value: '/u' }))
  h('session.id', () => ({ value: id }))
  h('session.cwd', () => ({ value: '/u/Armasu' }))
  h('session.root', () => ({ value: '/u/Armasu' }))
  h('session.usage', () => ({ value: { context: { tokens: o.tokens(), breakdown: { autoCompactThreshold: 167_000 } }, rateLimits: [], startedAt: 0 } }))
  h('clock.now', () => ({ value: o.now?.() ?? 9.95e12 }))
  h('agent.list', () => ({ value: o.agents?.() ?? [] }))
  // tail -c N on the chat's transcript: its last N characters.
  h('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'tail' && e.argv[3] === `/u/.claude/projects/-u-Armasu/${id}.jsonl` ? (o.transcript ?? '').slice(-Number(e.argv[2])) : '', stderr: '' } }))
  h('fs.list', (_, e) => ({ value: String(e.path).includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  h('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
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
  storeOn(on as never, o.store)
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

const absorbedFor = (id: string) => JSON.stringify({ type: 'queue-operation', operation: 'remove', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`, reason: 'absorbed_mid_turn' })

test('only the transcript tail is scanned for absorbed notices: one further back is missed', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  const transcript = `${absorbedFor('old1')}\n${'x'.repeat(2_100_000)}\n${absorbedFor('new1')}\n`
  pauseRig(on as never, 'chat-absorb-2', { ...o, transcript, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }) })
  let id = 'old1'
  on('tool.call', () => ({ result: { backgroundTaskId: id } }))
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
  id = 'new1'
  await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(o.prompts[0]).toContain('old1')
  expect(o.prompts[0].includes('new1')).toBe(false)
})

test('a shell whose notice was absorbed mid turn is not listed as running', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-absorb-1', { ...o, transcript: `{"type":"user"}\n${absorbedFor('gone1')}\n`, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }) })
  let id = 'gone1'
  on('tool.call', () => ({ result: { backgroundTaskId: id } }))
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
  id = 'live1'
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(o.prompts[0]).toContain('live1')
  expect(o.prompts[0].includes('gone1')).toBe(false)
})

test('the pause prompt asks running subagents to report before any TaskStop', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-pause-ask', { ...o, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }), agents: () => [{ id: 'e1', type: 'engineer', description: 'x', status: 'running' }] })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(o.prompts[0]).toContain('SendMessage each running subagent to stop new edits, leave its files type-clean and report done vs not done; wait for the reports, and TaskStop only one that does not answer.')
  expect(o.prompts[0].includes('Wait for running subagents')).toBe(false)
})

test('a note with no recorded tasks says so and lists subagents stopped by TaskStop', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-stopped-1', { ...o, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }) })
  on('tool.call', () => ({ result: { message: 'stopped', task_id: 'ag7', task_type: 'local_agent' } }))
  await $.prompt.submit({ text: 'wrap it up' })
  await $.tool.call({ tool: 'TaskStop', task_id: 'ag7' } as never)
  const end = () => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  await end()
  const note = o.notes.join('')
  expect(note).toContain('## Open tasks\n\n- stopped: ag7')
  expect(note).toContain('agent-ag7.jsonl')
  expect(note).toContain('- none recorded (task tools may be missing in that chat); check Subagent results and Next action')
  expect(handoffNote({ ...FULL, tasks: [{ subject: 'Done one', status: 'completed' }] })).toContain('## Open tasks\n\n- none\n')
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
    { name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    { name: 'b-2.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
  ] }))
  on('fs.read', (_, e) => ({ value: JSON.stringify({ port: String(e.path).endsWith('a-1.json') ? 1 : 2, workspace: '/Users/k/Frozen', hubToken: 't' }) }))
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
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u', hubToken: 't' }) : '' }))
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
      list: async (dir: string) => (dir.includes('plans') ? [] : [{ name: 'a-1.json', kind: 'file' }]),
      read: async (path: string) => (path.endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : ''),
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
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
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
    session: { id: async () => o.id, cwd: async () => '/proj', usage: async () => ({ cost: o.cost === undefined ? undefined : { usd: o.cost } }) },
    process: { run: async (argv: string[], init: { cwd?: string; timeoutMs?: number }) => { s.runs.push({ argv, init }); return o.run ? o.run(argv, init) : { exitCode: 0, stdout: '', stderr: '' } } },
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

test('a chat whose turn ended just before the hold started is resumed at the reset', async () => {
  const reset = (hb += 1e9) + 3_600_000
  const { $, s } = holdDouble({ id: 'hold-4', windows: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] })
  // Last tool call and turn end ran before the hold: no call was ever denied.
  await noteActive($)
  s.now += 4 * 60_000
  await holdTick($)
  s.now = reset + 11_000
  await holdTick($)
  await holdTick($)
  expect(s.prompts.length).toBe(1)
  expect(s.prompts[0]).toMatch(/^Switchboard: usage limit reset\. Carry on from where you stopped/)
  expect(s.toasts).toEqual(['Resumed: limit reset'])
})

test('a chat idle long before the limit is unpaused at the reset but sent no prompt', async () => {
  const reset = (hb += 1e9) + 3_600_000
  const { $, s } = holdDouble({ id: 'hold-5', windows: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(reset).toISOString() }] })
  await noteActive($)
  s.now += 30 * 60_000
  await holdTick($)
  s.now = reset + 11_000
  await holdTick($)
  expect(s.prompts).toEqual([])
  expect(s.toasts).toEqual(['Usage limit reset: unpaused'])
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

// pauseRig's clock is 9.95e12; this hold resets an hour later.
const seedHold = (id: string) => ({ hold: { id, hold: { kind: 'five_hour', percent: 99, resetsAt: 9.95e12 + 3_600_000, mid: true } } })

test('a held chat with open tasks is not nudged to keep working: each nudge is a paid turn the hold denies', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  pauseRig(on as never, 'chat-held-1', { ...o, tokens: () => 40_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }), store: { ...seedHold('chat-held-1'), feeds: { 'chat-held-1': { tasks: [['h1', { subject: 'Wire the hook', status: 'in_progress' }]], at: 1 } } } })
  // Tasks made before the hold: the hold denies TaskCreate itself.
  const end = () => $.turn.complete({ answer: 'Stopping here.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  await end()
  expect(o.prompts).toEqual([])
})

test('a held chat near full gets no wrap-up and no handoff until the hold lifts', async ($, on) => {
  const o = { prompts: [] as string[], posts: [] as string[], notes: [] as string[] }
  let now = 9.95e12
  pauseRig(on as never, 'chat-held-2', { ...o, tokens: () => 152_000, keep: () => ({ status: 200, text: '{"onFull":"fresh"}' }), store: seedHold('chat-held-2'), now: () => now })
  const end = () => $.turn.complete({ answer: 'Stopping here.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await end()
  await end()
  expect(o.prompts).toEqual([])
  expect(o.posts.some(p => p.includes('"kind":"handoff"'))).toBe(false)
  // Past the reset the next settle wraps up as usual.
  now += 3_600_001
  await end()
  expect(o.prompts.some(p => /clean pause/i.test(p))).toBe(true)
})

let ind = 1e12
function indDouble(o: { id: string; flags: Record<string, unknown> | 'bad' | undefined; answer?: string; cost?: number; goal?: string; root?: string; cwd?: string; run?: (argv: string[], init: { cwd?: string; timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }> }) {
  ind += 60_000
  const s = { posts: [] as string[], runs: [] as { argv: string[]; init: { cwd?: string; timeoutMs?: number } }[], store: {} as Record<string, unknown>, now: ind }
  const $ = {
    clock: { now: async () => s.now },
    session: { id: async () => o.id, cwd: async () => o.cwd ?? '/proj', ...(o.root ? { root: async () => o.root } : {}), usage: async () => ({ cost: o.cost === undefined ? undefined : { usd: o.cost } }) },
    process: { run: async (argv: string[], init: { cwd?: string; timeoutMs?: number }) => { s.runs.push({ argv, init }); return o.run ? o.run(argv, init) : { exitCode: 0, stdout: '', stderr: '' } } },
    env: { get: async () => '/u' },
    store: { get: async (k: string) => s.store[k], set: async (k: string, v: unknown) => { s.store[k] = JSON.parse(JSON.stringify(v)) } },
    fs: {
      list: async () => [{ name: 'a-1.json', kind: 'file' }],
      read: async (p: string) => {
        if (p.endsWith('indefinite.json')) { if (o.flags === undefined) throw new Error('missing'); return o.flags === 'bad' ? '{nope' : JSON.stringify(o.flags) }
        if (p.endsWith('/.switchboard/goals/' + o.id + '.md')) { if (o.goal === undefined) throw new Error('missing'); return o.goal }
        if (p.endsWith('limits.json')) return '{}'
        return JSON.stringify({ port: 1, workspace: '/u', hubToken: 't' })
      },
    },
    http: { fetch: async (_: string, init?: { body?: string }) => { if (init?.body) s.posts.push(init.body); return { status: 204, ok: true, text: '' } } },
  } as unknown as EngineInterface
  return { $, s }
}

test('run indefinitely reads the flag file for this chat, missing or bad means off', async () => {
  expect(gateShell('npm test', true)).toEqual(['cmd.exe', '/d', '/s', '/c', 'npm test'])
  expect(gateShell('npm test', false)).toEqual(['/bin/sh', '-c', 'npm test'])
  expect(await indefiniteOn(indDouble({ id: 'i1', flags: { i1: 5, other: 9 } }).$)).toBe(5)
  expect(await indefiniteOn(indDouble({ id: 'i2', flags: { i1: 5 } }).$)).toBeUndefined()
  expect(await indefiniteOn(indDouble({ id: 'i3', flags: 'bad' }).$)).toBeUndefined()
  expect(await indefiniteOn(indDouble({ id: 'i4', flags: undefined }).$)).toBeUndefined()
})

test('run indefinitely blocks a stop until the answer ends with the done line', async () => {
  const off = indDouble({ id: 'j0', flags: {} })
  expect(await indefiniteStop(off.$, 'all fixed')).toBeUndefined()
  const { $, s } = indDouble({ id: 'j1', flags: { j1: 7 } })
  const block = await indefiniteStop($, 'fixed two bugs')
  expect(block).toMatch(/^Run indefinitely is on\. Do another round/)
  expect(block).toContain('Run indefinitely: done')
  expect(block).not.toContain('\u2014')
  expect(await indefiniteStop($, 'again')).toMatch(/^Run indefinitely is on/)
  expect(s.posts).toEqual([])
  expect(await indefiniteStop($, 'Nothing left.\nRun indefinitely: done  \n')).toBeUndefined()
  expect(s.posts.some(p => p.includes('"kind":"indefinite-done"') && p.includes('"sessionId":"j1"'))).toBe(true)
  // the flag file may lag the hub: the chat is off for good from here
  expect(await indefiniteDenial($, 'AskUserQuestion')).toBeUndefined()
  expect(await indefiniteStop($, 'more')).toBeUndefined()
})

test('run indefinitely does not block while paused for a usage limit', async () => {
  const { $, s } = indDouble({ id: 'k1', flags: { k1: 7 } })
  s.store.hold = { id: 'k1', hold: { resetsAt: s.now + 3_600_000, percent: 99, kind: 'five_hour' } }
  expect(await indefiniteStop($, 'stopping for the limit')).toBeUndefined()
})

test('run indefinitely denies asking after the first stop, not before', async () => {
  const f: Record<string, number> = {}
  const { $, s } = indDouble({ id: 'l1', flags: f })
  f.l1 = s.now
  // up-front round
  expect(await indefiniteDenial($, 'AskUserQuestion')).toBeUndefined()
  expect(await indefiniteDenial($, 'mcp__switchboard__ask')).toMatch(/^Run indefinitely is on: decide yourself/)
  await indefiniteStop($, 'round one done')
  const why = 'Run indefinitely is on: decide yourself and say what you decided.'
  expect(await indefiniteDenial($, 'AskUserQuestion')).toBe(why)
  expect(await indefiniteDenial($, 'mcp__switchboard__ask')).toBe(why)
  expect(await indefiniteDenial($, 'Bash')).toBeUndefined()
  expect(await indefiniteDenial(indDouble({ id: 'l2', flags: {} }).$, 'AskUserQuestion')).toBeUndefined()
})

test('a handoff chat with an old flag gets no second up-front round', async () => {
  const f: Record<string, number> = {}
  const { $, s } = indDouble({ id: 'h1', flags: f })
  f.h1 = s.now - 3_600_000
  expect(await indefiniteDenial($, 'AskUserQuestion')).toMatch(/^Run indefinitely is on: decide yourself/)
})

test('run indefinitely swaps the ask rule', async () => {
  expect(await indefiniteAsk(indDouble({ id: 'm1', flags: { m1: 1 } }).$)).toMatch(/decide yourself/i)
  expect(await indefiniteAsk(indDouble({ id: 'm2', flags: {} }).$)).toBeUndefined()
})

const doneOf = (posts: string[]) => posts.map(p => JSON.parse(p)).filter(p => p.kind === 'indefinite-done')

test('run indefinitely reads the object flag shape and the plain number', async () => {
  expect(await indefiniteOn(indDouble({ id: 'o1', flags: { o1: { onAt: 5, maxHours: 2 } } }).$)).toBe(5)
  expect(await indefiniteOn(indDouble({ id: 'o2', flags: { o2: { maxHours: 2 } } }).$)).toBeUndefined()
})

test('a passing gate lets the stop through and says so', async () => {
  const { $, s } = indDouble({ id: 'g1', flags: { g1: { onAt: 1e12, gate: 'pnpm test' } }, cost: 1.234 })
  expect(await indefiniteStop($, 'round done')).toBeUndefined()
  expect(s.runs[0].argv).toEqual(['/bin/sh', '-c', 'pnpm test'])
  expect(s.runs[0].init).toMatchObject({ cwd: '/proj', timeoutMs: 600_000 })
  const [d] = doneOf(s.posts)
  expect(d.reason).toBe('gate passed: pnpm test')
  expect(d.usage).toMatch(/^used \$1\.23 over \d+(\.\d+)?h$/)
  expect(await indefiniteStop($, 'again')).toBeUndefined()
})

test('a failing gate output is redacted before it reaches the prompt', async () => {
  const { $ } = indDouble({ id: 'g9', flags: { g9: { onAt: 1e12, gate: 'make check' } }, run: async () => ({ exitCode: 1, stdout: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', stderr: '' }) })
  const block = await indefiniteStop($, 'round done')
  expect(block).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  expect(block).toContain('[removed]')
})

test('a hold does not use up the up-front ask round', async () => {
  const f: Record<string, number> = {}
  const { $, s } = indDouble({ id: 'q1', flags: f })
  f.q1 = s.now
  s.store.hold = { id: 'q1', hold: { resetsAt: s.now + 3_600_000, percent: 99, kind: 'five_hour' } }
  expect(await indefiniteStop($, 'paused')).toBeUndefined()
  expect(await indefiniteDenial($, 'AskUserQuestion')).toBeUndefined()
})

test('a failing gate keeps going with the last 20 lines of output', async () => {
  const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
  const { $, s } = indDouble({ id: 'g2', flags: { g2: { onAt: 1e12, gate: 'make check' } }, run: async () => ({ exitCode: 1, stdout: out, stderr: '' }) })
  const block = await indefiniteStop($, 'round done')
  expect(block).toMatch(/^Run indefinitely is on\. Do another round/)
  expect(block).toContain('make check')
  expect(block).toContain('line 30')
  expect(block).toContain('line 11')
  expect(block).not.toContain('line 10\n')
  expect(doneOf(s.posts)).toEqual([])
})

test('a gate that cannot run or times out counts as failing', async () => {
  const { $ } = indDouble({ id: 'g3', flags: { g3: { onAt: 1e12, gate: 'x' } }, run: async () => { throw new Error('timed out') } })
  expect(await indefiniteStop($, 'r')).toContain('timed out')
})

test('a cost or hours cap lets the stop through as not a success', async () => {
  const c = indDouble({ id: 'b1', flags: { b1: { onAt: 1e12, maxCostUsd: 5 } }, cost: 5.01 })
  expect(await indefiniteStop(c.$, 'r')).toBeUndefined()
  expect(doneOf(c.s.posts)[0].reason).toBe('budget reached (not a success)')
  const under = indDouble({ id: 'b2', flags: { b2: { onAt: 1e12, maxCostUsd: 5 } }, cost: 1 })
  expect(await indefiniteStop(under.$, 'r')).toMatch(/^Run indefinitely is on/)
  const h = indDouble({ id: 'b3', flags: { b3: { onAt: 1, maxHours: 1 } } })
  expect(await indefiniteStop(h.$, 'r')).toBeUndefined()
  expect(doneOf(h.s.posts)[0].reason).toBe('budget reached (not a success)')
})

test('a failing gate at the cap still stops, and the gate wins when it passes', async () => {
  const fail = indDouble({ id: 'b4', flags: { b4: { onAt: 1e12, maxCostUsd: 1, gate: 'g' } }, cost: 2, run: async () => ({ exitCode: 2, stdout: 'no', stderr: '' }) })
  expect(await indefiniteStop(fail.$, 'r')).toBeUndefined()
  expect(doneOf(fail.s.posts)[0].reason).toBe('budget reached (not a success)')
  const pass = indDouble({ id: 'b5', flags: { b5: { onAt: 1e12, maxCostUsd: 1, gate: 'g' } }, cost: 2 })
  await indefiniteStop(pass.$, 'r')
  expect(doneOf(pass.s.posts)[0].reason).toBe('gate passed: g')
})

test('with no limits the done line still posts a usage line and no reason', async () => {
  const { $, s } = indDouble({ id: 'u1', flags: { u1: 1e12 }, cost: 2 })
  expect(await indefiniteStop($, 'r')).toMatch(/^Run indefinitely is on/)
  expect(s.runs).toEqual([])
  await indefiniteStop($, 'x\nRun indefinitely: done')
  const [d] = doneOf(s.posts)
  expect(d.reason).toBeUndefined()
  expect(d.usage).toContain('used $2.00')
})

test('a /goal file steers each round at the goal and its check is the gate', async () => {
  const goal = '# Goal\n\nLogin works.\n\nCheck: `pnpm test auth`\n'
  const { $, s } = indDouble({ id: 'q1', flags: { q1: 7 }, goal, run: async () => ({ exitCode: 1, stdout: 'auth failed', stderr: '' }) })
  const block = await indefiniteStop($, 'round one')
  expect(block).toContain('/proj/.switchboard/goals/q1.md')
  expect(block).toContain('Run indefinitely: done')
  expect(block).not.toMatch(/audit the project/)
  expect(block).toContain('auth failed')
  expect(s.runs[0].argv).toEqual(['/bin/sh', '-c', 'pnpm test auth'])
})

test('a goal check passing ends the run; the hub gate still wins over it', async () => {
  const ok = indDouble({ id: 'q2', flags: { q2: 7 }, goal: 'Check: `make check`' })
  expect(await indefiniteStop(ok.$, 'done?')).toBeUndefined()
  expect(doneOf(ok.s.posts)[0].reason).toBe('gate passed: make check')
  const hub = indDouble({ id: 'q3', flags: { q3: { onAt: 7, gate: 'pnpm test' } }, goal: 'Check: `make check`' })
  await indefiniteStop(hub.$, 'done?')
  expect(hub.s.runs[0].argv[2]).toBe('pnpm test')
})

test('a goal with no check keeps the done line as the only way out', async () => {
  const { $, s } = indDouble({ id: 'q4', flags: { q4: 7 }, goal: 'Just make it fast.' })
  expect(await indefiniteStop($, 'faster')).toContain('goals/q4.md')
  expect(s.runs).toEqual([])
})

test('a chat in a subfolder finds the goal at the project root and runs its Check there', async () => {
  const { $, s } = indDouble({ id: 'q5', flags: { q5: 7 }, root: '/proj', cwd: '/proj/web', goal: 'Check: `make check`', run: async () => ({ exitCode: 1, stdout: 'no', stderr: '' }) })
  expect(await indefiniteStop($, 'round')).toContain('/proj/.switchboard/goals/q5.md')
  expect(s.runs[0].init.cwd).toBe('/proj')
})

test('the done line cannot end a goal run while its Check fails', async () => {
  const bad = indDouble({ id: 'q6', flags: { q6: 7 }, goal: 'Check: `make check`', run: async () => ({ exitCode: 1, stdout: 'still broken', stderr: '' }) })
  const block = await indefiniteStop(bad.$, 'All good.\nRun indefinitely: done')
  expect(block).toContain('still broken')
  expect(doneOf(bad.s.posts)).toEqual([])
  const ok = indDouble({ id: 'q7', flags: { q7: 7 }, goal: 'Check: `make check`' })
  expect(await indefiniteStop(ok.$, 'Run indefinitely: done')).toBeUndefined()
  expect(doneOf(ok.s.posts).length).toBe(1)
})

test('a fresh chat takes over the goal of the chat that handed off to it', async () => {
  const files: Record<string, string> = { '/proj/.switchboard/goals/abcd1234-old.md': 'Check: `make check`' }
  const $ = {
    session: { id: async () => 'new-id', cwd: async () => '/proj/web', root: async () => '/proj' },
    fs: {
      list: async () => [{ name: 'abcd1234-old.md', kind: 'file' }, { name: 'zzzz.md', kind: 'file' }],
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing') },
      write: async (p: string, v: string) => { files[p] = v },
    },
  } as unknown as EngineInterface
  expect(await carryGoal($, '/u/.claude/handoffs/proj/2026-11-14-1200-proj-x-abcd1234.md')).toBe('/proj/.switchboard/goals/new-id.md')
  expect(files['/proj/.switchboard/goals/new-id.md']).toBe('Check: `make check`')
  expect(await carryGoal($, '/u/.claude/handoffs/proj/note-ffff0000.md')).toBeUndefined()
})

test('the ask rule under Run indefinitely asks everything up front, then decides', async () => {
  const rule = await indefiniteAsk(indDouble({ id: 'm3', flags: { m3: 1 } }).$)
  expect(rule).toMatch(/one AskUserQuestion round/)
  expect(rule).toMatch(/after that, decide yourself/i)
})

test('a spawn is auto-picked from its brief, an explicit model wins, the 5h gate holds the top models', async ($, on) => {
  const files = new Map<string, string>([
    ['/u/.claude/agents/engineer.md', '---\nname: engineer\nmodel: sonnet\n---\n'],
    ['/u/.claude/agents/ops.md', '---\nname: ops\nmodel: inherit\n---\n'],
  ])
  let company: unknown = {}
  let five = 10
  let resetsAt = '2026-11-20T03:00:00Z'
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/u' : undefined }))
  on('session.id', () => ({ value: 'chat-pick' }))
  on('session.cwd', () => ({ value: '/u/App' }))
  let now = Date.parse('2026-11-20T00:00:00Z')
  on('clock.now', () => ({ value: now }))
  on('clock.sleep', () => new Promise(() => {}))
  storeOn(on as never)
  on('fs.stat', (_, e) => (files.has(String(e.path)) ? { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } } : Promise.reject(new Error('missing'))))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = String(e.path)
    if (p.endsWith('company.json')) return { value: JSON.stringify(company) }
    if (p.endsWith('limits.json')) return { value: JSON.stringify({ windows: [{ kind: 'five_hour', percentUsed: five, resetsAt }] }) }
    return files.has(p) ? { value: files.get(p) } : Promise.reject(new Error('missing'))
  })
  on('fs.write', (_, e) => { files.set(String(e.path), String(e.text)); return { value: undefined } })
  on('http.fetch', () => new Promise(() => {}))
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'inherited', agentId: 'a1' }))
  const spawn = (subagentType: string, prompt: string, model?: string) => $.agent.spawn({ subagentType, prompt, description: 'x', model } as never)
  const hard = 'rewrite the scheduler as a state machine and find the root cause of the deadlock in extension/src/hub/todo.ts'
  expect((await spawn('engineer', 'add a field to the form in web/form.tsx')).model).toBe('sonnet')
  expect((await spawn('engineer', 'rename hubState to hub in extension/src/hub/routes.ts')).model).toBe('haiku')
  expect((await spawn('engineer', 'fix the race in chat-wait where two chats write links.json at once')).model).toBe('opus')
  expect((await spawn('engineer', hard)).model).toBe('fable')
  expect((await spawn('engineer', hard, 'haiku')).model).toBe('haiku')
  expect((await spawn('ops', 'write notes')).model).toBe('inherited')
  expect((await spawn('bland:norm', 'rewrite everything')).model).toBe('inherited')
  five = 72
  now += 11_000
  expect((await spawn('engineer', hard)).model).toBe('opus')
  resetsAt = '2026-11-19T23:00:00Z'
  now += 11_000
  expect((await spawn('engineer', hard)).model).toBe('fable')
  company = { smartModelSwitch: false }
  now += 11_000
  expect((await spawn('engineer', 'rename hubState to hub in extension/src/hub/routes.ts')).model).toBe('sonnet')
})

test('the first prompt of a chat that reads like research is offered to the home window, once', async ($, on) => {
  const asked: string[] = []
  let cwd = '/u/App'
  let id = 'chat-research-1'
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9.2e12 }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: id }))
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u', hubToken: 't' }) : '' }))
  on('http.fetch', (_, e) => { asked.push(String(e.url)); return { value: { status: 200, ok: true, headers: {}, text: '' } } })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  storeOn(on as never)
  const offers = () => asked.filter(u => u.includes('/hub/research-offer'))
  const send = async (text: string) => { await $.prompt.submit({ text }); await new Promise(r => setTimeout(r, 20)) }
  await send('fix the typo in web/page.tsx')
  expect(offers()).toEqual([])
  id = 'chat-research-2'
  await send('look up how other tools route models and compare them, with sources')
  expect(offers().length).toBe(1)
  const q = JSON.parse(decodeURIComponent(/[?&]q=([^&]*)/.exec(offers()[0])![1]))
  expect(q).toMatchObject({ sessionId: 'chat-research-2', reason: 'look up, compare, sources' })
  expect(q.score).toBe(6)
  await send('look up more sources on this')
  expect(offers().length).toBe(1)
  cwd = '/u/Documents/Research/routing'
  id = 'chat-research-3'
  await send('look up how other tools route models and compare them, with sources')
  expect(offers().length).toBe(1)
})

test('hub_recall passes its scope on, and only a known one', async ($, on) => {
  const asked: string[] = []
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9.3e12 }))
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.id', () => ({ value: 'chat-recall-scope' }))
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  on('http.fetch', (_, e) => { asked.push(String(e.url)); return { value: { status: 200, ok: true, headers: {}, text: 'ok' } } })
  on('tool.call', () => ({ result: {} }))
  const recall = async (extra: object) => { asked.length = 0; await $.tool.call({ tool: 'mcp__usage-meter__hub_recall', query: 'routing', ...extra }); return asked.find(u => u.includes('/hub/recall'))! }
  expect(await recall({ scope: 'research' })).toContain('&scope=research')
  expect(await recall({ scope: 'all' })).toContain('&scope=all')
  expect(await recall({ scope: 'bogus' })).not.toContain('scope=')
  expect(await recall({})).not.toContain('scope=')
})

test('a round qa or the gate sent back reruns one model step up', () => {
  const P = '/u/App', brief = 'Fix the parser in src/parse.ts'
  const done = (o: Partial<Run>): Run => ({ role: 'engineer', brief, model: 'sonnet', files: [`${P}/src/parse.ts`], clean: true, round: 1, ...o })
  const pick = (runs: Run[]) => spawnModel('sonnet', 'engineer', brief, [], P, 0, runs)
  const first = pick([])
  expect(first).toBe('sonnet')
  // qa found problems, the gate's failure in the brief, or the run itself was not clean: one step up
  expect(pick([done({}), done({ role: 'qa', clean: false })])).toBe('opus')
  expect(spawnModel('sonnet', 'engineer', 'Typecheck fails in src/parse.ts: TS2345 on line 4', [], P, 0, [done({})])).toBe('opus')
  expect(pick([done({ clean: false })])).toBe('opus')
  // a clean round with no qa yet and no failure is follow-up work
  expect(pick([done({})])).toBe(first)
  // one step above the pick, never past opus or the role's ceiling
  expect(pick([done({ model: 'claude-opus-5-5', clean: false })])).toBe('opus')
  expect(spawnModel('opus', 'designer', 'Redesign src/parse.ts', [], P, 0, [done({ role: 'designer', clean: false })])).toBe('opus')
  expect(spawnModel('haiku', 'ops', brief, [], P, 0, [done({ role: 'ops', clean: false })])).toBe('sonnet')
  // a clean qa since, other files, or a qa rerun is no send back
  expect(pick([done({}), done({ role: 'qa', clean: true })])).toBe(first)
  expect(pick([done({ files: [`${P}/src/other.ts`], clean: false })])).toBe(first)
  expect(spawnModel('sonnet', 'qa', brief, [], P, 0, [done({ role: 'qa', clean: false })])).toBe(spawnModel('sonnet', 'qa', brief, [], P, 0, []))
})

test('hub_recall asks the window that started last, then older ones, a crashed window on the same folder too', async ($, on) => {
  const asked: string[] = []
  let down: number | undefined, newest = '/u/Other'
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9.5e12 }))
  on('process.run', () => new Promise(() => {}) as never)
  on('session.cwd', () => ({ value: '/u/Armasu' }))
  on('session.id', () => ({ value: 'chat-recall-newest' }))
  on('fs.list', () => ({ value: [['aaa-1.json', 1], ['bbb-2.json', 2]].map(([name, mtimeMs]) => ({ name: String(name), kind: 'file' as const, size: 10, mtimeMs: Number(mtimeMs), isLink: false })) }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('aaa-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : String(e.path).endsWith('bbb-2.json') ? JSON.stringify({ port: 8, workspace: newest, hubToken: 'n' }) : '' }))
  on('http.fetch', (_, e) => {
    const port = Number(new URL(e.url).port)
    if (e.url.includes('/hub/recall') || e.url.includes('/hub/ask')) asked.push(`${port}${new URL(e.url).pathname}`)
    if (port === down) throw new Error('refused')
    return { value: { status: 200, ok: true, headers: {}, text: `from ${port}` } }
  })
  on('tool.call', () => ({ result: {} }))
  const call = async (tool: string, input: object) => { asked.length = 0; return JSON.stringify(await $.tool.call({ tool: `mcp__usage-meter__${tool}`, ...input })) }
  // An older window runs the build it loaded until it reloads.
  expect(await call('hub_recall', { query: 'routing' })).toContain('from 8')
  expect(asked).toEqual(['8/hub/recall'])
  down = 8
  expect(await call('hub_recall', { query: 'routing' })).toContain('from 7')
  expect(asked).toEqual(['8/hub/recall', '7/hub/recall'])
  newest = '/u/Armasu'
  expect(await call('hub_recall', { query: 'routing' })).toContain('from 7')
  expect(asked).toEqual(['8/hub/recall', '7/hub/recall'])
  newest = '/u/Other'
  // The brain is this project's only.
  down = undefined
  expect(await call('hub_ask', { question: 'who is on what?' })).toContain('from 7')
  expect(asked).toEqual(['7/hub/ask'])
})

test('hub_recall outlasts a slow window, falls back to any window, and says when none answered', async ($, on) => {
  const asked: string[] = []
  const slept: string[][] = []
  let cwd = '/u/Armasu'
  let reply: () => Promise<{ value: object }> = () => new Promise(r => setTimeout(() => r({ value: { status: 200, ok: true, headers: {}, text: 'late answer' } }), 30))
  let sleep: () => Promise<{ value: object }> = () => new Promise(() => {})
  on('env.get', () => ({ value: '/u' }))
  on('clock.now', () => ({ value: 9.4e12 }))
  // The two second cutoff of every other call: it must not end a recall or an ask.
  on('clock.sleep', () => ({ value: undefined }))
  on('process.run', (_, e) => { slept.push(e.argv as string[]); return sleep() as never })
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'chat-recall-slow' }))
  on('fs.list', () => ({ value: [{ name: 'a-1.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: String(e.path).endsWith('a-1.json') ? JSON.stringify({ port: 7, workspace: '/u/Armasu', hubToken: 't' }) : '' }))
  on('http.fetch', (_, e) => { asked.push(String(e.url)); return reply() as never })
  on('tool.call', () => ({ result: {} }))
  const call = async (tool: string, input: object) => JSON.stringify(await $.tool.call({ tool: `mcp__usage-meter__${tool}`, ...input }))
  expect(await call('hub_recall', { query: 'routing' })).toContain('late answer')
  expect(slept[0]).toEqual(['sleep', '10'])
  expect(await call('hub_ask', { question: 'who is on what?' })).toContain('late answer')
  expect(slept[1]).toEqual(['sleep', '65'])
  // Memory is the whole Mac's, so any window can answer; the brain is this project's only.
  cwd = '/elsewhere'
  asked.length = 0
  expect(await call('hub_recall', { query: 'routing' })).toContain('late answer')
  expect(asked.some(u => u.includes('/hub/recall') && u.includes('cwd=%2Felsewhere'))).toBe(true)
  expect(await call('hub_ask', { question: 'who is on what?' })).toContain('No Switchboard window holds this folder')
  cwd = '/u/Armasu'
  reply = () => new Promise(() => {})
  sleep = async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })
  expect(await call('hub_recall', { query: 'routing' })).toContain('did not answer in time')
  expect(await call('hub_ask', { question: 'who is on what?' })).toContain('did not answer in time')
})
