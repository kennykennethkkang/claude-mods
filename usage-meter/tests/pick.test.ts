import { expect, test } from 'claude-code/testing'

import { pickRun } from '../hooks/model.ts'
import raw from './pick-cases.ts'

type Case = { n: number; input: Parameters<typeof pickRun>[0]; expect: { model: string; effort: string; ultracode: boolean; ultrathink: boolean } }
const cases = raw as Case[]

test('picks model, effort, ultracode and ultrathink for the 45 labelled tasks', () => {
  expect(cases.length).toBe(45)
  for (const c of cases) {
    const got = pickRun(c.input)
    expect({ n: c.n, model: got.model, effort: got.effort, ultracode: got.ultracode, ultrathink: got.ultrathink }).toEqual({ n: c.n, ...c.expect })
  }
})

test('an explicit pick wins and is never gated', () => {
  const t = { role: 'lead', ai: 'claude' as const, usage5h: 90, text: 'fix the typo in the README' }
  expect(pickRun({ ...t, explicit: { model: 'fable' } }).model).toBe('fable')
  expect(pickRun({ ...t, explicit: { effort: 'max' } }).effort).toBe('max')
})

test('the reason names what the 5h gate held', () => {
  const r = pickRun({ role: 'lead', ai: 'claude', usage5h: 72, unattended: true, text: 'migrate every hub route to the new auth middleware and update all callers' })
  expect(r.reason).toContain('5h at 72%: held xhigh')
  expect(r.reason.startsWith('Auto: opus · high')).toBe(true)
})

test('a sure Jev difficulty replaces the keyword part, an unsure one does not', () => {
  const t = { role: 'engineer', ai: 'claude' as const, text: 'do the thing in the repo' }
  expect(pickRun(t).model).toBe('sonnet')
  expect(pickRun({ ...t, jevDifficulty: { label: 'frontier', conf: 0.9 } }).model).toBe('fable')
  expect(pickRun({ ...t, jevDifficulty: { label: 'frontier', conf: 0.5 } }).model).toBe('sonnet')
  expect(pickRun({ ...t, jevDifficulty: { label: 'trivial', conf: 0.8 } }).model).toBe('haiku')
})

test('clamps: haiku never runs xhigh, fable needs the hardest tasks, max needs unattended', () => {
  const hard = 'audit the whole repo for security holes in the shell and network paths'
  expect(pickRun({ role: 'researcher', ai: 'claude', text: hard }).model).not.toBe('fable')
  expect(pickRun({ role: 'engineer', ai: 'claude', text: hard }).effort).not.toBe('max')
  const ops = pickRun({ role: 'ops', ai: 'claude', text: hard })
  expect(['low', 'medium', 'high']).toContain(ops.effort)
})

test('a role with its own base keeps it when nothing moves it', () => {
  expect(pickRun({ role: 'designer', ai: 'claude', base: 'haiku', text: 'adjust the card gap' }).model).toBe('sonnet')
  expect(pickRun({ role: 'engineer', ai: 'claude', base: 'opus', text: 'add a field to the form' }).model).toBe('opus')
})
