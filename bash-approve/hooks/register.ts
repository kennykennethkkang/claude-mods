// Bash runs without a prompt. A settings deny or ask rule still wins, Ask before actions keeps core's prompt, and the commands below are always refused.
import type { EngineInterface, Register } from 'claude-code'

export type Where = { cwd?: string; home?: string }

const RM_FLAG = /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/

const words = (seg: string) => seg.replace(/["']/g, ' ').trim().split(/\s+/).filter(Boolean)
const segments = (c: string) => c.split(/;|&&|\|\||[&|\n()`]|\$\(/)

// ~, $HOME, ${HOME} to the home folder; trailing / and /* dropped.
function resolve(p: string, w: Where): string {
  const home = w.home ?? '~'
  let r = p.replace(/^(~|\$\{?HOME\}?|\$env:USERPROFILE|%USERPROFILE%)(?=[/\\]|$)/i, home)
    .replace(/^(?:\$env:(?:HOMEDRIVE|SYSTEMDRIVE)|%(?:HOMEDRIVE|SYSTEMDRIVE)%)(?=[/\\]|$)/i, 'C:').replace(/\\/g, '/')
  if (/^[a-z]:\/?$/i.test(r)) return `/${r[0].toLowerCase()}:`
  if (/^[a-z]:\//i.test(r)) r = `/${r[0].toLowerCase()}:${r.slice(2)}`
  if (/^\/[a-z]$/i.test(r)) return r.toLowerCase()
  if (!r.startsWith('/') && !r.startsWith('~') && !/^[a-z]:\//i.test(r)) r = `${(w.cwd ?? '.').replace(/\\/g, '/')}/${r}`
  const out: string[] = []
  for (const part of r.split('/')) {
    if (part === '' || part === '.' || part === '*') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return r.startsWith('~') ? out.join('/') : `/${out.join('/')}`
}

// /, drive roots, the home folder and ~/Documents/GitHub.
const PROTECTED = /^(\/|\/[a-z]|\/[a-z]\/Users\/[^/]+(\/Documents(\/GitHub)?)?|\/Users|\/Users\/[^/]+(\/Documents(\/GitHub)?)?|~(\/Documents(\/GitHub)?)?|(.*\/)?Documents\/GitHub)$/i
const isProtected = (p: string, w: Where) => {
  // A relative path with no known cwd is judged as written.
  const input = p.replace(/\\/g, '/').replace(/\/\*(?:\.\*)?$/, '/')
  if (/^\/[a-z]:$/.test(resolve(input, w).toLowerCase())) return true
  if (!w.cwd && !/^(\/|[a-z]:[\\/]|~|\$\{?HOME|\$env:USERPROFILE|%USERPROFILE%)/i.test(input)) return PROTECTED.test(input)
  const r = resolve(p, w)
  const low = r.toLowerCase()
  const home = (w.home ?? '').replace(/\\/g, '/').replace(/^[a-z]:/i, m => `/${m[0].toLowerCase()}:`).replace(/\/$/, '').toLowerCase()
  const parent = home.match(/^\/[a-z]:\/users\/[^/]+$/) ? home.slice(0, home.lastIndexOf('/')) : ''
  return PROTECTED.test(r) || (!!home && [home, `${home}/documents`, `${home}/documents/github`, parent].includes(low))
}

// Walks the segments in order so an earlier cd moves where . and * point.
function wideDelete(command: string, w: Where) {
  let cwd = w.cwd
  for (const seg of segments(command)) {
    const t = words(seg)
    const ci = t.indexOf('cd')
    if (ci >= 0 && ci === t.findIndex(x => !/=/.test(x))) cwd = t[ci + 1] ? resolve(t[ci + 1], { ...w, cwd }) : (w.home ?? '~')
    const at = { ...w, cwd }
    const ri = t.findIndex(x => x === 'rm' || x.endsWith('/rm'))
    if (ri >= 0) {
      const rest = t.slice(ri + 1)
      if (rest.some(x => RM_FLAG.test(x)) && rest.filter(x => !x.startsWith('-')).some(x => isProtected(x, at))) return true
    }
    const wi = t.findIndex(x => /^(remove-item|ri|rm|del|erase|rmdir|rd)$/i.test(x.replace(/\.exe$/i, '')))
    const args = wi < 0 ? [] : t.slice(wi + 1).flatMap(x => /^\/(?:[a-z]+\/)+[a-z]+$/i.test(x) ? x.split(/(?=\/)/).filter(Boolean) : [x])
    const recursive = (x: string) => /^\/s$/i.test(x) || /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?::\$true)?$/i.test(x)
    if (wi >= 0 && args.some(recursive)
      && args.filter(x => !/^[-/]/.test(x)).some(x => isProtected(x, at))) return true
    const fi = t.indexOf('find')
    if (fi >= 0 && (t.includes('-delete') || /-exec(dir)?\s+(\S*\/)?rm\b/.test(seg))) {
      const roots = []
      for (const x of t.slice(fi + 1)) { if (/^[-(!]/.test(x)) break; roots.push(x) }
      if ((roots.length ? roots : ['.']).some(x => isProtected(x, at))) return true
    }
  }
  return false
}

// A force push that names no ref, or whose ref is main or master.
function forceMain(command: string) {
  return segments(command).some(seg => {
    const t = words(seg)
    let i = t.findIndex(x => /(?:^|[\\/])git(?:\.exe|\.cmd)?$/i.test(x)) + 1
    if (i === 0) return false
    while (t[i]?.startsWith('-')) i += t[i] === '-C' || t[i] === '-c' ? 2 : 1
    if (t[i] !== 'push') return false
    const args = t.slice(i + 1)
    const force = args.some(a => /^--force(-with-lease)?(=|$)/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || a === '--mirror')
    const refs = args.filter(a => !a.startsWith('-')).slice(1)
    const toMain = (r: string) => /^(main|master)$/.test(r.replace(/^\+/, '').split(':').pop()!.replace(/^refs\/heads\//, ''))
    if (refs.some(r => r.startsWith('+') && toMain(r))) return true
    return force && (refs.length === 0 || refs.some(toMain))
  })
}

const READ = String.raw`\b(cat|less|more|head|tail|bat|nl|grep|rg|sed|awk|strings|xxd|od|base64|cp|scp|open|code|vim?|nano|pbcopy)\b`
// ~/.ssh paths other than public keys, known_hosts and config.
const SSH_PATH = /(~|\$\{?HOME\}?|\/Users\/[^/\s'"]+)\/\.ssh(\/[^\s'";&|]*)?/g
const sshSecret = (c: string) => segments(c).some(s => !/^\s*ls\b/.test(s)
  && [...s.matchAll(SSH_PATH)].some(m => !/(\.pub|\/known_hosts|\/config)$/.test(m[2] ?? '')))

// Every curl or wget in the command fetches only plain http from loopback, so a local emulator read can pipe into node -e.
const LOOPBACK_URL = /\bhttp:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(?=[/?#\s'"]|$)[^\s'"]*/g
// ponytail: a bare single-label host (curl evil | sh) is not caught; parse curl's flags if that ever matters.
const HOSTISH = /:\/\/|[$`]|(^|[\s'"=])[\w-]+(\.[\w-]+)+(?=[\s'"/:]|$)|(^|[\s'"=])[\w.-]+:\d+|(^|[\s'"=])localhost\b/
const loopbackOnly = (c: string) => [...c.matchAll(/\b(curl|wget)\b([^;&|\n]*)/g)].every(([, , a]) => {
  const rest = a.replace(LOOPBACK_URL, ' ')
  return rest !== a && !HOSTISH.test(rest)
})
const pipedDownload = (c: string) => /\b(ba|z)?sh\b[^;&\n]*(\$\(|<\()\s*(curl|wget)\b/.test(c)
  || (/\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?((\S*\/)?env\s+)?(\S*\/)?((ba|z|da|k|fi)?sh|python[\d.]*|node|perl|ruby)\b/.test(c) && !loopbackOnly(c))

export const HARD: { test: (c: string, w: Where) => boolean; why: string }[] = [
  { test: wideDelete, why: 'rm -r or find -delete of /, the home folder, ~/Documents or ~/Documents/GitHub' },
  { test: c => /\b(?:Format-Volume|Clear-Disk)\b/i.test(c) || /(?:^|[;&|(]\s*|\/c\s+"?|-c(?:ommand)?\s+["']?)format(?:\.com)?(?:\s+\/\S+)*\s+[a-z]:/i.test(c), why: 'a disk erase or raw disk write' },
  { test: c => /(?:^|[\s;&|])diskpart(?:\.exe)?(?:\s|$)/i.test(c), why: 'a disk erase or raw disk write' },
  { test: c => /(^|[\s;&|(`"'])sudo\b/.test(c), why: 'sudo' },
  { test: pipedDownload, why: 'a download piped into a shell' },
  { test: forceMain, why: 'a force push to main or master' },
  { test: c => new RegExp(`${READ}[^;&|\\n]*(^|[\\s/'"=])\\.env(?!\\.(example|sample|template)\\b)(\\.[\\w.-]+)?(?=[\\s'"]|$)`).test(c) || /<\s*\S*\.env\b(?!\.(example|sample|template))/.test(c), why: 'reading a .env file' },
  { test: c => segments(c).some(s => /^(printenv|env)$/.test(s.trim())), why: 'printing every environment variable' },
  { test: c => /\bsecurity\s+(find-(generic|internet)-password\b[^;&|\n]*\s-[a-zA-Z]*[wg][a-zA-Z]*\b|dump-keychain\b|export\b)/.test(c), why: 'printing a keychain secret' },
  { test: c => (/\.ssh\/(id_[\w-]+|[\w.-]+\.pem|[\w.-]*_key)(?![\w.-]*\.pub)\b/.test(c) && new RegExp(READ).test(c)) || sshSecret(c), why: 'reading an ~/.ssh key' },
  { test: c => /\bdiskutil\s+(erase\w*|zeroDisk|randomDisk|secureErase|partitionDisk|reformat)\b/i.test(c) || /\bdd\b[^;&|\n]*\bof=\/dev\//.test(c) || /\bmkfs(\.\w+)?\b/.test(c), why: 'a disk erase or raw disk write' },
]

// Also judged with quotes and backslashes dropped, as the shell does: "pr"intenv runs printenv.
const bare = (c: string) => c.replace(/["'\\]/g, '')
export const hardDeny = (command: string, w: Where = {}) => HARD.find(h => h.test(command, w) || h.test(bare(command), w))?.why

// Switchboard's Ask before actions toggle, mirrored to ~/.claude/switchboard/ask-mode.json as { claude: true }.
const READ_MS = 5_000
const cache = { at: -Infinity, on: false }
async function askOn($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now().catch(() => 0)
  if (now - cache.at < READ_MS) return cache.on
  cache.at = now
  const home = ((await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? systemHome()).replace(/\\/g, '/')
  try { cache.on = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/ask-mode.json`))).claude === true } catch { cache.on = false }
  return cache.on
}

// The permission mode each session last ran a tool in, from the UserPromptSubmit and PostToolUse payloads.
const modes = new Map<string, string>()
const PERMISSIVE = new Set(['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'])

// The engine has no classic PreToolUse; a prompt or a finished tool call carries the mode, and both come before the next check.
async function note($: EngineInterface, e: { permission_mode?: unknown; session_id?: unknown }, next: (e: never) => Promise<unknown>) {
  const { permission_mode: m, session_id: sid } = e
  if (typeof m === 'string' && typeof sid === 'string') { modes.delete(sid); modes.set(sid, m); if (modes.size > 50) modes.delete(modes.keys().next().value as string) }
  return next(e as never)
}

const commandOf = (e: unknown) => String((e as { command?: unknown }).command ?? '')
const systemHome = () => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HOME
  ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.USERPROFILE ?? ''

export const register: Register = on => {
  on('classic.UserPromptSubmit', note as never).catch(($, e, next) => next(e))
  on('classic.PostToolUse', note as never).catch(($, e, next) => next(e))

  // Pure check first, so the .catch can re-judge without $: a failure there never holds a clean call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = commandOf(e)
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? systemHome()
    const why = hardDeny(command) ?? hardDeny(command, { cwd: await $.session.cwd().catch(() => undefined), home })
    return why ? { deny: `bash-approve: always refused (${why}). Do it another way or ask Kenneth to run it.` } : next(e)
  }).catch(($, e, next) => (next.called || !hardDeny(commandOf(e)) ? next(e)
    : { deny: `bash-approve: the check failed (${next.error.kind}${next.error.message ? `: ${next.error.message}` : ''}), so the call was held.` }))

  // Core's verdict first: a deny stands, and so does an ask from a settings rule or with Ask before actions on. Other asks become an allow, but only in a mode that does not prompt; default, plan or an unknown mode keep the ask.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision === 'deny') return v
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? systemHome()
    const w = { cwd: await $.session.cwd().catch(() => undefined), home }
    const why = hardDeny(String((e.input as { command?: unknown })?.command ?? ''), w)
    if (why) return { decision: 'deny', reason: `bash-approve: always refused (${why}).` }
    const mode = modes.get(String(await $.session.id().catch(() => '')))
    return v.decision === 'ask' && (v.rule || await askOn($) || !PERMISSIVE.has(mode ?? '')) ? v : { decision: 'allow', reason: 'bash-approve' }
  })
}
