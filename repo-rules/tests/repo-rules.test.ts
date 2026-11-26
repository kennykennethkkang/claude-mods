import { expect, test } from 'claude-code/testing'

import { CLAIM_MS, EM, addsEmDash, bashRule, claimFile, heldBy, inWorkbench, isUnder, needsLog, parseClaims, release, rootsFor, stamp } from '../hooks/register.ts'

test('bash rules', () => {
  expect(bashRule('git commit -m "x"')?.why).toMatch(/himself/)
  expect(bashRule('git -C ../Armasu push origin main')?.why).toMatch(/himself/)
  expect(bashRule('git rm -r --cached docs/x')?.why).toMatch(/stages a deletion/)
  expect(bashRule('npx prettier --write app/page.tsx')?.why).toMatch(/rewraps/)
  expect(bashRule('git status && git diff --stat')).toBeUndefined()
  expect(bashRule('npx prettier --check app')).toBeUndefined()
})

test('a chat cannot press the hub git buttons', () => {
  const post = `curl -s -X POST http://127.0.0.1:41234/hub/command -d '{"token":"t","type":"hub-git","sessionId":"s","op":"ship","confirmed":true}'`
  expect(bashRule(post)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(post.replace('"ship"', '"commit-push"'))?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`node -e 'fetch("http://localhost:41234/hub/command",{method:"POST",body:JSON.stringify({op:"push"})})'`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`curl -X POST http://127.0.0.1:41234/hub/command -d "{\\"type\\":\\"hub-git\\",\\"op\\":\\"ship\\",\\"confirmed\\":true}"`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`curl -X POST "http://127.0.0.1:41234/hub/"'command' -d '{"op":"sync"}'`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule('curl -X POST http://127.0.0.1:41234/hub/command -d @/tmp/body.json')?.why).toMatch(/Kenneth presses/)
  expect(bashRule('curl -X POST http://127.0.0.1:41234/hub/command --data-binary @-')?.why).toMatch(/Kenneth presses/)
  // Every git op is Kenneth's, not just the pushing ones.
  for (const op of ['commit', 'undo', 'discard', 'stash', 'pop', 'switch', 'create', 'delete-branch', 'pr', 'rerun']) {
    expect(bashRule(post.replace('"ship"', `"${op}"`))?.why).toMatch(/Kenneth presses/)
    expect(bashRule(`node -e 'fetch("http://127.0.0.1:3131/hub/command",{method:"POST",body:JSON.stringify({op:"${op}"})})'`)?.why).toMatch(/Kenneth presses/)
  }
  expect(bashRule(`curl -X POST http://127.0.0.1:3131/hub/command -d '{"type":"hub-git","sessionId":"s"}'`)?.why).toMatch(/Kenneth presses/)
  // Stop process on a stuck item is Kenneth's too.
  expect(bashRule(`curl -X POST http://127.0.0.1:41234/hub/command?token=t -d '{"type":"hub-stuck-stop","sessionId":"s","id":"proc:s:1:2"}'`)?.why).toMatch(/Kenneth/)
  expect(bashRule(`node -e 'fetch("http://localhost:41234/hub/command",{method:"POST",body:JSON.stringify({type:"hub-stuck-stop"})})'`)?.why).toMatch(/Kenneth/)
  // Reading Switchboard's own source and files is fine.
  expect(bashRule('grep -rn hubToken extension/src')).toBeUndefined()
  expect(bashRule('cat ~/.claude/switchboard/uploads/switchboard/INDEX.md')).toBeUndefined()
  expect(bashRule('curl -s http://127.0.0.1:3010/hub/state')).toBeUndefined()
  expect(bashRule(`curl -X POST localhost:41234/hub/command -d '{"type":"hub-send","text":"ship it"}'`)).toBeUndefined()
})

