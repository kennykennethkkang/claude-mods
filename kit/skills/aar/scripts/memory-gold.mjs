#!/usr/bin/env node
// Runs a gold set of hub_recall queries against the running Switchboard hub and scores each one:
// a hit when any expected slug is among the top 3 notes recall returns.
// node memory-gold.mjs [gold.json] [--save out.json] [--base before.json]
// gold.json: [{ "q": "...", "expect": ["slug", ...], "cwd": "/optional/project" }], default ~/.claude/memory-gold.json
// --base lists queries that were hits in that saved run and miss now; exit 1 on any regression (or any miss without --base).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = k => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1] }
const save = flag('--save'), base = flag('--base')
const goldPath = args[0] ?? path.join(os.homedir(), '.claude', 'memory-gold.json')
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'))

const dir = path.join(os.homedir(), '.claude', 'switchboard')
const windows = fs.readdirSync(dir).filter(f => /^[0-9a-f]+-\d+\.json$/.test(f))
  .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)

// Top notes are the unindented "label: description" lines before the first blank line.
const topSlugs = text => text.split('\n\n')[0].split('\n').filter(l => l && !l.startsWith(' '))
  .map(l => l.slice(0, l.indexOf(': ') < 0 ? undefined : l.indexOf(': ')).replace(/ \(superseded\)$/, ''))

for (const f of windows) {
  let w
  try { w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
  if (!w.port || !w.hubToken) continue
  const results = []
  try {
    for (const g of gold) {
      const u = new URL(`http://127.0.0.1:${w.port}/hub/recall`)
      u.searchParams.set('q', g.q)
      if (g.cwd) u.searchParams.set('cwd', g.cwd)
      const r = await fetch(u, { headers: { 'x-switchboard-token': w.hubToken } })
      if (!r.ok) throw new Error(`${r.status}`)
      const top = topSlugs(await r.text())
      const rank = top.findIndex(s => g.expect.includes(s)) + 1
      results.push({ q: g.q, expect: g.expect, top, rank })
    }
  } catch { continue }
  const hits = results.filter(r => r.rank)
  for (const r of results) console.log(`${r.rank ? `hit@${r.rank}` : 'MISS '}  ${r.q}${r.rank ? '' : `\n        want ${r.expect.join(' | ')}, got ${r.top.join(', ') || 'nothing'}`}`)
  const mrr = results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / results.length
  console.log(`\n${hits.length}/${results.length} hit, MRR ${mrr.toFixed(3)}`)
  if (save) fs.writeFileSync(save, JSON.stringify(results, null, 1))
  let bad = results.length - hits.length
  if (base) {
    const was = new Map(JSON.parse(fs.readFileSync(base, 'utf8')).map(r => [r.q, r.rank]))
    const lost = results.filter(r => was.get(r.q) && !r.rank)
    const worse = results.filter(r => was.get(r.q) && r.rank > was.get(r.q))
    const won = results.filter(r => was.has(r.q) && !was.get(r.q) && r.rank)
    console.log(`vs ${path.basename(base)}: ${lost.length} lost, ${worse.length} ranked lower, ${won.length} gained`)
    for (const r of lost) console.log(`  lost   ${r.q}`)
    for (const r of worse) console.log(`  lower  ${r.q} (${was.get(r.q)} -> ${r.rank})`)
    bad = lost.length
  }
  process.exit(bad ? 1 : 0)
}
console.log('no Switchboard hub running; open a VS Code window with Switchboard and retry')
process.exit(2)
