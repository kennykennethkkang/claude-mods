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