test('hub bypasses qa found are refused', () => {
  const u = (s: string) => s.replace(/[a-z]/g, c => `\\u00${c.charCodeAt(0).toString(16)}`)
  expect(bashRule(`curl -X POST http://127.0.0.1:41234/hub/command -d '{"type":"${u('hub-git')}","op":"${u('commit')}"}'`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`node -e 'fetch("http://127.0.0.1:41234\\x2fhub\\x2fcommand",{method:"POST",body:JSON.stringify({op:"push"})})'`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`curl -X POST http://127.0.0.1:41234/hub/command -d "$(cat /tmp/p.json)"`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule('curl -X POST http://127.0.0.1:41234/hub/command -d `cat /tmp/p.json`')?.why).toMatch(/Kenneth presses/)
  expect(bashRule('curl -X POST http://127.0.0.1:41234/hub/command --data "$BODY"')?.why).toMatch(/Kenneth presses/)
  expect(bashRule('curl -X POST localhost:41234/hub/comm --json=${B}')?.why).toMatch(/Kenneth presses/)
  expect(bashRule('wget --post-file=/tmp/p.json http://127.0.0.1:41234/hub/command')?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`U=/hub/comm; curl -X POST http://127.0.0.1:41234\${U}and -d '{"op":"commit"}'`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`export U="http://127.0.0.1:41234/hub/"; curl -X POST "$U"command -d '{"x":1}'`)?.why).toMatch(/Kenneth presses/)
})

test('normal bash stays open', () => {
  for (const c of [
    'git status', 'git diff --stat HEAD', 'git log --oneline -5',
    'curl -s http://localhost:3000/api/health',
    `curl -X POST http://127.0.0.1:8080/api -d "$(cat body.json)"`,
    `curl -X POST http://127.0.0.1:41234/hub/command -d '{"token":"t","type":"hub-todo","text":"ship the commit fix"}'`,
    `curl -s "http://127.0.0.1:41234/hub/state?token=$TOKEN"`,
    'grep -rn "/hub/command" extension/src',
    'U=http://127.0.0.1:3131/hub/state; curl -s "$U"',
    'export U="http://127.0.0.1:41234/hub/state?token=t"; curl -sf "$U" | jq .',
  ]) expect(bashRule(c)).toBeUndefined()
})

test('a variable hub URL is still refused when it posts', () => {
  expect(bashRule(`U=http://127.0.0.1:3131/hub/command; curl --request POST "$U"`)?.why).toMatch(/Kenneth presses/)
  expect(bashRule(`U=http://127.0.0.1:3131/hub/command; node -e 'fetch(process.env.U,{method:"POST"})'`)?.why).toMatch(/Kenneth presses/)
})

test('a 50 KB command is checked quickly', () => {
  const big = `curl -s http://127.0.0.1:3131/hub/state ${'a=b '.repeat(12800)}`
  const t = performance.now()
  bashRule(big)
  expect(performance.now() - t).toBeLessThan(200)
})

test('an em dash only counts when the new text adds one', () => {
  expect(addsEmDash('a', `a ${EM} b`)).toBe(true)
  expect(addsEmDash(`x ${EM} y`, `x ${EM} z`)).toBe(false)
})

test('roots follow the home folder on macOS and Windows alike', () => {
  expect(isUnder('/Users/k/Documents/GitHub/Armasu/app/page.tsx', rootsFor('/Users/k'))).toBe(true)
  expect(isUnder('C:\\Users\\k\\Documents\\GitHub\\Armasu\\x.ts', rootsFor('C:\\Users\\k'))).toBe(true)
  expect(isUnder('/tmp/notes.md', rootsFor('/Users/k'))).toBe(false)
})

test('the research folder gets the em dash rule too', () => {
  expect(isUnder('/Users/k/Documents/Research/agents/notes.md', rootsFor('/Users/k'))).toBe(true)
  expect(isUnder('C:\\Users\\k\\Documents\\Research\\a.md', rootsFor('C:\\Users\\k'))).toBe(true)
  expect(isUnder('/Users/k/Documents/Research2/a.md', rootsFor('/Users/k'))).toBe(false)
  expect(isUnder('/Users/k/Documents/vault/wiki/a.md', rootsFor('/Users/k'))).toBe(false)
})

