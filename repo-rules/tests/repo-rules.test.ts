import { expect, test } from 'claude-code/testing'

import { EM, addsEmDash, bashRule, isUnder, rootsFor } from '../hooks/register.ts'

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

test('a commit is refused through the hook', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('env.get', () => ({ value: '/Users/k' }))
  on('session.cwd', () => ({ value: '/tmp' }))
  on('fs.list', () => ({ value: [] }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m wip' })
  expect(JSON.stringify(ran)).toMatch(/repo-rules/)
})
