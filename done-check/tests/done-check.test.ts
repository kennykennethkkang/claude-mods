import { expect, test } from 'claude-code/testing'

import { judge, lastTurn, noteTask } from '../hooks/register.ts'

const line = (o: object) => JSON.stringify(o)
const prompt = (text: string) => line({ type: 'user', uuid: `u-${text}`, message: { role: 'user', content: text } })
const use = (id: string, name: string, input: object) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, text: string, isError = false) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } })
const say = (text: string) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

const edit = (id: string) => use(id, 'Edit', { file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
const run = (id: string, command: string) => use(id, 'Bash', { command })

test('only the last turn counts, from a cut first line on', () => {
  const tail = ['{"cut half a line', prompt('one'), edit('e0'), result('e0', 'ok'), prompt('two'), say('hi')].join('\n')
  const t = lastTurn(tail)
  expect(t.edited).toBe(false)
  expect(t.key).toBe('u-two')
})

test('an edit with no check after it blocks', () => {
  const t = lastTurn([prompt('fix it'), edit('e1'), result('e1', 'ok')].join('\n'))
  const v = judge(t, 'Fixed.', [])
  expect(v.block).toBe(true)
  expect(v.missing.join(' ')).toMatch(/after the last test/)
})

test('a check after the last edit passes', () => {
  const t = lastTurn([prompt('fix it'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', '12 passed')].join('\n'))
  expect(judge(t, 'Done, all pass.', []).verified).toBe(true)
  const asked = lastTurn([prompt('fix it'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', '12 passed'), use('q1', 'AskUserQuestion', {})].join('\n'))
  expect(judge(asked, 'Done, all pass.', []).block).toBe(false)
})

test('an edit after the check blocks again', () => {
  const t = lastTurn([prompt('x'), edit('e1'), run('b1', 'npx tsc -p .'), result('b1', ''), edit('e2'), result('e2', 'ok')].join('\n'))
  expect(judge(t, 'Done.', []).block).toBe(true)
})

test('claiming success over a failed check blocks', () => {
  const t = lastTurn([prompt('x'), edit('e1'), run('b1', 'pytest -q'), result('b1', '1 failed', true)].join('\n'))
  const v = judge(t, 'All tests pass, fixed.', [])
  expect(v.block).toBe(true)
  expect(v.missing.join(' ')).toMatch(/failed/)
})

test('open tasks block', () => {
  const t = lastTurn([prompt('x'), edit('e1'), run('b1', 'npm test'), result('b1', 'ok')].join('\n'))
  const v = judge(t, 'Done.', [{ subject: 'Wire the hub', status: 'in_progress' }, { subject: 'Old', status: 'completed' }])
  expect(v.block).toBe(true)
  expect(v.missing.join(' ')).toMatch(/Wire the hub/)
})

test('never blocks a turn waiting on Kenneth, a limit, a handoff or no edits', () => {
  const edited = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok')].join('\n'))
  expect(judge(edited, 'Should the pane sit on the left or the right?', []).block).toBe(false)
  expect(judge(lastTurn([prompt('x'), edit('e1'), use('q1', 'AskUserQuestion', {})].join('\n')), 'Asked.', []).block).toBe(false)
  expect(judge(edited, "You've hit your usage limit, resets 5pm.", []).block).toBe(false)
  expect(judge(edited, 'Handing off to the next chat with the note.', []).block).toBe(false)
  const none = lastTurn([prompt('x'), run('b1', 'ls'), result('b1', 'a')].join('\n'))
  expect(judge(none, 'Done.', [{ subject: 'x', status: 'pending' }]).block).toBe(false)
})

test('the approval question is not a way out', () => {
  const edited = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok')].join('\n'))
  expect(judge(edited, 'Done. Do you approve this chat?', []).block).toBe(true)
})

test('the closing question as text counts when no ask tool exists', () => {
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok')].join('\n'))
  expect(t.asked).toBe(false)
  expect(judge(t, 'Standup done.\n\nApprove this chat as finished?', []).block).toBe(false)
  expect(judge(t, 'Standup done.', []).block).toBe(true)
})

test('tasks follow TodoWrite, TaskCreate and TaskUpdate', () => {
  const m = new Map<string, { subject: string; status: string }>()
  noteTask(m, 'TaskCreate', { subject: 'A' }, { task: { id: '1', subject: 'A' } })
  noteTask(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, {})
  expect(m.get('1')?.status).toBe('completed')
  noteTask(m, 'TodoWrite', { todos: [{ content: 'B', status: 'pending' }] }, {})
  expect([...m.values()]).toEqual([{ subject: 'B', status: 'pending' }])
})

test('Stop blocks at most twice a turn and writes the status file', async ($, on) => {
  const files: Record<string, string> = {}
  const tail = [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n')
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: tail, stderr: '' } }))
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('classic.Stop', () => ({}))
  const stop = (active: boolean) => $.classic.Stop({ session_id: 's1', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: active, last_assistant_message: 'Done.' })
  expect((await stop(false)).block).toMatch(/done-check/)
  expect((await stop(true)).block).toMatch(/done-check/)
  expect((await stop(true)).block).toBeUndefined()
  const status = JSON.parse(files['/h/.claude/switchboard/done-check/s1.json'] ?? '{}')
  expect(status.verified).toBe(false)
  expect(status.missing.length).toBeGreaterThan(0)
})

test('the cap counts per turn key, whatever stop_hook_active says', async ($, on) => {
  const tail = [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n')
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: tail, stderr: '' } }))
  on('fs.write', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  const stop = (active: boolean) => $.classic.Stop({ session_id: 's3', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: active, last_assistant_message: 'Done.' })
  expect((await stop(false)).block).toMatch(/done-check/)
  expect((await stop(false)).block).toMatch(/done-check/)
  expect((await stop(true)).block).toBeUndefined()
  expect((await stop(false)).block).toBeUndefined()
})

test('a failing goal Check holds Stop with its last 20 output lines', async ($, on) => {
  const tail = [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n')
  const calls: Array<{ argv: string[]; options: object }> = []
  on('env.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'goal-1' }))
  on('session.root', () => ({ value: '/r' }))
  on('fs.read', (_, e) => ({ value: e.path === '/r/.switchboard/goals/goal-1.md' ? '# Goal\n\nCheck: `make check`' : '{}' }))
  on('process.run', (_, e) => {
    calls.push(e)
    return { value: e.argv[0] === 'tail'
      ? { exitCode: 0, stdout: tail, stderr: '' }
      : { exitCode: 1, stdout: Array.from({ length: 22 }, (_, i) => `line ${i + 1}`).join('\n'), stderr: '' } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  const stopResult = await $.classic.Stop({ session_id: 'goal-1', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: false, last_assistant_message: 'Done.' })
  expect(stopResult.block).toContain('goal Check failed')
  expect(stopResult.block).toContain('line 3')
  expect(stopResult.block).toContain('line 22')
  expect(stopResult.block).not.toContain('line 2\n')
  const check = calls.find(x => x.argv[0] === '/bin/sh') as unknown as { argv: string[]; init: object }
  expect(check).toEqual({ argv: ['/bin/sh', '-c', 'make check'], init: { cwd: '/r', timeoutMs: 600_000 } })
})

test('a goal Check runs after edits, even past the chat\'s own checks, and its pass is reused until another edit', async ($, on) => {
  let tail = prompt('fix')
  const store: Record<string, unknown> = {}
  let checks = 0
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('env.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'goal-cache' }))
  on('session.root', () => ({ value: '/r' }))
  on('fs.read', (_, e) => ({ value: e.path === '/r/.switchboard/goals/goal-cache.md' ? 'Check: `make check`' : '{}' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === '/bin/sh') checks++
    return { value: { exitCode: 0, stdout: tail, stderr: '' } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  const stop = () => $.classic.Stop({ session_id: 'goal-cache', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: false, last_assistant_message: 'Done.' })

  await stop()
  expect(checks).toBe(0)
  tail = [prompt('fix'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok')].join('\n')
  await stop()
  expect(checks).toBe(1)
  tail = [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n')
  await stop()
  expect(checks).toBe(1)
  await stop()
  expect(checks).toBe(1)
  tail = [prompt('fix'), edit('e1'), result('e1', 'ok'), edit('e2'), result('e2', 'ok')].join('\n')
  await stop()
  expect(checks).toBe(2)
})

test('done-check leaves a goal Check to usage-meter when Run indefinitely is on', async ($, on) => {
  const calls: string[][] = []
  on('session.id', () => ({ value: 'goal-2' }))
  on('session.root', () => ({ value: '/r' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('/indefinite.json') ? '{"goal-2":1}' : 'Check: `make check`' }))
  on('process.run', (_, e) => {
    calls.push(e.argv)
    return { value: e.argv[0] === 'tail' ? { exitCode: 0, stdout: prompt('fix'), stderr: '' } : { exitCode: 1, stdout: 'failed', stderr: '' } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  const result = await $.classic.Stop({ session_id: 'goal-2', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: false, last_assistant_message: 'Done.' })
  expect(result.block).toBeUndefined()
  expect(calls.some(argv => argv[0] === '/bin/sh')).toBe(false)
})

test('a fresh process still stops at two blocks a turn', async ($, on) => {
  const tail = [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n')
  // What an earlier process left: this turn already blocked twice.
  const store: Record<string, unknown> = { blocks: { [`s2:${lastTurn(tail).key}`]: 2 } }
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: tail, stderr: '' } }))
  on('fs.write', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  const r = await $.classic.Stop({ session_id: 's2', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: true, last_assistant_message: 'Done.' })
  expect(r.block).toBeUndefined()
})

test('a chat held by usage-meter stops without a block, whatever its last message says', () => {
  const denial = 'Paused by usage-meter: five-hour usage at 99%. Stop here; this chat resumes by itself when the limit resets, in 1h 0m.'
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', denial, true)].join('\n'))
  expect(judge(t, 'Stopping here until it resumes.', [{ subject: 'Wire it', status: 'in_progress' }]).block).toBe(false)
  // The denial as a list of text blocks, as some tools return it.
  const listed = line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e2', content: [{ type: 'text', text: denial }], is_error: true }] } })
  expect(judge(lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), edit('e2'), listed].join('\n')), 'Ok.', []).block).toBe(false)
  // How the engine writes a hook deny into the transcript.
  const wrapped = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b3', 'npm test'), result('b3', `<tool_use_error>${denial}</tool_use_error>`, true)].join('\n'))
  expect(wrapped.held).toBe(true)
})

test('the denial text in a plain tool result, a grep of these mods say, holds nothing', () => {
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), use('g1', 'Grep', { pattern: 'HELD' }), result('g1', "register.ts:16:const HELD = 'Paused by usage-meter'")].join('\n'))
  expect(t.held).not.toBe(true)
  expect(judge(t, 'Done, all fixed.', []).block).toBe(true)
  // Not denied: an error that only mentions it further in is no hold either.
  const err = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), use('b2', 'Bash', { command: 'ls' }), result('b2', "grep: 'Paused by usage-meter' not found", true)].join('\n'))
  expect(err.held).not.toBe(true)
})

const inApp = (id: string) => use(id, 'Edit', { file_path: '/u/My App/a.ts' })
const CLOSE = { questions: [{ question: 'Approve this chat as finished?', header: 'Approve', options: [{ label: 'Approve' }, { label: 'Send back' }] }] }
function closeRig(on: (op: never, fn: never) => void, tail: string) {
  const files: Record<string, string> = {}
  const order: string[] = []
  const tails: string[] = []
  const h = on as (op: string, fn: (...a: any[]) => unknown) => void
  h('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  h('session.id', () => ({ value: 's9' }))
  h('session.root', () => ({ value: '/u/My App' }))
  h('session.cwd', () => ({ value: '/u/My App' }))
  h('process.run', (_: unknown, e: { argv?: string[] }) => { tails.push(JSON.stringify(e)); return { value: { exitCode: 0, stdout: tail, stderr: '' } } })
  h('fs.write', (_: unknown, e: { path: string; text: string }) => { files[e.path] = e.text; order.push('write'); return { value: undefined } })
  h('tool.call', () => { order.push('asked'); return { result: 'Approve' } })
  return { files, order, tails }
}

test('the closing question stamps the status before it waits on Kenneth', async ($, on) => {
  const r = closeRig(on as never, [prompt('fix'), inApp('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok')].join('\n'))
  await $.tool.call({ tool: 'AskUserQuestion', ...CLOSE } as never)
  expect(r.order).toEqual(['write', 'asked'])
  expect(r.tails.join(' ')).toContain('/h/.claude/projects/-u-My-App/s9.jsonl')
  const s = JSON.parse(r.files['/h/.claude/switchboard/done-check/s9.json'] ?? '{}')
  expect(s.state).toBe('verified')
  expect(s.verified).toBe(true)
  expect(s.session).toBe('s9')
})

test('an unchecked edit stamps unverified at the closing question, not waiting', async ($, on) => {
  const r = closeRig(on as never, [prompt('fix'), inApp('e1'), result('e1', 'ok'), use('q1', 'AskUserQuestion', CLOSE)].join('\n'))
  await $.tool.call({ tool: 'AskUserQuestion', ...CLOSE } as never)
  const s = JSON.parse(r.files['/h/.claude/switchboard/done-check/s9.json'] ?? '{}')
  expect(s.state).toBe('unverified')
  expect(s.missing.join(' ')).toMatch(/after the last test/)
})

test('other questions and subagents leave the status alone', async ($, on) => {
  const r = closeRig(on as never, [prompt('fix'), edit('e1'), result('e1', 'ok')].join('\n'))
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Left or right?', header: 'Side', options: [{ label: 'L' }, { label: 'R' }] }] } as never)
  await $.tool.call({ tool: 'AskUserQuestion', agentId: 'a1', ...CLOSE } as never)
  expect(Object.keys(r.files)).toEqual([])
  expect(r.order).toEqual(['asked', 'asked'])
})

const bash = (id: string, command: string) => use(id, 'Bash', { command })
const edits = (cmd: string, cwd = '/r') => lastTurn([prompt('x'), bash('b', cmd), result('b', 'ok')].join('\n'), cwd).edited

test('a Bash command that writes a file is an edit', () => {
  expect(edits('cat > index.js <<EOF\nx\nEOF')).toBe(true)
  expect(edits('echo hi >> notes.txt')).toBe(true)
  expect(edits('echo a | tee out.txt')).toBe(true)
  expect(edits("sed -i '' 's/a/b/' src/a.ts")).toBe(true)
  expect(edits('perl -pi -e s/a/b/ src/a.ts')).toBe(true)
  expect(edits('cp a.ts src/b.ts')).toBe(true)
  expect(edits('mv a.ts src/b.ts')).toBe(true)
  expect(edits("apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch\nEOF")).toBe(true)
  expect(edits('echo hi > $OUT')).toBe(true)
})

test('reads, null and fd redirects are not edits', () => {
  expect(edits('ls -la')).toBe(false)
  expect(edits('npm test 2>&1 | tail -5')).toBe(false)
  expect(edits('grep x a > /dev/null 2>&1')).toBe(false)
  expect(edits('node -e "const f = x => y"')).toBe(false)
})

test('writes outside the cwd or under .switchboard are not repo work', () => {
  expect(edits('echo x > /tmp/scratch.txt')).toBe(false)
  expect(edits('echo x > .switchboard/stages/a/out.md')).toBe(false)
  expect(edits('echo x > /r/.switchboard/changes/n.md')).toBe(false)
  expect(edits('cp a.ts /private/tmp/a.ts')).toBe(false)
  const tool = (file: string) => lastTurn([prompt('x'), use('e', 'Write', { file_path: file }), result('e', 'ok')].join('\n'), '/r').edited
  expect(tool('/r/src/a.ts')).toBe(true)
  expect(tool('/h/.cache/x.md')).toBe(false)
  expect(tool('/r/.switchboard/stages/n.md')).toBe(false)
  expect(tool('/r2/a.ts')).toBe(false)
})

test('the cwd falls back to the rows own cwd', () => {
  const row = line({ type: 'assistant', cwd: '/r', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'e', name: 'Write', input: { file_path: '/elsewhere/a.ts' } }] } })
  expect(lastTurn([prompt('x'), row].join('\n')).edited).toBe(false)
})

test('a hook-refused Bash call is not a failed or passed check', () => {
  const deny = (text: string) => lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), bash('b1', 'git add test.txt'), result('b1', text, true)].join('\n'))
  for (const text of ['<tool_use_error>repo-rules: no</tool_use_error>', 'repo-rules: no', 'bash-approve: always refused (rm).']) {
    const t = deny(text)
    expect(t.lastCheck).toBe(-1)
    expect(t.checkFailed).toBe(false)
  }
  const real = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), bash('b1', 'npm test'), result('b1', 'FAIL: 1 failed', true)].join('\n'))
  expect(real.checkFailed).toBe(true)
})

