// Sign-in CLIs (aws, web app CLIs from Switchboard's Accounts page) use the account picked for the project, or the chat asks.
import type { EngineInterface, Register } from 'claude-code'

type Login = { id: string; label?: string; url?: string; domain?: string }
type App = { id: string; name?: string; url?: string; logins?: Login[] }
export type Data = {
  projects: Record<string, unknown>
  links: Record<string, Record<string, unknown>>
  apps: App[]
  profiles: string[]
}

// Heredoc bodies are data, not commands.
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n(?:[\s\S]*?\n)?[\t ]*\2[\t ]*(?=\n|$)/g
const noHeredocs = (s: string) => s.replace(HEREDOC, '<<H$3')
// Same length as s, heredoc bodies filled with _.
const maskHeredocs = (s: string) => s.replace(HEREDOC, m => { const i = m.indexOf('\n'); return m.slice(0, i) + m.slice(i).replace(/[^\n]/g, '_') })
// Masks quoted text and escapes with _, same length, so match indexes line up with the original.
function unquote(s: string) {
  let out = ''
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      // $(...) and `...` inside double quotes still run: keep them, masking their own quotes.
      // ponytail: parens are counted without regard to quotes inside, so "$(echo ')')" misreads; fine so far.
      const sub = q === '"' && (c === '`' || (c === '$' && s[i + 1] === '('))
      if (sub) {
        let j = i + (c === '$' ? 2 : 1)
        if (c === '`') while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1
        else for (let depth = 1; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break }
        const open = c === '$' ? 2 : 1
        const inner = s.slice(i + open, Math.min(j, s.length))
        out += s.slice(i, i + open) + unquote(inner) + s.slice(i + open + inner.length, j + 1)
        i = j
      } else if (c === q) { q = ''; out += c } else if (q === '"' && c === '\\' && i + 1 < s.length) { out += '__'; i++ } else out += '_'
      continue
    }
    if (c === '\\' && i + 1 < s.length) { out += '__'; i++; continue }
    if (c === "'" || c === '"') q = c
    out += c
  }
  return out
}
const PREFIX = String.raw`(?:(?:if|then|else|elif|do|while|until|time|command|builtin|exec|nohup|eval|!|\{)\s+|xargs(?:\s+-[IinPLlsEda]\s+\S+|\s+-\S+)*\s+|sudo(?:\s+-[ugCDhpRrT]\s+\S+|\s+-\S+)*\s+|env(?:\s+-[uSC]\s+\S+|\s+-\S+)*\s+|[A-Za-z_]\w*=\S*\s+)*`
const AT_CMD = new RegExp(String.raw`(?:^|[;&|\n(\x60])\s*${PREFIX}([^\s;&|()<>\x60]+)`, 'g')

