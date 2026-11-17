import test from 'node:test'
import assert from 'node:assert/strict'
import { codexArgs, CLAUDE_SANDBOX } from './sandbox.mjs'

test('codex runs use workspace-write, never the full bypass', () => {
  const a = codexArgs('gpt-x', 'high', '/t/out')
  assert.deepEqual(a.slice(a.indexOf('--sandbox'), a.indexOf('--sandbox') + 2), ['--sandbox', 'workspace-write'])
  assert.ok(!a.includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.ok(a.includes('--dangerously-bypass-hook-trust'))
})

test('claude runs sandbox Bash and keep edits to the cwd', () => {
  assert.equal(CLAUDE_SANDBOX[CLAUDE_SANDBOX.indexOf('--permission-mode') + 1], 'acceptEdits')
  const s = JSON.parse(CLAUDE_SANDBOX[CLAUDE_SANDBOX.indexOf('--settings') + 1]).sandbox
  assert.equal(s.enabled, true)
  assert.equal(s.autoAllowBashIfSandboxed, true)
  assert.ok(!CLAUDE_SANDBOX.includes('bypassPermissions'))
})