test('a turn that launched a background agent is waiting', () => {
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), use('a1', 'Agent', { prompt: 'p', run_in_background: true }), result('a1', 'started')].join('\n'))
  expect(judge(t, 'Waiting on the agents.', []).block).toBe(false)
  const r = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), use('a1', 'Agent', { prompt: 'p' }), result('a1', 'Async agent launched successfully')].join('\n'))
  expect(judge(r, 'Working.', []).block).toBe(false)
  const fg = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), use('a1', 'Agent', { prompt: 'p' }), result('a1', 'done')].join('\n'))
  expect(judge(fg, 'Working.', []).block).toBe(true)
})

test('verified edits with no closing question are held once for the finish steps', () => {
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok')].join('\n'))
  const v = judge(t, 'All done.', [])
  expect(v.block).toBe(true)
  expect(v.verified).toBe(true)
  expect(v.reason).toMatch(/aar skill.*standup.*Approve this chat as finished\?/)
  expect(judge(t, 'Which side should it go on?', []).block).toBe(false)
  expect(judge(t, 'Handing off to the next chat.', []).block).toBe(false)
  const ask = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok'), use('q', 'mcp__switchboard__ask', {})].join('\n'))
  expect(judge(ask, 'Done.', []).block).toBe(false)
  const read = lastTurn([prompt('x'), run('b1', 'ls'), result('b1', 'a')].join('\n'))
  expect(judge(read, 'Done.', []).block).toBe(false)
})

