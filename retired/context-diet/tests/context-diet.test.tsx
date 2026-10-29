import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

import { ownerOf, summarize } from '../hooks/register.tsx'

const BREAKDOWN = {
  totalTokens: 76_400,
  categories: [
    { name: 'Skills', tokens: 9_900, kind: 'used', color: '', isDeferred: false },
    { name: 'Free space', tokens: 900_000, kind: 'free', color: '', isDeferred: false },
  ],
  skills: { totalSkills: 2, includedSkills: 2, tokens: 300, skillFrontmatter: [
    { name: 'aws-core:aws-security', source: 'plugin', pluginName: 'aws-core', tokens: 250 },
    { name: 'superpowers:writing-plans', source: 'plugin', pluginName: 'superpowers', tokens: 50 },
  ] },
  mcpTools: [{ name: 'mcp__plugin_bland_bland__create_call', serverName: 'plugin_bland_bland', tokens: 474, isLoaded: false }],
  memoryFiles: [{ path: '/x/memory/MEMORY.md', type: 'AutoMem', tokens: 3_300 }],
} as unknown as SessionContextBreakdown

test('names the owner of a tool or skill', () => {
  expect(ownerOf('mcp__plugin_bland_bland__create_call')).toBe('bland')
  expect(ownerOf('mcp__openrouter__send-message')).toBe('openrouter')
})

test('ranks what loads and lists unused plugins', () => {
  const diet = summarize(BREAKDOWN, { superpowers: 4 }, '2026-10-22')
  expect(diet.total).toBe(76_400)
  expect(diet.rows[0]).toEqual({ label: 'Skills', tokens: 9_900 })
  expect(diet.rows.some(r => r.label === 'memory: MEMORY.md')).toBe(true)
  expect(diet.unused).toEqual(['aws-core', 'bland'])
})
