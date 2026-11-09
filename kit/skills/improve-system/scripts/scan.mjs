#!/usr/bin/env node
// Reads local Claude Code transcripts and prints a small JSON summary: typed turns that
// correct Claude, tool errors, retries, interrupts and phrases repeated across sessions.
// No network, no deps. Usage: node scan.mjs [--days 7] [--project name-part]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A long run is a token unless it sits in a path or has no digits (hyphenated project folder names).
const token = (m, at, s) => (s[at - 1] === '/' || s[at + m.length] === '/' || !/\d/.test(m) || !/[A-Za-z]/.test(m) ? m : '[redacted]')
// name=value, name: "value": only names that are or end in a secret word (api_key, clientSecret, not monkey), only values of 8+.
const SECRET_NAME = /(^|[_-])(api[_-]?key|apikey|key|token|secret|password|passwd|pwd|auth)$/i
const SECRET_CAMEL = /[a-z0-9](Key|Token|Secret|Password|Passwd|Auth)$/
function assignment(m, name, sep, val) {
  const q = /^["']/.test(val) ? val[0] : ''
  const inner = q ? val.slice(1, -1) : val
  return (SECRET_NAME.test(name) || SECRET_CAMEL.test(name)) && inner.length >= 8 && !inner.startsWith('[redacted]') ? `${name}${sep}${q}[redacted]${q}` : m
}
// Best effort: catches the common shapes, not every secret.
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]'],
  // Greedy up to the last @ before the host, so a password holding @ goes too.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/]*@/gi, '$1[redacted]@'],
  [/\b(Authorization["']?\s*[:=]\s*["']?)(?:(Basic|Bearer|Token|Digest)\s+)?[^\s"',;}]+/gi, (m, head, scheme) => `${head}${scheme ? `${scheme} ` : ''}[redacted]`],
  [/\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/g, 'Basic [redacted]'],
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{6,}/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, '[redacted]'],
  [/\bBearer\s+\S+/gi, 'Bearer [redacted]'],
  [/([A-Za-z0-9_-]+)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;}]+)/g, assignment],
  [/\b[a-f0-9]{32,}\b/gi, token],
  [/[A-Za-z0-9+_-]{40,}={0,2}/g, token],
]
export const redact = s => SECRETS.reduce((t, [re, to]) => t.replace(re, to), String(s))