test('redirect characters inside quotes or heredoc bodies are not writes', () => {
  expect(edits('node -e "if (a>b) x()"')).toBe(false)
  expect(edits('echo "<div>" ; grep ">" x')).toBe(false)
  expect(edits("awk '$1>5' data.txt")).toBe(false)
  expect(edits('cat <<EOF\na > b\nEOF')).toBe(false)
  expect(edits('cat <<EOF > a.txt\nx\nEOF')).toBe(true)
  expect(edits('echo x > "my file.txt"')).toBe(true)
  expect(edits('echo x > "/tmp/f.txt"')).toBe(false)
})

test('an edit refused by a hook is not an edit', () => {
  const t = lastTurn([prompt('x'), use('w1', 'Write', { file_path: '/r/a.ts' }), result('w1', '<tool_use_error>repo-rules: no</tool_use_error>', true)].join('\n'), '/r')
  expect(t.edited).toBe(false)
  const ok = lastTurn([prompt('x'), use('w1', 'Write', { file_path: '/r/a.ts' }), result('w1', 'written')].join('\n'), '/r')
  expect(ok.edited).toBe(true)
})

test('a subagent is not held for the finish steps, only for edits and checks', () => {
  const t = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok'), run('b1', 'npm test'), result('b1', 'ok')].join('\n'))
  expect(judge(t, 'Done.', [], false).block).toBe(false)
  const unchecked = lastTurn([prompt('x'), edit('e1'), result('e1', 'ok')].join('\n'))
  expect(judge(unchecked, 'Done.', [], false).block).toBe(true)
})

