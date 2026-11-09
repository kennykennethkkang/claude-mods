// Bash runs without a prompt. A settings deny or ask rule still wins, and the commands below are always refused.
import type { Register } from 'claude-code'

export type Where = { cwd?: string; home?: string }

const RM_FLAG = /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/

const words = (seg: string) => seg.replace(/["']/g, ' ').trim().split(/\s+/).filter(Boolean)
const segments = (c: string) => c.split(/;|&&|\|\||[&|\n()`]|\$\(/)

// ~, $HOME, ${HOME} to the home folder; trailing / and /* dropped.
function resolve(p: string, w: Where): string {
  const home = w.home ?? '~'
  let r = p.replace(/^(~|\$\{?HOME\}?)(?=\/|$)/, home)
  if (!r.startsWith('/') && !r.startsWith('~')) r = `${w.cwd ?? '.'}/${r}`
  const out: string[] = []
  for (const part of r.split('/')) {
    if (part === '' || part === '.' || part === '*') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return r.startsWith('~') ? out.join('/') : `/${out.join('/')}`
}

// /, /Users, the home folder, ~/Documents, ~/Documents/GitHub (any user's, and the literal ~ forms).
const PROTECTED = /^(\/|\/Users|\/Users\/[^/]+(\/Documents(\/GitHub)?)?|~(\/Documents(\/GitHub)?)?|(.*\/)?Documents\/GitHub)$/
const isProtected = (p: string, w: Where) => {
  // A relative path with no known cwd is judged as written.
  if (!w.cwd && !/^(\/|~|\$\{?HOME)/.test(p)) return PROTECTED.test(p.replace(/\/\*?$/, ''))
  const r = resolve(p, w)
  return PROTECTED.test(r) || (!!w.home && [w.home, `${w.home}/Documents`, `${w.home}/Documents/GitHub`].includes(r))
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
    let i = t.indexOf('git') + 1
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

export const HARD: { test: (c: string, w: Where) => boolean; why: string }[] = [
  { test: wideDelete, why: 'rm -r or find -delete of /, the home folder, ~/Documents or ~/Documents/GitHub' },
  { test: c => /(^|[\s;&|(`"'])sudo\b/.test(c), why: 'sudo' },
  { test: c => /\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?((\S*\/)?env\s+)?(\S*\/)?((ba|z|da|k|fi)?sh|python[\d.]*|node|perl|ruby)\b/.test(c) || /\b(ba|z)?sh\b[^;&\n]*(\$\(|<\()\s*(curl|wget)\b/.test(c), why: 'a download piped into a shell' },
  { test: forceMain, why: 'a force push to main or master' },
  { test: c => new RegExp(`${READ}[^;&|\\n]*(^|[\\s/'"=])\\.env(?!\\.(example|sample|template)\\b)(\\.[\\w.-]+)?(?=[\\s'"]|$)`).test(c) || /<\s*\S*\.env\b(?!\.(example|sample|template))/.test(c), why: 'reading a .env file' },
  { test: c => segments(c).some(s => /^(printenv|env)$/.test(s.trim())), why: 'printing every environment variable' },
  { test: c => /\bsecurity\s+(find-(generic|internet)-password\b[^;&|\n]*\s-[a-zA-Z]*[wg][a-zA-Z]*\b|dump-keychain\b|export\b)/.test(c), why: 'printing a keychain secret' },
  { test: c => (/\.ssh\/(id_[\w-]+|[\w.-]+\.pem|[\w.-]*_key)(?![\w.-]*\.pub)\b/.test(c) && new RegExp(READ).test(c)) || sshSecret(c), why: 'reading an ~/.ssh key' },
  { test: c => /\bdiskutil\s+(erase\w*|zeroDisk|randomDisk|secureErase|partitionDisk|reformat)\b/i.test(c) || /\bdd\b[^;&|\n]*\bof=\/dev\//.test(c) || /\bmkfs(\.\w+)?\b/.test(c), why: 'a disk erase or raw disk write' },
]

export const hardDeny = (command: string, w: Where = {}) => HARD.find(h => h.test(command, w))?.why

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const w = { cwd: await $.session.cwd().catch(() => undefined), home: await $.env.get('HOME').catch(() => undefined) }
    const why = hardDeny(String((e as unknown as { command?: unknown }).command ?? ''), w)
    return why ? { deny: `bash-approve: always refused (${why}). Do it another way or ask Kenneth to run it.` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'bash-approve: the check failed, so the call was held.' }))

  // Core's verdict first: a deny stands, and so does an ask from a settings rule. Other asks become an allow.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const v = await next(e)
    if (v.decision === 'deny') return v
    const w = { cwd: await $.session.cwd().catch(() => undefined), home: await $.env.get('HOME').catch(() => undefined) }
    const why = hardDeny(String((e.input as { command?: unknown })?.command ?? ''), w)
    if (why) return { decision: 'deny', reason: `bash-approve: always refused (${why}).` }
    return v.decision === 'ask' && v.rule ? v : { decision: 'allow', reason: 'bash-approve' }
  })
}