const CORRECTION = /\b(no,|nope|wrong|still (broken|failing|not|wrong)|didn'?t work|doesn'?t work|not working|not what i|i said|i told you|i asked|again|revert|undo|stop|why did you|why are you|you forgot|you missed|you didn'?t|instead|that'?s not|that is not|broken|ugh|wtf)\b/i
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...` : s)
// "Exit code 1" alone says nothing; the first real line after it does.
const firstLine = t => {
  const [head, ...rest] = t.split('\n').map(l => l.trim()).filter(Boolean)
  return /^Exit code \d+$/.test(head ?? '') && rest[0] ? `${head}: ${rest[0]}` : head ?? ''
}
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '')

// One transcript's records -> typed user turns, tool errors, retries of a failed call, interrupts.
export function parseSession(records) {
  const user = [], errors = [], calls = new Map(), failed = new Set()
  let retries = 0, interrupts = 0
  for (const r of records) {
    if (!r || r.isSidechain || r.isMeta || r.isCompactSummary) continue
    const content = r.message?.content
    if (r.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_use') continue
        const key = `${b.name}:${JSON.stringify(b.input)}`
        if (failed.has(key)) retries++
        calls.set(b.id, { tool: b.name, key })
      }
    }
    if (r.type !== 'user') continue
    const results = Array.isArray(content) ? content.filter(b => b?.type === 'tool_result') : []
    for (const b of results) {
      if (!b.is_error) continue
      const call = calls.get(b.tool_use_id) ?? { tool: '?' }
      if (call.key) failed.add(call.key)
      errors.push({ tool: call.tool, msg: clip(redact(firstLine(textOf(b.content))), 120) })
    }
    if (results.length) continue
    const text = textOf(content).trim()
    if (/^\[Request interrupted/.test(text)) { interrupts++; continue }
    if (text.startsWith('This session is being continued from a previous conversation')) continue
    const typed = r.origin ? r.origin.kind === 'human' : typeof content === 'string' && !text.startsWith('<')
    if (typed && text) user.push({ text: redact(text), ts: r.timestamp })
  }
  return { user, errors, retries, interrupts }
}

const words = s => s.replace(/https?:\/\/\S+/g, ' ').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)

// Phrases of 4 to 8 words typed in two or more sessions, longest kept, shorter ones inside it dropped.
function repeatedPhrases(sessions) {
  const seen = new Map()
  sessions.forEach((s, i) => {
    for (const u of s.user) {
      const w = words(u.text.slice(0, 2000))
      for (let n = 4; n <= 8; n++) for (let k = 0; k + n <= w.length; k++) {
        const p = w.slice(k, k + n).join(' ')
        const e = seen.get(p) ?? { sessions: new Set(), count: 0 }
        e.sessions.add(i); e.count++
        seen.set(p, e)
      }
    }
  })
  const multi = [...seen].filter(([, e]) => e.sessions.size > 1).map(([phrase, e]) => ({ phrase, sessions: e.sessions.size, count: e.count }))
  // ponytail: O(n^2) containment check, fine for a week of transcripts; cap first if it ever drags.
  multi.sort((a, b) => b.phrase.length - a.phrase.length)
  const kept = []
  for (const m of multi) if (!kept.some(k => k.sessions >= m.sessions && k.phrase.includes(m.phrase))) kept.push(m)
  return kept.sort((a, b) => b.sessions - a.sessions || b.count - a.count).slice(0, 30)
}

export function summarize(sessions, window = {}) {
  const projects = {}
  for (const s of sessions) {
    const p = (projects[s.project] ??= { sessions: 0, turns: 0, errors: 0, interrupts: 0 })
    p.sessions++; p.turns += s.user.length; p.errors += s.errors.length; p.interrupts += s.interrupts
  }
  const corrections = sessions.flatMap(s => s.user.filter(u => CORRECTION.test(u.text)).map(u => ({ project: s.project, date: u.ts?.slice(0, 10), text: clip(u.text.replace(/\s+/g, ' '), 200) })))
  const groups = new Map()
  for (const s of sessions) for (const e of s.errors) {
    const k = `${e.tool}:${e.msg.replace(/\d+/g, '#').slice(0, 100)}`
    const g = groups.get(k) ?? { tool: e.tool, msg: e.msg, count: 0, projects: new Set() }
    g.count++; g.projects.add(s.project)
    groups.set(k, g)
  }
  return {
    window,
    sessions: sessions.length,
    projects: Object.entries(projects).sort((a, b) => b[1].turns - a[1].turns).slice(0, 15).map(([name, p]) => ({ name, ...p })),
    retries: sessions.reduce((n, s) => n + s.retries, 0),
    corrections: corrections.slice(-40),
    errors: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20).map(g => ({ ...g, projects: [...g.projects] })),
    repeated: repeatedPhrases(sessions),
    openers: sessions.filter(s => s.user[0]).map(s => ({ project: s.project, text: clip(s.user[0].text.replace(/\s+/g, ' '), 120) })).slice(-60),
  }
}

export function findFiles(root, { days = 7, project = '' } = {}) {
  const since = Date.now() - days * 86400000, out = []
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const name = d.replace(/^-Users-[^-]+-/, '') || d
    if (project && !d.toLowerCase().includes(project.toLowerCase())) continue
    const dir = path.join(root, d)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f)
      if (f.endsWith('.jsonl') && fs.statSync(file).mtimeMs >= since) out.push({ file, project: name })
    }
  }
  return out
}

const parseLines = text => text.split('\n').flatMap(l => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : def }
  const days = Number(arg('--days', 7)), project = arg('--project', '')
  if (!(days > 0)) { console.error('--days takes a positive number'); process.exit(2) }
  const files = findFiles(path.join(os.homedir(), '.claude', 'projects'), { days, project })
  const sessions = files.map(f => ({ project: f.project, ...parseSession(parseLines(fs.readFileSync(f.file, 'utf8'))) })).filter(s => s.user.length)
  process.stdout.write(`${JSON.stringify(summarize(sessions, { days, project: project || 'all', since: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) }))}\n`)
}