test('Windows paths are judged like posix ones', () => {
  const w = (file: string, cwd: string) => lastTurn([prompt('x'), use('e', 'Write', { file_path: file }), result('e', 'ok')].join('\n'), cwd).edited
  expect(w('C:\\repo\\src\\a.ts', 'c:\\repo')).toBe(true)
  expect(w('C:\\repo\\.switchboard\\changes\\x.md', 'C:\\repo')).toBe(false)
  expect(w('.switchboard\\changes\\x.md', 'C:\\repo')).toBe(false)
  expect(w('src\\a.ts', 'C:\\repo')).toBe(true)
  expect(w('D:\\other\\a.ts', 'C:\\repo')).toBe(false)
})

test('python and node one-liners that write files are edits', () => {
  expect(edits(`python3 -c "open('a.py','w').write('x')"`)).toBe(true)
  expect(edits(`python3 - <<'EOF'\nfrom pathlib import Path\nPath('src/a.py').write_text('x')\nEOF`)).toBe(true)
  expect(edits(`python -c "import shutil; shutil.copy('a','src/b')"`)).toBe(true)
  expect(edits(`python3 -c "open(p, 'a').write(x)"`)).toBe(true)
  expect(edits(`node -e "require('fs').writeFileSync('a.js','x')"`)).toBe(true)
  expect(edits(`node --eval "fs.appendFileSync(f, 'x')"`)).toBe(true)
  expect(edits(`node - <<EOF\nfs.createWriteStream(out)\nEOF`)).toBe(true)
})

