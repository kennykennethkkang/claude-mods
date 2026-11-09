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
  expect(judge(t, 'Done, all pass.', []).block).toBe(false)
  expect(judge(t, 'Done, all pass.', []).verified).toBe(true)
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