// The string handed to bash/sh/zsh -c or eval is a command too, when that shell or eval is itself at a command position.
const SHELL_AT = new RegExp(String.raw`(?:^|[;&|\n(\x60])\s*${PREFIX}(?:[^\s;&|()<>\x60]*/)?(bash|sh|zsh|eval)(?=\s)`, 'g')
const STR = String.raw`("(?:[^"\\]|\\.)*"|'[^']*')`
const AFTER_SHELL = new RegExp(String.raw`^(?:\s+-[a-zA-Z]+)*?\s+-[a-zA-Z]*c[a-zA-Z]*(?:\s+-[a-zA-Z]+)*\s+${STR}`)
const AFTER_EVAL = new RegExp(String.raw`^\s+${STR}`)
/** The command plus every nested -c or eval string, heredoc bodies dropped. */
function pieces(cmd: string, depth = 0): string[] {
  const text = noHeredocs(cmd)
  if (depth > 3) return [text]
  return [text, ...[...unquote(text).matchAll(SHELL_AT)].flatMap(m => {
    const rest = text.slice(m.index! + m[0].length).match(m[1] === 'eval' ? AFTER_EVAL : AFTER_SHELL)
    if (!rest) return []
    const q = rest[1]
    const inner = q[0] === "'" ? q.slice(1, -1) : q.slice(1, -1).replace(/\\(["\\$`])/g, '$1')
    return pieces(inner, depth + 1)
  })]
}

/** CLIs (aws or an app id) run at a command position; quoted text is ignored. */
export function clisOf(cmd: string, appIds: string[]): string[] {
  const want = new Set(['aws', ...appIds])
  const found: string[] = []
  for (const m of pieces(cmd).flatMap(p => [...unquote(p).matchAll(AT_CMD)])) {
    const w = m[1].split('/').pop()!
    if (want.has(w) && !found.includes(w)) found.push(w)
  }
  return found
}

function resolve(p: string, cwd: string, home: string) {
  p = p.replace(/\\/g, '/')
  cwd = cwd.replace(/\\/g, '/'); home = home.replace(/\\/g, '/')
  const abs = p === '~' || p.startsWith('~/') ? home + p.slice(1) : p.startsWith('/') || /^[a-z]:\//i.test(p) ? p : `${cwd}/${p}`
  const drive = /^([a-z]:)(?:\/|$)/i.exec(abs)?.[1]
  if (drive) {
    const out: string[] = []
    for (const s of abs.slice(drive.length).split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s) }
    return `${drive}/${out.join('/')}`
  }
  const out: string[] = []
  for (const s of abs.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return `/${out.join('/')}`
}

const clean = (t: string) => t.replace(/^['"]|['"]$/g, '')
// ponytail: each cd resolves against the chat cwd, not the previous cd; chain them if that ever matters.
const cdsOf = (cmd: string, cwd: string, home: string) =>
  [...pieces(cmd).join('\n').matchAll(/(?:^|[;&|(\n{]|\b(?:then|do)\s)\s*cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)].map(m => resolve(clean(m[1]), cwd, home))

/** Folder a pick should be saved for, before the hook looks for its repo top. */
export const targetOf = (cmd: string, cwd: string, home: string) => cdsOf(cmd, cwd, home).at(-1) ?? resolve(cwd, '/', home)

/** The chat cwd, cd targets and absolute paths in the command. */
export function foldersOf(cmd: string, cwd: string, home: string): string[] {
  const text = pieces(cmd).join('\n')
  const paths = [
    ...[...text.matchAll(/(?:^|[\s=])(["'])((?:~|\/|[a-z]:[\\/])[^"']*)\1/gi)].map(m => m[2]),
    ...[...text.matchAll(/(?:^|[\s=])((?:~|\/|[a-z]:[\\/])[^\s'";|&)<>]*)/gi)].map(m => m[1]),
  ].map(p => resolve(p, cwd, home))
  return [...new Set([resolve(cwd, '/', home), ...cdsOf(cmd, cwd, home), ...paths])]
}

// ponytail: case-insensitive everywhere (macOS disks are); split by platform if Linux ever matters.
const low = (s: string) => s.replace(/\/+$/, '').toLowerCase()
/** Deepest folder key covering `folder`. */
function pickFor(map: Record<string, unknown>, folder: string) {
  const f = low(folder)
  let best: { key: string; value: unknown } | undefined
  for (const [key, value] of Object.entries(map)) {
    const k = low(key)
    if ((f === k || f.startsWith(`${k}/`)) && (!best || k.length > best.key.length)) best = { key, value }
  }
  return best
}

/** Distinct string picks across folders: value -> folder it was picked for. */
function picksOf(map: Record<string, unknown>, folders: string[]) {
  const picks = new Map<string, string>()
  for (const f of folders) {
    const p = pickFor(map, f)
    if (typeof p?.value === 'string' && p.value) picks.set(p.value, p.key)
  }
  return picks
}

/** Tenant domain of an Auth0 login: its domain, else a url host on auth0.com other than the dashboard. */
function tenantOf(l?: Login) {
  const host = /^https?:\/\/([^/:?#]+)/.exec(l?.url ?? '')?.[1]?.toLowerCase()
  const t = typeof l?.domain === 'string' && l.domain ? l.domain : host?.endsWith('.auth0.com') && host !== 'manage.auth0.com' ? host : undefined
  // Only a plain domain is spliced into commands and quoted strings.
  return t && /^[A-Za-z0-9.-]+$/.test(t) ? t : undefined
}

/**
 * Adds --tenant after the subcommand words of each auth0 call that has none, also inside bash/sh/zsh -c and eval
 * strings. `tenant` is a plain domain, so it needs no escaping in either quote style.
 */
function withTenant(cmd: string, tenant: string, depth = 0): string {
  const masked = unquote(maskHeredocs(cmd))
  const edits: { from: number; to: number; text: string }[] = []
  for (const m of masked.matchAll(AT_CMD)) {
    if (m[1].split('/').pop() !== 'auth0') continue
    const end = m.index! + m[0].length
    if (/(^|\s)--tenant(\s|=|$)/.test(/^[^;&|\n)]*/.exec(masked.slice(end))![0])) continue
    const at = end + /^(?:[ \t]+[a-z][a-z-]*(?=[\s;&|)\x60]|$))*/.exec(masked.slice(end))![0].length
    edits.push({ from: at, to: at, text: ` --tenant ${tenant}` })
  }
  if (depth < 4) {
    for (const m of masked.matchAll(SHELL_AT)) {
      const end = m.index! + m[0].length
      const rest = cmd.slice(end).match(m[1] === 'eval' ? AFTER_EVAL : AFTER_SHELL)
      if (!rest) continue
      const from = end + rest[0].length - rest[1].length + 1
      const to = end + rest[0].length - 1
      edits.push({ from, to, text: withTenant(cmd.slice(from, to), tenant, depth + 1) })
    }
  }
  return edits.sort((a, b) => b.from - a.from).reduce((c, e) => c.slice(0, e.from) + e.text + c.slice(e.to), cmd)
}

const shq = (s: string) => (/^[\w.@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export function decide(cmd: string, cwd: string, home: string, d: Data, root: string, top?: string):
  { deny: string } | { command?: string; context: string[] } | undefined {
  const clis = clisOf(cmd, d.apps.map(a => a.id))
  if (!clis.length) return
  const folders = foldersOf(cmd, cwd, home)
  const target = top ?? targetOf(cmd, cwd, home)
  const ask = 'Ask Kenneth which account to use (AskUserQuestion if you are the lead, mcp__switchboard__ask if you are a subagent), save it with'
  const deny: string[] = []
  const context: string[] = []
  let prefix = ''
  let body = cmd

  if (clis.includes('aws') && !/\bAWS_PROFILE=|--profile\b/.test(cmd)) {
    const picks = picksOf(d.projects, folders)
    if (picks.size === 1) {
      const [[p, key]] = picks
      prefix = `export AWS_PROFILE=${shq(p)}; `
      context.push(`account-guard: aws runs as profile ${p}, picked for ${key}.`)
    } else if (picks.size > 1) {
      deny.push(`aws: these folders have different profiles picked: ${[...picks].map(([p, k]) => `${k} uses ${p}`).join('; ')}. Ask Kenneth which one this command is for, then rerun it with AWS_PROFILE=<profile> in front.`)
    } else {
      deny.push(`aws: no AWS profile is picked for ${folders.join(', ')}. ${ask} \`node ${root}/bin/pick.mjs aws <profile> ${target}\` (or another project folder), then rerun. Profiles: ${d.profiles.join(', ') || 'none in ~/.aws/config'}.`)
    }
  }

  for (const app of d.apps.filter(a => clis.includes(a.id))) {
    const links = Object.fromEntries(Object.entries(d.links).map(([k, v]) => [k, v?.[app.id]]).filter(([, v]) => typeof v === 'string'))
    const picks = picksOf(links, folders)
    const logins = app.logins ?? []
    const name = (id: string) => logins.find(l => l.id === id)
    if (picks.size === 1) {
      const [[id, key]] = picks
      const l = name(id)
      const tenant = app.id === 'auth0' ? tenantOf(l) : undefined
      const tenanted = tenant ? withTenant(body, tenant) : body
      if (tenanted !== body) {
        body = tenanted
        context.push(`account-guard: auth0 runs with --tenant ${tenant} (login "${l?.label ?? id}", picked for ${key}).`)
      } else context.push(`account-guard: ${app.id} should use the login "${l?.label ?? id}"${l?.url ? ` (${l.url})` : ''}, picked for ${key}. This hook cannot switch its account; make sure the CLI is signed in to that one.`)
    } else if (picks.size > 1) {
      deny.push(`${app.id}: these folders have different logins picked: ${[...picks].map(([id, k]) => `${k} uses ${name(id)?.label ?? id}`).join('; ')}. Ask Kenneth which one this command is for.`)
    } else if (!logins.length && app.id === 'auth0') {
      deny.push(`auth0: no Auth0 tenants are saved yet. Ask Kenneth to sign in on Settings > Accounts > Auth0 (it runs auth0 login and adds the tenants), then pick one with \`node ${root}/bin/pick.mjs auth0 <login id> ${target}\`.`)
    } else if (!logins.length) {
      deny.push(`${app.id}: no logins are saved for ${app.name ?? app.id} yet. Ask Kenneth to add one on Switchboard's Accounts page, then pick it with \`node ${root}/bin/pick.mjs ${app.id} <login id> ${target}\`.`)
    } else {
      deny.push(`${app.id}: no login is picked for ${folders.join(', ')}. ${ask} \`node ${root}/bin/pick.mjs ${app.id} <login id> ${target}\` (or another project folder), then rerun. Logins: ${logins.map(l => `${l.label ?? l.id} (${l.id})`).join(', ')}.`)
    }
  }

  if (deny.length) return { deny: `account-guard: ${deny.join(' ')}` }
  const command = prefix || body !== cmd ? prefix + body : undefined
  if (command || context.length) return { command, context }
}

// The aws CLI's own error lines word for word (botocore, 2.38), so a log line that only shares a phrase does not trip it.
// shortcut: SSO role errors (UnauthorizedException on GetRoleCredentials) are not listed, add them if an SSO profile comes back.
const SIGNED_OUT = new RegExp(
  String.raw`^\s*(?:aws: \[ERROR\]: )?(?:(?:An error occurred \(NoCredentials\): )?(?:Your session has expired\. Please reauthenticate using|Unable to locate credentials\. You can configure credentials by running|Error loading SSO Token: Token for \S+ does not exist|Error when retrieving token from \S+: Token has expired|The SSO session associated with this profile has expired or is otherwise invalid)` +
  String.raw`|An error occurred \(ExpiredToken(?:Exception)?\) when calling the \w+ operation: )`, 'm')
/** True when aws output says the session is expired or there are no credentials. */
export const signedOut = (out: string) => SIGNED_OUT.test(out)

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
async function json($: EngineInterface, path: string): Promise<Record<string, any>> {
  try { const v = JSON.parse(String(await $.fs.read(path))); return isObj(v) ? v : {} } catch { return {} }
}

// Nearest folder holding .git, up to home; else the folder itself.
async function repoTop($: EngineInterface, folder: string, home: string) {
  for (let d = folder; d.length > home.length && d !== '/'; d = d.slice(0, d.lastIndexOf('/')) || '/') {
    if ((await $.fs.list(d).catch(() => [])).some(e => e.name === '.git')) return d
  }
  return folder
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/[\\/]+$/, '')
    const dir = (await $.env.get('ACCOUNT_GUARD_DIR')) || `${home}/.claude/switchboard`
    const logins = await json($, `${dir}/logins.json`)
    const apps: App[] = Array.isArray(logins.apps) ? logins.apps.filter((a: unknown) => isObj(a) && typeof a.id === 'string') : []
    if (!clisOf(e.command, apps.map(a => a.id)).length) return next(e)
    const prefs = await json($, `${dir}/aws-prefs.json`)
    const config = await $.fs.read((await $.env.get('AWS_CONFIG_FILE')) || `${home}/.aws/config`).then(String, () => '')
    const profiles = [...config.matchAll(/^\[(?:profile\s+([^\]]+)|(default))\]/gm)].map(m => (m[1] ?? m[2]).trim())
    const cwd = await $.session.cwd()
    const r = decide(e.command, cwd, home, {
      projects: isObj(prefs.projects) ? prefs.projects : {},
      links: isObj(logins.links) ? logins.links : {},
      apps, profiles,
    }, $.plugin.root, await repoTop($, targetOf(e.command, cwd, home), home))
    if (r && 'deny' in r) return { deny: r.deny }
    const out = await next(r?.command ? { ...e, command: r.command } : e)
    if (out.deny !== undefined) return out
    const profile = /\bAWS_PROFILE=([\w.@+-]+)|--profile[ =]([\w.@+-]+)/.exec(r?.command ?? e.command)
    const gone = clisOf(e.command, []).includes('aws') && signedOut(out.text ?? '')
      ? [`account-guard: AWS is signed out${profile ? ` for profile ${profile[1] ?? profile[2]}` : ''}. Skip work that only reads from AWS (prod logs, status probes) and list it as skipped in the standup; do not ask Kenneth to sign in for it. Ask for the login only when the task cannot be done without AWS (a deploy or an AWS change Kenneth asked for).`]
      : []
    const context = [...(r?.context ?? []), ...gone]
    return context.length ? { ...out, context: [...(out.context ?? []), ...context] } : out
  }).catch(($, e, next) => next(e)) // a guard bug never blocks Bash
}