test('interpreter reads and writes clearly outside the repo are not edits', () => {
  expect(edits(`python3 -c "print(open('a.py').read())"`)).toBe(false)
  expect(edits(`node -e "console.log(require('fs').readFileSync('a.js','utf8'))"`)).toBe(false)
  expect(edits(`python3 -c "open('/tmp/x.txt','w').write('x')"`)).toBe(false)
  expect(edits(`node -e "fs.writeFileSync('.switchboard/n.md','x')"`)).toBe(false)
  expect(edits(`echo "open('a','w')"`)).toBe(false)
})

test('a write to process.argv[N] or sys.argv[N] is judged by the Nth trailing argument', () => {
  expect(edits(`node -e "require('fs').writeFileSync(process.argv[1], 'x')" "$TMPDIR/x"`)).toBe(false)
  expect(edits(`node -e "fs.writeFileSync(process.argv[2], 'x')" src/a.js /tmp/out`)).toBe(false)
  expect(edits(`node -e "fs.writeFileSync(process.argv[1], 'x')" src/a.js /tmp/out`)).toBe(true)
  expect(edits(`python3 -c "import sys; open(sys.argv[1], 'w').write('x')" /tmp/x.txt`)).toBe(false)
  expect(edits(`python3 -c "import sys; open(sys.argv[1], 'w').write('x')" a.txt`)).toBe(true)
  expect(edits(`node -e "fs.writeFileSync(process.argv[3], 'x')" /tmp/a`)).toBe(true)
})

