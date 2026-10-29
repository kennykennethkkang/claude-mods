// /diet: what loads on every call, biggest first, and the plugins unused since tracking began.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Diet, DietRow } from '../types'

const PANE = 'context-diet'
const diet = atom({ plugin: 'context-diet', key: 'diet' } as const, null)

// mcp__plugin_bland_bland__x -> bland; mcp__openrouter__x -> openrouter.
export const ownerOf = (tool: string) => {
  const server = tool.split('__')[1] ?? tool
  return /^plugin_([^_]+)_/.exec(server)?.[1] ?? server
}

const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n)

export const summarize = (b: SessionContextBreakdown, uses: Record<string, number>, since: string): Diet => {
  const rows: DietRow[] = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).map(c => ({ label: c.name, tokens: c.tokens }))
  const owners = new Map<string, number>()
  const plugins = new Set<string>()
  for (const s of b.skills?.skillFrontmatter ?? []) {
    add(owners, s.pluginName ? `skills: ${s.pluginName}` : 'skills: yours', s.tokens)
    if (s.pluginName) plugins.add(s.pluginName)
  }
  for (const t of b.mcpTools) {
    const owner = ownerOf(t.name)
    // A deferred tool costs its name in the listing, not its schema.
    add(owners, `mcp: ${owner}`, t.isLoaded ? t.tokens : Math.round(t.name.length / 3.5))
    if (/^plugin_/.test(t.serverName)) plugins.add(owner)
  }
  const detail = [...owners].map(([label, tokens]) => ({ label, tokens })).sort((x, y) => y.tokens - x.tokens).slice(0, 8)
  const memory = b.memoryFiles.map(f => ({ label: `memory: ${f.path.split('/').pop() ?? f.path}`, tokens: f.tokens }))
  return {
    total: b.totalTokens,
    rows: [...rows.sort((x, y) => y.tokens - x.tokens), ...detail, ...memory],
    unused: [...plugins].filter(p => !uses[p]).sort(),
    since,
  }
}

const count = async ($: EngineInterface, owner: string) => {
  const uses = ((await $.store.get('uses')) ?? {}) as Record<string, number>
  await $.store.set('uses', { ...uses, [owner]: (uses[owner] ?? 0) + 1 })
}

const measure = async ($: EngineInterface) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return null
  const uses = ((await $.store.get('uses')) ?? {}) as Record<string, number>
  return summarize(b, uses, String((await $.store.get('since')) ?? 'today'))
}

const bar = (n: number, max: number) => '▓'.repeat(Math.max(1, Math.round((n / Math.max(max, 1)) * 12)))
const kilo = (n: number) => `${(n / 1000).toFixed(1)}K`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'diet', description: 'Rank what loads on every call and the plugins you have not used lately' })
    if ((await $.store.get('since')) === undefined) await $.store.set('since', new Date(await $.clock.now()).toISOString().slice(0, 10))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (String(e.tool).startsWith('mcp__')) await count($, ownerOf(String(e.tool))).catch(() => undefined)
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await count($, e.pluginName ?? e.skill).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'diet' }, async $ => {
    const d = await measure($)
    await update($, diet, () => d)
    await $.ui.open({ id: PANE, title: 'Context diet' })
    if (!d) return { text: 'No context breakdown yet: try again after the first reply.' }
    return { text: `Loads on every call: ${kilo(d.total)}. Unused since ${d.since}: ${d.unused.join(', ') || 'none'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await read($, diet)
    if (d === null) return <Text dimColor>Run /diet to measure.</Text>
    const max = Math.max(...d.rows.map(r => r.tokens))
    const fix = d.unused.map(p => `claude plugin disable ${p}`).join('\n')
    return (
      <Box flexDirection="column">
        <Text bold>Loads on every call: {kilo(d.total)}</Text>
        {d.rows.map(r => (
          <Text wrap="truncate">{r.label.padEnd(26).slice(0, 26)} {kilo(r.tokens).padStart(7)} {bar(r.tokens, max)}</Text>
        ))}
        <Text dimColor wrap="wrap">Unused since {d.since}: {d.unused.join(', ') || 'none'}</Text>
        {fix && <Button key="copy" label="Copy disable commands" onPress={p => void $.ui.copy({ text: fix, surface: p.surface })} />}
      </Box>
    )
  })
}
