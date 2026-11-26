import { expect, test } from 'claude-code/testing'

import { openBrowsers, reason } from '../hooks/register.ts'

const line = (o: object) => JSON.stringify(o)
const use = (id: string, name: string, input: object = {}) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, text: string, isError = false) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } })
const pw = 'mcp__plugin_playwright_playwright__'
const cr = 'mcp__claude-in-chrome__'

test('a Playwright browser stays open until browser_close', () => {
  const opened = [use('a', `${pw}browser_navigate`, { url: 'http://x' }), result('a', 'ok'), use('b', `${pw}browser_snapshot`), result('b', 'ok')]
  expect(openBrowsers(opened.join('\n')).held).toEqual([{ kind: 'playwright', id: 'browser' }])
  expect(openBrowsers([...opened, use('c', `${pw}browser_close`), result('c', 'ok')].join('\n')).held).toEqual([])
})

test('Chrome tabs are tracked by id; only the closed one goes', () => {
  const tail = [
    use('a', `${cr}tabs_create_mcp`), result('a', 'Created new tab. Tab ID: 101'),
    use('b', `${cr}tabs_create_mcp`), result('b', 'Created new tab. Tab ID: 102'),
    use('c', `${cr}tabs_close_mcp`, { tabId: 101 }), result('c', 'closed'),
  ].join('\n')
  expect(openBrowsers(tail).held).toEqual([{ kind: 'chrome', id: '102' }])
})

test('Scrapling and Firecrawl sessions close by their id; a failed open holds nothing', () => {
  const tail = [
    use('a', 'mcp__scrapling__browser_open', { session_id: 's1' }), result('a', 'opened'),
    use('b', 'mcp__scrapling__open_request_session'), result('b', '{"session_id": "abc123def456"}'),
    use('c', 'mcp__scrapling__close_session', { session_id: 's1' }), result('c', 'ok'),
    use('d', 'mcp__firecrawl__firecrawl_browser_create'), result('d', '{"id":"fc-9"}'),
    use('e', 'mcp__firecrawl__firecrawl_browser_create'), result('e', 'boom', true),
  ].join('\n')
  expect(openBrowsers(tail).held).toEqual([{ kind: 'scrapling', id: 'abc123def456' }, { kind: 'firecrawl', id: 'fc-9' }])
  expect(openBrowsers([tail, use('f', 'mcp__firecrawl__firecrawl_browser_delete', { sessionId: 'fc-9' }), result('f', 'ok')].join('\n')).held).toEqual([{ kind: 'scrapling', id: 'abc123def456' }])
})

test('a Code Mode open reads its id from toolUseResult', () => {
  const inner = (r: unknown) => line({ type: 'user', isVirtual: true, toolUseResult: r, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'repl_1', content: '', is_error: false }] } })
  for (const r of ['{"session_id": "abc123"}', [{ type: 'text', text: '{"session_id": "abc123"}' }], { session_id: 'abc123' }]) {
    expect(openBrowsers([use('repl_1', 'mcp__scrapling__open_request_session'), inner(r)].join('\n')).held).toEqual([{ kind: 'scrapling', id: 'abc123' }])
  }
})

test('agent-browser sessions open on use and drop on close', () => {
  const tail = [
    use('a', 'Bash', { command: 'agent-browser --session qa open http://localhost:3132' }),
    use('b', 'Bash', { command: 'a() { agent-browser --session plan "$@"; }; a open http://x' }),
    use('c', 'Bash', { command: 'agent-browser --session qa close' }),
    use('d', 'Bash', { command: 'agent-browser open http://y' }),
  ].join('\n')
  expect(openBrowsers(tail).cli.sort()).toEqual(['default', 'plan'])
})

test('agent-browser counts only as the command, per segment, with the env session', () => {
  const sessions = (...cmds: string[]) => openBrowsers(cmds.map((c, i) => use(`x${i}`, 'Bash', { command: c })).join('\n')).cli.sort()
  expect(sessions('command grep -rn agent-browser ~/.claude/CLAUDE.md', 'which agent-browser')).toEqual([])
  expect(sessions('AGENT_BROWSER_SESSION=qa agent-browser open http://x')).toEqual(['qa'])
  expect(sessions('agent-browser --session a open http://x && agent-browser --session b open http://y')).toEqual(['a', 'b'])
  expect(sessions('agent-browser --session qa close; agent-browser --session qa open http://y')).toEqual(['qa'])
  expect(sessions('agent-browser --session qa open http://localhost:3132/close')).toEqual(['qa'])
  expect(sessions('export AGENT_BROWSER_SESSION=qa; agent-browser open http://x')).toEqual(['qa'])
  expect(sessions('npx -y agent-browser --session qa open http://x')).toEqual(['qa'])
})

test('a close only drops the id it names, and not when it failed', () => {
  const made = [use('a', `${cr}tabs_create_mcp`), result('a', 'Tab ID: 101')]
  expect(openBrowsers([...made, use('b', `${cr}tabs_close_mcp`, { tabId: 555 }), result('b', 'ok')].join('\n')).held).toEqual([{ kind: 'chrome', id: '101' }])
  expect(openBrowsers([...made, use('b', `${cr}tabs_close_mcp`, { tabId: 101 }), result('b', 'no', true)].join('\n')).held).toEqual([{ kind: 'chrome', id: '101' }])
  expect(openBrowsers([use('i', `${pw}browser_install`), result('i', 'ok')].join('\n')).held).toEqual([])
})

test('the reason names each thing and the tool that closes it', () => {
  const r = reason([{ kind: 'playwright', id: 'browser' }, { kind: 'chrome', id: '7' }])
  expect(r).toMatch(/Playwright browser \(browser_close\)/)
  expect(r).toMatch(/Chrome tab 7 \(tabs_close_mcp\)/)
})

test('Stop holds once for an open MCP browser and closes agent-browser sessions', async ($, on) => {
  const tail = [use('a', `${pw}browser_navigate`), result('a', 'ok'), use('b', 'Bash', { command: 'agent-browser --session qa open http://x' })].join('\n')
  const ran: string[][] = []
  on('process.run', (_, e) => { ran.push(e.argv); return { value: { exitCode: 0, stdout: e.argv[0] === 'tail' ? tail : '', stderr: '' } } })
  on('classic.Stop', () => ({}))
  const stop = (active: boolean, msg = 'Done.') => $.classic.Stop({ session_id: 's', transcript_path: '/t.jsonl', cwd: '/r', stop_hook_active: active, last_assistant_message: msg })
  expect((await stop(false)).block).toMatch(/tab-close/)
  expect(ran).toContainEqual(['agent-browser', '--session', 'qa', 'close'])
  expect((await stop(true)).block).toBeUndefined()
  expect((await stop(false, 'Which layout do you want?')).block).toBeUndefined()
  expect((await stop(false, 'Done.\n\nFor you: sign in on the open tab')).block).toBeUndefined()
  expect((await stop(false, 'Done.\n\nFor you: reload the window')).block).toMatch(/tab-close/)
  expect((await stop(false, 'Done.\n\n**For you**\n- Approve in the open browser tab')).block).toBeUndefined()
  expect((await stop(false, 'Done.\n\nFor you: check the table in README')).block).toMatch(/tab-close/)
  expect((await stop(false, 'For you:\n- reload\n\nLeft: the page copy')).block).toMatch(/tab-close/)
  expect((await stop(false, 'Done.\n\n- For you: none\n- Left: browser support')).block).toMatch(/tab-close/)
  expect((await stop(false, 'For you: reload VS Code\nLeft: the browser tab bug')).block).toMatch(/tab-close/)
})