test('python read-mode opens are not writes; copy and move are judged by their destination', () => {
  expect(edits(`python3 -c "print(open('x').read())"`)).toBe(false)
  expect(edits(`python3 -c "print(open('x', 'rb').read())"`)).toBe(false)
  expect(edits(`python3 -c "from pathlib import Path; print(Path('x').read_text())"`)).toBe(false)
  expect(edits(`python3 -c "open('x', 'r+').write('y')"`)).toBe(true)
  expect(edits(`python3 -c "open('x', mode='w').write('y')"`)).toBe(true)
  expect(edits(`python3 -c "import shutil; shutil.copy('/tmp/a', '/tmp/out')"`)).toBe(false)
  expect(edits(`python3 -c "import shutil; shutil.move('src/a', '/tmp/out')"`)).toBe(false)
  expect(edits(`python3 -c "import shutil; shutil.copy('/tmp/a', 'src/out')"`)).toBe(true)
  expect(edits(`python3 -c "import shutil; shutil.copy(a, b)"`)).toBe(true)
  expect(edits(`python3 -c "from pathlib import Path; Path('/tmp/x').write_text('y')"`)).toBe(false)
  expect(edits(`python3 -c "from pathlib import Path; print(Path('src/x').read_text()); Path('/tmp/o').write_text('y')"`)).toBe(false)
})

test('a transcript it cannot find stamps nothing, not a false Verified', async ($, on) => {
  const r = closeRig(on as never, '')
  await $.tool.call({ tool: 'AskUserQuestion', ...CLOSE } as never)
  expect(Object.keys(r.files)).toEqual([])
  expect(r.order).toEqual(['asked'])
})
