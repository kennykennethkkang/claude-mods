#!/usr/bin/env node
// Claude Code's status line: one row with the model, the context against the
// compaction point, the 5 hour and weekly limits with their resets, and the
// chat's cost, then the branch. In settings.json:
//   "statusLine": { "type": "command", "command": "node <this file>" }
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIM = '\x1b[2m', AMBER = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m'
const SEP = `${DIM} · ${RESET}`

const k = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)))
// resets_at may come as an ISO string, epoch seconds or epoch milliseconds.
const ms = v => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN)

function left(at, now) {
  const m = Math.max(0, Math.round((ms(at) - now) / 60_000))
  if (!Number.isFinite(m)) return ''
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}

// Amber from 80%, red from 95%, with a word for a terminal without colour.
const toned = (share, text) => (share >= 0.95 ? `${RED}${text} near full${RESET}` : share >= 0.8 ? `${AMBER}${text} high${RESET}` : text)

export function line(input, settings, now = Date.now(), branch) {
  const parts = [input.model?.display_name ?? 'Claude']
  const used = input.context_window?.total_input_tokens
  const point = settings.autoCompactWindow ?? input.context_window?.context_window_size
  if (typeof used === 'number' && point) {
    parts.push(`${toned(used / point, k(used))} of ${k(point)}`)
  }
  for (const [key, name] of [['five_hour', '5h'], ['seven_day', 'week']]) {
    const l = input.rate_limits?.[key]
    if (typeof l?.used_percentage !== 'number') continue
    const reset = l.resets_at === undefined ? '' : ` ${DIM}${left(l.resets_at, now)}${RESET}`
    parts.push(`${toned(l.used_percentage / 100, `${name} ${Math.round(l.used_percentage)}%`)}${reset}`)
  }
  const cost = input.cost?.total_cost_usd
  if (typeof cost === 'number') parts.push(`$${cost.toFixed(2)}`)
  if (branch) parts.push(branch)
  return parts.join(SEP)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let settings = {}
  try { settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) } catch { /* defaults */ }
  let raw = ''
  process.stdin.on('data', c => { raw += c }).on('end', () => {
    let input = {}
    try { input = JSON.parse(raw) } catch { /* nothing piped */ }
    let branch
    try { branch = /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(input.workspace?.current_dir ?? process.cwd(), '.git', 'HEAD'), 'utf8'))?.[1] } catch { /* not a repo */ }
    process.stdout.write(`${line(input, settings, Date.now(), branch)}\n`)
  })
}
