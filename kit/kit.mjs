// The kit's pure parts, used by setup.mjs: what an export carries from this
// machine, the steps a setup runs on another, how settings merge, and which
// files never leave this machine.
import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'

// Preferences only: env, permissions, hooks and API key helpers stay where they are.
const SAFE_SETTINGS = [
  'model', 'theme', 'tui', 'agentPushNotifEnabled', 'inputNeededNotifEnabled',
  'autoCompactWindow', 'autoCompactEnabled', 'idleCompaction', 'skillListingMaxDescChars', 'skillListingBudgetFraction', 'autoContinueAtUsageLimit', 'remoteControlAtStartup',
]
// Claude Code syncs this bucket from the account by itself.
const SKIP_SKILLS = new Set(['synced'])
export const STATUS_LINE = { type: 'command', command: 'node <KIT>/statusline.mjs' }

export function exportManifest({ settings, known, skills, archived, presets, agents = [], now = Date.now() }) {
  const marketplaces = {}
  // Only where each comes from: installLocation and lastUpdated are this machine's.
  for (const [name, entry] of Object.entries(known)) {
    const source = entry.source ?? entry
    if (name === 'kenneth-mods') marketplaces[name] = { source: 'kit' }
    else if (source.source === 'github' && typeof source.repo === 'string') marketplaces[name] = { source: 'github', repo: source.repo }
    else if (source.source === 'git' && /^https?:\/\//i.test(source.url ?? '')) marketplaces[name] = { source: 'git', url: source.url, ...(source.sparsePaths ? { sparsePaths: source.sparsePaths } : {}) }
  }
  const safe = {}
  for (const key of SAFE_SETTINGS) if (settings[key] !== undefined) safe[key] = settings[key]
  safe.statusLine = STATUS_LINE
  return {
    version: 1,
    exportedAt: new Date(now).toISOString(),
    marketplaces,
    plugins: { ...(settings.enabledPlugins ?? {}) },
    settings: safe,
    skills: skills.filter(s => !SKIP_SKILLS.has(s)).sort(),
    skillsArchived: [...archived].sort(),
    jevPresets: [],
    agents: agents.filter(n => n.endsWith('.md')).sort(),
  }
}

// Installed copies can lag kit/skills, so an export only adds skills the kit lacks.
export function exportSkills(installed, inKit) {
  const has = new Set(inKit)
  return { copy: installed.filter(n => !has.has(n)), kept: installed.filter(n => has.has(n)) }
}

// By version, part by part as numbers: 0.17.10 is newer than 0.17.9.
// Exactly X.Y.Z, the same names Switchboard's self update accepts.
const vsixVersion = n => /^switchboard-(\d+)\.(\d+)\.(\d+)\.vsix$/.exec(n)?.slice(1).map(Number)
export const newestVsix = names => names.filter(vsixVersion).sort((a, b) => {
  const x = vsixVersion(a), y = vsixVersion(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}).pop()

export const releaseChecksumMatches = (bytes, text) => {
  const expected = /^([a-f\d]{64})(?:\s|$)/i.exec(text)?.[1]?.toLowerCase()
  return !!expected && createHash('sha256').update(bytes).digest('hex') === expected
}

/** Marketplaces, then plugins (installed, then turned off where they were off), skills, role subagents, settings, Switchboard. */
// kit/skills is the source for what it holds; the manifest adds skills that only come from elsewhere.
export function planSetup(m, { kit, vsix, kitSkills = [] }) {
  const repo = kit.replace(/[\\/]+kit[\\/]*$/, '')
  const steps = []
  for (const [name, src] of Object.entries(m.marketplaces)) {
    const from = src.source === 'kit' ? repo : src.source === 'github' ? src.repo : src.url ?? src.path
    if (from) steps.push({ kind: 'run', cmd: 'claude', args: ['plugin', 'marketplace', 'add', from], label: `marketplace ${name}` })
  }
  for (const [id, on] of Object.entries(m.plugins)) {
    steps.push({ kind: 'run', cmd: 'claude', args: ['plugin', 'install', id], label: `install ${id}` })
    if (!on) steps.push({ kind: 'run', cmd: 'claude', args: ['plugin', 'disable', id], label: `turn off ${id}` })
  }
  steps.push({ kind: 'copy', what: 'skills', names: [...new Set([...kitSkills, ...m.skills])].sort() })
  steps.push({ kind: 'copy', what: 'skills-archive', names: m.skillsArchived })
  steps.push({ kind: 'copy', what: 'jev-presets', names: m.jevPresets })
  steps.push({ kind: 'agents', names: m.agents ?? [] })
  steps.push({ kind: 'settings', settings: m.settings })
  if (vsix) steps.push({ kind: 'run', cmd: 'code', args: ['--install-extension', `${kit}/${vsix}`], label: 'Switchboard in VS Code' })
  return steps
}

/** The kit's keys win; everything else the machine has stays. The status line points at this kit. */
export function mergeSettings(current, fromKit, kitDir) {
  const kit = kitDir.replace(/\\/g, '/')
  const next = { ...current, ...fromKit }
  if (fromKit.statusLine?.command) {
    next.statusLine = { ...fromKit.statusLine, command: fromKit.statusLine.command.replace('<KIT>/statusline.mjs', `"${kit}/statusline.mjs"`) }
  }
  return next
}

// Key files by name; keys pasted into any other file by content.
const SECRET_NAME = /(^|[\\/])(\.env(\..+)?|.+\.(pem|key|p12|pfx|token)|id_(rsa|ed25519|ecdsa)(\.pub)?|credentials\.json|.*secrets?\.(json|ya?ml|txt))$/i
const SECRET_TEXT = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bAKIA[0-9A-Z]{16}\b/, /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
]
export const isSecretFile = (name, text) => SECRET_NAME.test(name) || SECRET_TEXT.some(re => re.test(text))

/** Where the one rules file is installed, each copy marked as generated so edits go to kit/rules.md. */
// Switchboard writes the same header and version line (extension/src/hub/rules.ts); the later rules win on both sides.
export const RULES_HEADER = '<!-- generated by claude-mods/kit/setup.mjs from kit/rules.md; edit that file -->\n'
const rulesSha = text => createHash('sha256').update(text).digest('hex').slice(0, 12)
const VERSION_LINE = /^<!-- rules-version: (\S+) sha256:[0-9a-f]+ -->$/m
/** Appended to the Codex copy only, after the rules: they name Claude tools. Same text in Switchboard's hub/rules.ts. */
export const CODEX_MAP = `
## Codex tool map

The rules above name Claude Code tools. In Codex use these instead:

- AskUserQuestion: \`mcp__switchboard__ask\` (\`request_user_input\` is a fallback only and takes title and options, not question), same question and options. "Approve this chat as finished?" keeps its exact wording and options "Approve" and "Send back".
- Agent and role subagents: \`spawn_agent\` (roles live in ~/.codex/agents), then \`wait_agent\`.
- ListAgents: run both \`claude agents --json\` in the shell (Claude chats in every project) and \`mcp__switchboard__chats_check\` (this project, Codex chats too). \`list_agents\` shows only your own subagents.
- SendMessage: \`send_message\` or \`send_input\`, whichever is listed, to your own subagents only. No tool reaches another chat: ask the user instead through \`mcp__switchboard__ask\`, naming each busy chat, what you will change and when, and whether to go ahead.
- Skill tool: read the SKILL.md under ~/.agents/skills/<name>/.
- Task tools: \`update_plan\` when listed, else keep the task list in your replies. ToolSearch: not needed, tools are already loaded.
- \`mcp__switchboard__*\` tools keep their names (the switchboard MCP is in ~/.codex/config.toml).
`
/** version: when rules.md last changed, an ISO time in UTC. */
export function rulesTargets(home, rules, version) {
  const text = `${RULES_HEADER}<!-- rules-version: ${version} sha256:${rulesSha(rules)} -->\n\n${rules}`
  return [{ path: `${home}/.claude/CLAUDE.md`, text, tail: '' }, { path: `${home}/.codex/AGENTS.md`, text: text + CODEX_MAP, tail: CODEX_MAP }]
}
/** skip: the file holds generated rules newer than these, say from a newer Switchboard. */
export function rulesAction(existing, rules, version, tail = '') {
  if (existing === undefined || !existing.startsWith(RULES_HEADER)) return 'write'
  const theirs = VERSION_LINE.exec(existing)?.[1]
  // A newer copy wins even with the same rules, or the version line flips back and forth with Switchboard's.
  return theirs && theirs > version ? 'skip' : 'write'
}

/** Refused without a prompt in every chat; everything else runs (bypass mode).
 * The rm rules are exact: wiping home or root is refused, subfolders are not. No `rm -rf /*`,
 * since a Bash rule's * matches any text and would refuse `rm -rf /tmp/x` too. */
export const DENY = [
  'Bash(git commit:*)', 'Bash(git push:*)',
  'Bash(rm -rf ~)', 'Bash(rm -rf ~/)', 'Bash(rm -rf $HOME)', 'Bash(rm -rf /)',
  'Read(~/**/.env*)', 'Read(~/.codex/auth.json)',
]
// Entries an older kit wrote that DENY replaced; a rerun removes them.
const OLD_DENY = ['Bash(rm -rf ~:*)', 'Bash(rm -rf /:*)', 'Read(**/.env*)']
export function withDeny(settings) {
  const p = settings.permissions ?? {}
  const deny = (p.deny ?? []).filter(d => !OLD_DENY.includes(d))
  for (const d of DENY) if (!deny.includes(d)) deny.push(d)
  // Full access in every chat; the deny list is the only brake. The flag skips bypass mode's warning on a new machine.
  return { ...settings, skipDangerousModePermissionPrompt: true, permissions: { ...p, defaultMode: 'bypassPermissions', deny } }
}

/** The machine's one Remote Control server, started in ~/Documents/GitHub. */
export const RC_NAME = 'Mac'
/** same-dir: phone chats start in the GitHub folder and can work in any repo under it. Bypass sets every phone chat's mode. */
export const rcArgs = () => ['remote-control', '--name', RC_NAME, '--spawn', 'same-dir', '--permission-mode', 'bypassPermissions']
/** Pids of per-repo servers from before the single one, from `pgrep -lf "remote-control --name"` output. */
export const oldRcPids = out => out.split('\n').flatMap(l => {
  const m = /^(\d+)\s+(.*?)\s+remote-control\s+--name\s+(\S+)/i.exec(l)
  // Windows rows can be node.exe "...claude-code\cli.js" or cmd.exe /c "claude.cmd ...": any claude before remote-control counts
  return m && /(^|[\\/\s"])claude(?:-code)?(?:\.(?:cmd|exe)|[\\/]|\s|"|$)/i.test(m[2]) && m[3] !== RC_NAME ? [Number(m[1])] : []
})
/** pgrep -f pattern (extended regex) for a running server with exactly this name. */
export const rcPattern = name => `remote-control --name ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`
/** Why a server exited, from what it wrote to stderr. */
export function rcExitNote(name, repo, err) {
  if (/Workspace not trusted/.test(err)) return `${name}: not trusted yet, run \`claude\` once in ${repo} and accept the trust prompt`
  const first = err.split('\n').map(l => l.trim()).find(Boolean)
  return `${name}: ${first ?? 'exited, see its log'}`
}

/** A running server's command line from before the kit started servers in bypass mode. */
export const staleRc = args => !/--permission-mode bypassPermissions( |"|$)/.test(args)

/** Windows has no pgrep: every process as "pid command line". */
export const PS_LIST = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
/** `pgrep -lf pattern` output on any OS, '' for none; run is spawnSync. */
export function procs(pattern, platform, run) {
  if (platform !== 'win32') return run('pgrep', ['-lf', pattern], { encoding: 'utf8' }).stdout ?? ''
  const re = new RegExp(pattern)
  const out = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_LIST], { encoding: 'utf8', windowsHide: true }).stdout ?? ''
  return out.split(/\r?\n/).filter(l => re.test(l)).join('\n')
}

/**
 * ~/.claude.json with each folder marked trusted, as accepting the trust prompt would, so a
 * server can start there non-interactively. Callers pass ~/Documents/GitHub only, never $HOME.
 * The same object back when nothing changes, so nothing is written.
 */
export function withTrust(config, repos) {
  const projects = config.projects ?? {}
  const todo = repos.filter(r => projects[r]?.hasTrustDialogAccepted !== true)
  if (!todo.length) return config
  const next = { ...projects }
  for (const r of todo) next[r] = { ...(projects[r] ?? {}), hasTrustDialogAccepted: true }
  return { ...config, projects: next }
}

/** A phone session the server holds this long without a turn is ended; a message from the phone serves it again. */
export const RC_IDLE_MS = 6 * 3_600_000
/**
 * Pids of the servers' phone sessions idle for RC_IDLE_MS. rows: { pid, ppid, args } of every process; sessions:
 * the parsed ~/.claude/sessions files. One with a shell still running is kept.
 */
export function idleRc(servers, rows, sessions, now) {
  return rows.filter(r => servers.includes(r.ppid) && r.args.includes(' --sdk-url ')).filter(r => {
    // A record left by an earlier process with this pid names another session.
    const s = sessions.find(x => x.pid === r.pid && x.bridgeSessionId && r.args.includes(`/${x.bridgeSessionId.replace('session_', 'cse_')}`))
    return s?.status === 'idle' && now - s.statusUpdatedAt >= RC_IDLE_MS && !rows.some(c => c.ppid === r.pid && c.args.includes('shell-snapshots'))
  }).map(r => r.pid)
}

export const RC_LABEL = 'com.kenneth.switchboard.rc'
export const RC_IDLE_LABEL = `${RC_LABEL}-idle`
/** A macOS LaunchAgent: the Remote Control server at login, or with every a run each that many seconds. */
export function launchAgent(node, script, { label = RC_LABEL, args = [], every } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string>${args.map(a => `<string>${a}</string>`).join('')}</array>
  ${every ? `<key>StartInterval</key><integer>${every}</integer>` : '<key>RunAtLoad</key><true/>'}
  <key>AbandonProcessGroup</key><true/>
</dict></plist>
`
}

const pathFor = platform => (platform === 'win32' ? win32 : posix)

/** PATH for the server: launchd and a Startup item start bare; claude lives in ~/.local/bin, npm's bin or next to node. */
export function rcPath(platform, { home, execDir, PATH = '', appData }) {
  const p = pathFor(platform)
  const extra = [p.join(home, '.local', 'bin'), ...(platform === 'win32' && appData ? [p.join(appData, 'npm')] : []), execDir]
  return [...extra, PATH].filter(Boolean).join(p.delimiter)
}

/** claude is claude.cmd on Windows, which runs only through a shell; rcArgs has no spaces, so nothing to quote. */
export const rcSpawn = platform => ({ shell: platform === 'win32', windowsHide: true })

/** A Startup-folder script that runs rc-servers.mjs at login with no window (Windows has no LaunchAgent). */
export const startupVbs = (node, script) => `CreateObject("WScript.Shell").Run """${node}"" ""${script}""", 0, False\r\n`

export const startupFile = (home, env) => win32.join(env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'switchboard-rc.vbs')

/** What starts the server at login on this OS, for --dry-run; undefined where the kit installs none. */
export function rcLogin(platform, home, env) {
  if (platform === 'darwin') return `LaunchAgent ${posix.join(home, 'Library', 'LaunchAgents', `${RC_LABEL}.plist`)}`
  if (platform === 'win32') return `Startup item ${startupFile(home, env)}`
  return undefined
}

/** One setup line for an API key: the env's, else one saved in Switchboard (saved(name)), else where to paste it. */
export function keyLine(label, name, env, saved) {
  if (env[name]?.trim()) return `${label}: ${name} found`
  if (saved(name)) return `${label}: key saved in Switchboard`
  return `${label}: missing, paste it in Switchboard: Settings, Accounts, API keys`
}

/** Codex role files, marked so a rerun knows which ones the kit owns. */
export const CODEX_AGENT_HEADER = '# generated by claude-mods/kit/setup.mjs from a Claude agent .md; edit that file\n'
// JSON strings are TOML basic strings, except DEL, which TOML wants escaped.
const tomlStr = s => JSON.stringify(s).replace(/\x7f/g, '\\u007f')
/** A Claude agent .md as a Codex role TOML. model is left out: sonnet/opus/haiku mean nothing to Codex, so it uses its own. */
export function codexAgent(md, prefix = '') {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md)
  if (!m) return undefined
  const front = Object.fromEntries(m[1].split(/\r?\n/).map(l => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"(.*)"$/, (_, s) => s.replace(/\\"/g, '"'))]))
  if (!front.name) return undefined
  return `${CODEX_AGENT_HEADER}name = ${tomlStr(prefix + front.name)}\ndescription = ${tomlStr(front.description ?? front.name)}\ndeveloper_instructions = ${tomlStr(m[2].trim())}\n`
}

/** Role files a Codex chat gets: not the -codex ones, which only exist to shell out to codex exec. */
export const codexRoleNames = names => names.filter(n => !/-codex\.md$/.test(n))

const CODEX_HOOK = 'codex-hooks.mjs'
/** ~/.codex/hooks.json with the kit's guard on PreToolUse, PostToolUse and Stop: its own group, found by script name, rewritten when the path moves, others kept. */
export function mergeCodexHooks(cfg, command) {
  const hooks = { ...(cfg?.hooks ?? {}) }
  for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) {
    const groups = (hooks[event] ?? [])
      .map(g => (g.hooks?.some(h => String(h.command).includes(CODEX_HOOK)) ? { ...g, hooks: g.hooks.filter(h => !String(h.command).includes(CODEX_HOOK)) } : g))
      .filter(g => g.hooks?.length !== 0)
    hooks[event] = [...groups, { hooks: [{ type: 'command', command, timeout: 10 }] }]
  }
  return { ...cfg, hooks }
}

/** The files of an installed Codex guard, as [path, text]: the hook beside type-stripped copies of the mods it loads. */
export const codexGuardFiles = (read, strip) => [
  ['codex-hooks.mjs', read('kit/codex-hooks.mjs')],
  ['guard-mods.json', read('kit/guard-mods.json')],
  ...JSON.parse(read('kit/guard-mods.json')).map(m => [`${m}/hooks/register.mjs`, strip(read(`${m}/hooks/register.ts`))]),
]

/** Marks a ~/.claude/rules file the kit wrote; same text in Switchboard's hub/rules.ts. */
export const PATH_RULE_MARK = '<!-- switchboard path rule: generated from kit/rules; edit the kit copy -->'
/** files: [name, text] from kit/rules. Claude Code loads each only when a matching file is read. */
export const pathRules = files => files.filter(([n]) => n.endsWith('.md')).sort(([a], [b]) => a < b ? -1 : 1).map(([n, raw]) => {
  const text = raw.replace(/\r\n/g, '\n')
  const head = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? ''
  return { name: `switchboard-${n}`, installed: `${head}${PATH_RULE_MARK}\n${text.slice(head.length)}`, body: text.slice(head.length).replace(/^\n+/, '') }
})
// Codex has no path rules, so it gets them in full; matches Switchboard's join.
export const withPathRules = (rules, prules) => rules + prules.map(r => `\n${r.body}`).join('')
