#!/usr/bin/env node
// Prints the memory graph's health from a running Switchboard hub; exit 1 when anything is listed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = path.join(os.homedir(), '.claude', 'switchboard')
// Newest window first: it is the one most likely to run the installed build.
const windows = fs.readdirSync(dir).filter(f => /^[0-9a-f]+-\d+\.json$/.test(f))
  .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)
for (const f of windows) {
  let w
  try { w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
  if (!w.port || !w.hubToken) continue
  let g
  try { g = await (await fetch(`http://127.0.0.1:${w.port}/hub/graph`, { headers: { 'x-switchboard-token': w.hubToken } })).json() } catch { continue }
  const label = new Map(g.nodes.map(n => [n.id, n]))
  let bad = 0
  for (const [k, list] of Object.entries(g.health)) {
    if (!list.length) continue
    bad += list.length
    console.log(`${k}: ${list.length}`)
    for (const i of list) {
      const n = typeof i === 'string' && label.get(i)
      console.log(`  ${n ? `${n.id}${n.missing ? ` (missing: ${n.missing.join(', ')})` : ''}` : JSON.stringify(i)}`)
    }
  }
  if (!bad) console.log('memory graph: no issues')
  process.exit(bad ? 1 : 0)
}
console.log('no Switchboard hub running; open a VS Code window with Switchboard and retry')
process.exit(2)