test('a commit is refused through the hook', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('env.get', () => ({ value: '/Users/k' }))
  on('session.cwd', () => ({ value: '/tmp' }))
  on('fs.list', () => ({ value: [] }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m wip' })
  expect(JSON.stringify(ran)).toMatch(/repo-rules/)
})

test('claims: own ok, peer held, expired free, end releases', () => {
  const now = 10 * CLAIM_MS
  const c = { '/r/a.ts': { session: 'peer', at: now - 60_000 }, '/r/old.ts': { session: 'peer', at: now - CLAIM_MS - 1 } }
  expect(heldBy(c, '/r/a.ts', 'me', now)?.session).toBe('peer')
  expect(heldBy(c, '/r/a.ts', 'peer', now)).toBeUndefined()
  expect(heldBy(c, '/r/old.ts', 'me', now)).toBeUndefined()
  expect(heldBy(c, '/r/b.ts', 'me', now)).toBeUndefined()
  const next = stamp(c, '/r/b.ts', 'me', now)
  expect(Object.keys(next).sort()).toEqual(['/r/a.ts', '/r/b.ts'])
  expect(release(next, 'peer')).toEqual({ '/r/b.ts': { session: 'me', at: now } })
  expect(parseClaims('{not json')).toEqual({})
  expect(parseClaims('[1]')).toEqual({})
  expect(claimFile('/Users/k', '/Users/k/Documents/GitHub/app')).toBe('/Users/k/.claude/switchboard/claims/-Users-k-Documents-GitHub-app.json')
})

const APP = '/Users/k/Documents/GitHub/app'
const WT = '/Users/k/Documents/GitHub/app-wt'
const CLAIMS = claimFile('/Users/k', APP)
const NOW = 50 * CLAIM_MS

// An in-memory disk under the hook; process.run plays mv.
function disk(on: any, files: Record<string, string>, writes: string[] = [], failures: string[] = []) {
  files[`${APP}/.git`] ??= ''
  files[`${WT}/.git`] ??= 'gitdir: x'
  on('tool.call', () => ({ result: {} }))
  on('env.get', () => ({ value: '/Users/k' }))
  on('session.cwd', () => ({ value: APP }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: NOW }))
  on('fs.list', (_: unknown, e: { path: string }) => ({
    value: Object.keys(files).filter(f => f.slice(0, f.lastIndexOf('/')) === e.path)
      .map(f => ({ name: f.split('/').pop(), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', (_: unknown, e: { path: string }) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => { writes.push(e.path); files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    const failure = failures.shift()
    if (failure) return { value: { exitCode: 1, stdout: '', stderr: failure, isStdoutTruncated: false, isStderrTruncated: false } }
    const [from, to] = e.argv.slice(-2)
    files[to] = files[from]
    delete files[from]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return files
}

const peer = (path: string, at = NOW - 60_000) => JSON.stringify({ [path]: { session: 'peer', at } })

test('a file this chat holds stays open and the claim is kept', async ($, on) => {
  const files = disk(on, { [CLAIMS]: JSON.stringify({ [`${APP}/a.ts`]: { session: 'me', at: NOW - 60_000 } }) })
  const ran = await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' })
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
  expect(JSON.parse(files[CLAIMS])[`${APP}/a.ts`]).toEqual({ session: 'me', at: NOW })
})

test('a file another live chat holds is refused with who to ask', async ($, on) => {
  disk(on, { [CLAIMS]: peer(`${APP}/a.ts`) })
  for (const call of [
    { tool: 'Edit', file_path: `${APP}/a.ts`, old_string: 'a', new_string: 'b' },
    { tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' },
    { tool: 'NotebookEdit', notebook_path: `${APP}/a.ts`, new_source: 'x' },
  ] as const) {
    const ran = JSON.stringify(await $.tool.call(call as any))
    expect(ran).toMatch(/repo-rules/)
    expect(ran).toMatch(/peer/)
    expect(ran).toMatch(/SendMessage/)
  }
})

test('the refusal gives the minutes left and says a reply does not free the file', async ($, on) => {
  const files = disk(on, { [CLAIMS]: peer(`${APP}/a.ts`, NOW - 8 * 60_000) })
  const ask = async () => JSON.stringify(await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' }))
  const ran = await ask()
  expect(ran).toMatch(/lapses in 12 min/)
  expect(ran).toMatch(/reply from it does not free the file/)
  expect(ran).not.toMatch(/say when it is done/)
  files[CLAIMS] = peer(`${APP}/a.ts`, NOW - CLAIM_MS + 1)
  expect(await ask()).toMatch(/lapses in 1 min/)
})

test('a subagent of the holding chat shares its claim', async ($, on) => {
  disk(on, { [CLAIMS]: JSON.stringify({ [`${APP}/a.ts`]: { session: 'me', at: NOW - 60_000 } }) })
  const ran = await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x', agentId: 'sub1' } as any)
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
})

test('a claim idle past 20 minutes lapses', async ($, on) => {
  const files = disk(on, { [CLAIMS]: peer(`${APP}/a.ts`, NOW - CLAIM_MS - 1) })
  const ran = await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' })
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
  expect(JSON.parse(files[CLAIMS])[`${APP}/a.ts`].session).toBe('me')
})

test('a worktree copy of a held file is its own file', async ($, on) => {
  const files = disk(on, { [CLAIMS]: peer(`${APP}/a.ts`) })
  const ran = await $.tool.call({ tool: 'Write', file_path: `${WT}/a.ts`, content: 'x' })
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
  expect(JSON.parse(files[claimFile('/Users/k', WT)])[`${WT}/a.ts`].session).toBe('me')
})

test('a corrupt claims file fails open', async ($, on) => {
  disk(on, { [CLAIMS]: '{"half' })
  const ran = await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' })
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
})

test('claims are written to a temp file and renamed in place', async ($, on) => {
  const writes: string[] = []
  const files = disk(on, {}, writes)
  await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' })
  expect(writes.length).toBeGreaterThan(0)
  expect(writes.every(w => w !== CLAIMS)).toBe(true)
  expect(Object.keys(files).some(f => f.endsWith('.tmp'))).toBe(false)
  expect(JSON.parse(files[CLAIMS])[`${APP}/a.ts`].session).toBe('me')
})

test('a Windows rename lock gets one retry', async ($, on) => {
  const writes: string[] = []
  const files = disk(on, {}, writes, ['EPERM'])
  await $.tool.call({ tool: 'Write', file_path: `${APP}/a.ts`, content: 'x' })
  expect(files[CLAIMS]).toMatch(/"session":"me"/)
  expect(Object.keys(files).some(f => f.endsWith('.tmp'))).toBe(false)
})

test('a file outside any repo is never claimed', async ($, on) => {
  const writes: string[] = []
  disk(on, {}, writes)
  const ran = await $.tool.call({ tool: 'Write', file_path: '/tmp/x/a.ts', content: 'x' })
  expect(JSON.stringify(ran)).not.toMatch(/repo-rules/)
  expect(writes).toEqual([])
})

test('a chat that ends lets go of its files', async ($: any, on) => {
  const files = disk(on, { [CLAIMS]: JSON.stringify({ [`${APP}/a.ts`]: { session: 'me', at: NOW }, [`${APP}/b.ts`]: { session: 'peer', at: NOW } }) })
  on('session.end', () => ({ sessionId: 'me' }))
  await $.session.end({ reason: 'other', sessionId: 'me', resume: { id: 'me' } })
  expect(Object.keys(JSON.parse(files[CLAIMS]))).toEqual([`${APP}/b.ts`])
})

test('a failing home lookup never holds a clean call', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('env.get', () => ({ deny: 'env read failed' }))
  on('session.cwd', () => ({ value: '/tmp' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  const f = '/Users/k/Documents/GitHub/app/a.ts'
  for (const call of [
    { tool: 'Bash', command: 'git status --short | wc -l' },
    { tool: 'Edit', file_path: f, old_string: 'a', new_string: 'b' },
    { tool: 'Write', file_path: f, content: 'plain' },
  ] as const) expect(JSON.stringify(await $.tool.call(call as any))).not.toMatch(/repo-rules/)
  const dash = await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'a', new_string: `a ${EM} b` } as any)
  expect(JSON.stringify(dash)).toMatch(/guard failed \(throw/)
})

test('which chats and files need a logged change', () => {
  expect(inWorkbench('/Users/k/Documents/Research/Workbench', '/Users/k')).toBe(true)
  expect(inWorkbench('/Users/k/Documents/Research/Workbench/a/', '/Users/k')).toBe(true)
  expect(inWorkbench('/Users/k/Documents/Research', '/Users/k')).toBe(false)
  expect(inWorkbench('/Users/k/Documents/Research/Workbench2', '/Users/k')).toBe(false)
  expect(needsLog('/Users/k/.zshrc', '/Users/k')).toBe(true)
  expect(needsLog('/Users/k/.claude/skills/x/SKILL.md', '/Users/k')).toBe(true)
  expect(needsLog('/Users/k/.claude/projects/p/memory/a.md', '/Users/k')).toBe(false)
  expect(needsLog('/Users/k/Documents/Research/Workbench/notes.md', '/Users/k')).toBe(false)
  expect(needsLog('/private/tmp/x/a.sh', '/Users/k')).toBe(false)
})

test('a Workbench edit needs an open change that names the file', async ($, on) => {
  const id = '20261124-190000-zsh-ab12', rec = `/Users/k/.claude/switchboard/adjustments/${id}/record.json`
  const files: Record<string, string> = {}
  on('tool.call', () => ({ result: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/Users/k' : undefined }))
  on('session.cwd', () => ({ value: '/Users/k/Documents/Research/Workbench' }))
  on('session.id', () => ({ value: 'me' }))
  on('clock.now', () => ({ value: 1 }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', (_: unknown, e: any) => ({ value: e.path.endsWith('/adjustments') && files[rec] ? [{ name: id, kind: 'dir' }] : [] }) as any)
  on('fs.read', (_: unknown, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }) as any)
  const edit = async (file_path = '/Users/k/.zshrc') => JSON.stringify(await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as any))
  expect(await edit()).toMatch(/log this change first/)
  files[rec] = JSON.stringify({ status: 'open', files: [{ path: '/Users/k/.zshrc' }] })
  expect(await edit()).not.toMatch(/repo-rules/)
  expect(await edit('/Users/k/.zprofile')).toMatch(/log this change first/)
  files[rec] = JSON.stringify({ status: 'applied', files: [{ path: '/Users/k/.zshrc' }] })
  expect(await edit()).toMatch(/log this change first/)
  expect(await edit('/private/tmp/a.sh')).not.toMatch(/repo-rules/)
})

test('focus and process rules from the kit', () => {
  for (const c of ['pkill -f "next dev"', 'pkill -9 -f node', 'sleep 1; pkill -fl vite', 'p"kill" -f node', "p'kill' -f node", "pkill -'f' node", 'pkill --full node'])
    expect(bashRule(c)?.why).toMatch(/other chats/)
  for (const c of [`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, `osascript -e 'tell app "System Events" to key code 36'`, `osascript -e 'tell app "System Events" to key   code 36'`, `osascript -e 'tell application "system events" to Keystroke "v"'`])
    expect(bashRule(c)?.why).toMatch(/typing/)
  for (const c of [
    'pkill vite', 'kill 4242', 'pgrep -f "next dev"', 'open -g https://x.dev', 'open -gj out/report.html', 'open -g -a Preview shot.png', 'open -g -a "Google Chrome for Testing"', 'open https://x.dev', `perl -e 'open F, "/tmp/x.log"'`,
    '"$BROWSER" http://localhost:3010', 'osascript -e \'tell app "System Events" to get name of every process\'',
    'grep -rn "open" src', 'node scripts/open-files.mjs', 'git diff --stat', 'echo reopen later',
  ]) expect(bashRule(c)).toBeUndefined()
})
