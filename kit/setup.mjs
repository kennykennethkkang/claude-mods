#!/usr/bin/env node
// Sets up Claude Code on this machine from the kit, or refreshes the kit from it.
//   node kit/setup.mjs             marketplaces, plugins, mods, skills, Jev presets, role subagents, settings, Switchboard
//   node kit/setup.mjs --dry-run   list those steps without running them
//   node kit/setup.mjs --export    write manifest.json, skills, presets and role subagents from this machine
//   node kit/setup.mjs --rules-only        only install kit/rules.md and kit/rules/*.md as ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md (and ~/.claude/rules)
//   node kit/setup.mjs --agents-only       only install kit/agents/*.md into ~/.claude/agents, and as Codex roles with ecc-agents
//   node kit/setup.mjs --codex-hooks-only  only copy kit/codex-hooks.mjs to ~/.codex/switchboard-guard and add it to ~/.codex/hooks.json (PreToolUse guards, PostToolUse record, Stop hold)
//   node kit/setup.mjs --permissions-only  only set bypass mode and the deny list in ~/.claude/settings.json
//   node kit/setup.mjs --rc-only           only install the Remote Control login item (macOS LaunchAgent, Windows Startup)
// macOS, Linux and Windows, Node 20 or later. Keys and sign-ins never travel in the kit.
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODEX_AGENT_HEADER, codexAgent, codexGuardFiles, codexRoleNames, mergeCodexHooks, exportManifest, exportSkills, isSecretFile, keyLine, launchAgent, mergeSettings, newestVsix, pathRules, PATH_RULE_MARK, planSetup, RC_LABEL, rcLogin, RULES_HEADER, rulesAction, rulesTargets, withPathRules, startupFile, startupVbs, withDeny } from './kit.mjs'

const KIT = dirname(fileURLToPath(import.meta.url))
const CLAUDE = join(homedir(), '.claude')
const CODEX = join(homedir(), '.codex')
const flags = new Set(process.argv.slice(2))
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback } }
// The first backup is the one worth keeping: a later run would only copy the kit's own output over it.
const backupOnce = path => { if (existsSync(path) && !existsSync(`${path}.before-kit`)) { copyFileSync(path, `${path}.before-kit`); console.log(`> kept the old ${path} as ${path}.before-kit`) } }
const list = dir => (existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.')) : [])
const listDirs = dir => list(dir).filter(n => statSync(join(dir, n)).isDirectory())

/** Copies a folder without secret-looking files; collects what it left behind. */
function copyClean(from, to, skipped) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const src = join(from, name), dest = join(to, name)
    const st = statSync(src)
    if (st.isDirectory()) {
      if (!['node_modules', '.git', '__pycache__'].includes(name)) copyClean(src, dest, skipped)
      continue
    }
    const text = st.size < 2_000_000 ? readFileSync(src, 'utf8') : ''
    if (isSecretFile(name, text)) skipped.push(src)
    else copyFileSync(src, dest)
  }
}

function exportKit() {
  const settings = readJson(join(CLAUDE, 'settings.json'), {})
  const known = readJson(join(CLAUDE, 'plugins', 'known_marketplaces.json'), {})
  const m = exportManifest({
    settings, known,
    skills: list(join(CLAUDE, 'skills')),
    archived: list(join(CLAUDE, 'skills-archive')),
    presets: list(join(CLAUDE, 'jev-presets')).filter(n => n.endsWith('.json')),
    agents: list(join(CLAUDE, 'agents')),
  })
  const skipped = []
  const { copy, kept } = exportSkills(m.skills, listDirs(join(KIT, 'skills')))
  for (const n of copy) copyClean(join(CLAUDE, 'skills', n), join(KIT, 'skills', n), skipped)
  rmSync(join(KIT, 'skills-archive'), { recursive: true, force: true })
  for (const n of m.skillsArchived) copyClean(join(CLAUDE, 'skills-archive', n), join(KIT, 'skills-archive', n), skipped)
  for (const [dir, names] of [['jev-presets', m.jevPresets], ['agents', m.agents]]) {
    rmSync(join(KIT, dir), { recursive: true, force: true })
    mkdirSync(join(KIT, dir), { recursive: true })
    for (const n of names) {
      const text = readFileSync(join(CLAUDE, dir, n), 'utf8')
      if (isSecretFile(n, text)) skipped.push(join(CLAUDE, dir, n))
      else writeFileSync(join(KIT, dir, n), text)
    }
  }
  writeFileSync(join(KIT, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`)
  console.log(`Kit written: ${Object.keys(m.plugins).length} plugins, ${m.skills.length} skills (${m.skillsArchived.length} archived), ${m.jevPresets.length} Jev presets, ${m.agents.length} subagents, ${Object.keys(m.settings).length} settings.`)
  if (kept.length) console.log(`Kept kit/skills as is for ${kept.join(', ')}: edit those in the kit, setup installs them.`)
  if (skipped.length) console.log(`Left behind because they look like secrets:\n  ${skipped.join('\n  ')}`)
}

/** claude and code are .cmd or .exe shims on Windows, which need a shell; paths with spaces are quoted there. */
function run(cmd, args) {
  const win = process.platform === 'win32'
  const r = spawnSync(cmd, win ? args.map(a => (/\s/.test(a) ? `"${a}"` : a)) : args, { stdio: 'inherit', shell: win })
  return r.status === 0
}

function setup(dry) {
  const m = readJson(join(KIT, 'manifest.json'), null)
  if (!m) {
    console.error('No manifest.json here: run node kit/setup.mjs --export on the machine you are copying from, then push the kit.')
    process.exit(1)
  }
  const vsix = newestVsix(list(KIT))
  const steps = planSetup(m, { kit: KIT.replace(/\\/g, '/'), vsix, kitSkills: listDirs(join(KIT, 'skills')) })
  if (!dry && !run('claude', ['--version'])) {
    console.error('Install Claude Code first (https://claude.com/claude-code), sign in, then run this again.')
    process.exit(1)
  }
  const failed = []
  for (const s of steps) {
    if (s.kind === 'run') {
      console.log(`> ${s.cmd} ${s.args.join(' ')}`)
      // Adding a marketplace that is already there fails harmlessly; anything else is listed at the end.
      if (!dry && !run(s.cmd, s.args) && !s.args.includes('marketplace')) failed.push(s.label)
    } else if (s.kind === 'copy') {
      console.log(`> copy ${s.names.length} ${s.what} into ${join(CLAUDE, s.what)}`)
      if (!dry) for (const n of s.names) if (existsSync(join(KIT, s.what, n))) cpSync(join(KIT, s.what, n), join(CLAUDE, s.what, n), { recursive: true })
    } else if (s.kind === 'agents') {
      installAgents(s.names, dry)
    } else if (s.kind === 'settings') {
      const path = join(CLAUDE, 'settings.json')
      console.log(`> merge ${Object.keys(s.settings).join(', ')} into ${path}`)
      if (!dry) {
        mkdirSync(CLAUDE, { recursive: true })
        backupOnce(path)
        writeFileSync(path, `${JSON.stringify(withDeny(mergeSettings(readJson(path, {}), s.settings, KIT)), null, 2)}\n`)
      }
    }
  }
  const login = rcLogin(process.platform, homedir(), process.env)
  if (login) console.log(`> Remote Control at login: ${login}`)
  if (dry) return
  installRules()
  installCodexHooks()
  installRc()
  if (failed.length) console.log(`\nDid not finish, try these again by hand:\n  ${failed.join('\n  ')}`)
  if (!vsix) console.log('\nNo Switchboard .vsix in the kit: package it on the Mac (see the README) and run this again.')
  console.log(`
Still yours to do, since keys and sign-ins never travel in the kit:
  - Claude and Codex: run claude once to sign in, and codex login
  - ${keyLine('Jev (OpenRouter)', 'OPENROUTER_API_KEY', process.env, keychainHas)}
  - Bland: run /bland:setup for its key
  - ${keyLine('Gemini', 'GEMINI_API_KEY', process.env, keychainHas)}
  - AWS: aws login --profile <name>
  - Restart VS Code, click the Switchboard icon in the left bar, and run /reload-plugins in any chat that was already open`)
}

// Without -w, security prints only the item's attributes, never the key.
const keychainHas = name => process.platform === 'darwin'
  ? spawnSync('security', ['find-generic-password', '-s', 'switchboard', '-a', name], { stdio: 'ignore' }).status === 0
  : existsSync(join(homedir(), '.claude', 'switchboard', 'keys', name))

/** kit/rules/*.md to ~/.claude/rules/switchboard-*.md; unmarked files are the user's and stay, marked leftovers go. */
function installPathRules(prules) {
  const claude = join(homedir(), '.claude')
  if (!existsSync(claude)) return
  const rdir = join(claude, 'rules')
  for (const r of prules) {
    const dest = join(rdir, r.name), mine = existsSync(dest) ? readFileSync(dest, 'utf8') : undefined
    if (mine === r.installed) continue
    if (mine !== undefined && !mine.includes(PATH_RULE_MARK)) { console.log(`> skip ${dest}: yours`); continue }
    mkdirSync(rdir, { recursive: true })
    writeFileSync(dest, r.installed)
    console.log(`> rule written to ${dest}`)
  }
  const keep = new Set(prules.map(r => r.name))
  for (const n of existsSync(rdir) ? readdirSync(rdir) : []) {
    if (!n.startsWith('switchboard-') || !n.endsWith('.md') || keep.has(n)) continue
    if (readFileSync(join(rdir, n), 'utf8').includes(PATH_RULE_MARK)) { rmSync(join(rdir, n)); console.log(`> removed ${join(rdir, n)}`) }
  }
}

/** kit/rules.md to every agent that is installed; a hand-written file is kept as .before-kit first. */
function installRules() {
  const rules = readFileSync(join(KIT, 'rules.md'), 'utf8')
  const rdir = join(KIT, 'rules')
  const names = existsSync(rdir) ? readdirSync(rdir) : []
  const prules = pathRules(names.map(n => [n, readFileSync(join(rdir, n), 'utf8')]))
  const newest = Math.max(...['rules.md', ...prules.map(r => `rules/${r.name.slice('switchboard-'.length)}`)].map(n => statSync(join(KIT, n)).mtimeMs))
  const version = `${new Date(newest).toISOString().slice(0, 19)}Z`
  const [claude] = rulesTargets(homedir(), rules, version)
  const [, codex] = rulesTargets(homedir(), withPathRules(rules, prules), version)
  installPathRules(prules)
  for (const t of [claude, codex]) {
    if (!existsSync(dirname(t.path))) { console.log(`> skip ${t.path}: not installed`); continue }
    const existing = existsSync(t.path) ? readFileSync(t.path, 'utf8') : undefined
    if (rulesAction(existing, rules, version, t.tail) === 'skip') { console.log(`> skip ${t.path}: newer rules already there`); continue }
    if (existing !== undefined && !existing.startsWith(RULES_HEADER)) backupOnce(t.path)
    writeFileSync(t.path, t.text)
    console.log(`> rules written to ${t.path}`)
  }
}

/** kit/agents/*.md into ~/.claude/agents; a different file already there is kept as .before-kit first. */
function installAgents(names, dry) {
  const dir = join(CLAUDE, 'agents')
  console.log(`> copy ${names.length} agents into ${dir}`)
  if (dry) return
  mkdirSync(dir, { recursive: true })
  for (const n of names) {
    const src = join(KIT, 'agents', n), dest = join(dir, n)
    if (!existsSync(src)) continue
    const text = readFileSync(src, 'utf8')
    if (existsSync(dest) && readFileSync(dest, 'utf8') !== text) backupOnce(dest)
    writeFileSync(dest, text)
  }
  installCodexAgents(names)
}

/** The same roles plus ecc-agents (as ecc-<name>) into ~/.codex/agents; a hand-made TOML is kept as .before-kit first. */
function installCodexAgents(names) {
  if (!existsSync(CODEX)) { console.log(`> skip Codex roles: ${CODEX} not installed`); return }
  const ecc = join(KIT, '..', 'ecc-agents', 'agents')
  const srcs = [...codexRoleNames(names).map(n => [join(KIT, 'agents', n), '']), ...list(ecc).filter(n => n.endsWith('.md')).map(n => [join(ecc, n), 'ecc-'])]
  const dir = join(CODEX, 'agents')
  mkdirSync(dir, { recursive: true })
  // Copies an older setup wrote for the -codex roles go; a hand-made one stays.
  for (const n of names.filter(n => !codexRoleNames([n]).length)) {
    const old = join(dir, `${n.replace(/\.md$/, '')}.toml`)
    if (existsSync(old) && readFileSync(old, 'utf8').startsWith(CODEX_AGENT_HEADER)) { rmSync(old); console.log(`> removed ${old}`) }
  }
  let n = 0
  for (const [src, prefix] of srcs) {
    const toml = existsSync(src) && codexAgent(readFileSync(src, 'utf8'), prefix)
    if (!toml) continue
    const dest = join(dir, `${/^name = "(.*)"$/m.exec(toml)[1]}.toml`)
    const old = existsSync(dest) ? readFileSync(dest, 'utf8') : undefined
    if (old !== undefined && old !== toml && !old.startsWith(CODEX_AGENT_HEADER)) backupOnce(dest)
    writeFileSync(dest, toml)
    n++
  }
  console.log(`> wrote ${n} Codex roles into ${dir}`)
}

/** codex-hooks.mjs on Codex's PreToolUse, PostToolUse and Stop, beside the hooks Switchboard wrote there. */
function installCodexHooks() {
  if (!existsSync(CODEX)) { console.log(`> skip Codex hooks: ${CODEX} not installed`); return }
  const path = join(CODEX, 'hooks.json')
  const node = spawnSync('/bin/sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout?.trim() || process.execPath
  const cfg = readJson(path, undefined)
  if (existsSync(path) && !cfg) { console.log(`> skip Codex hooks: ${path} does not parse`); return }
  // A plain JS copy outside the repo: runs on any Node and survives the repo moving.
  // source.json lets the copy rebuild itself when the repo's files are newer.
  if (!nodeModule.stripTypeScriptTypes) { console.log(`> skip Codex hooks: setup needs Node 22.13 or later to build them, found ${process.version}`); return }
  const guard = join(CODEX, 'switchboard-guard')
  for (const [rel, text] of codexGuardFiles(r => readFileSync(join(KIT, '..', r), 'utf8'), nodeModule.stripTypeScriptTypes)) {
    mkdirSync(dirname(join(guard, rel)), { recursive: true })
    writeFileSync(join(guard, rel), text)
  }
  writeFileSync(join(guard, 'source.json'), `${JSON.stringify({ root: join(KIT, '..') })}\n`)
  const next = mergeCodexHooks(cfg ?? {}, `"${node}" "${join(guard, 'codex-hooks.mjs')}"`)
  backupOnce(path)
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  JSON.parse(readFileSync(path, 'utf8'))
  console.log(`> Codex guard hooks in ${path}`)
}

/** Bypass mode and the deny list, for when only permissions should change. */
function applyPermissions() {
  const path = join(CLAUDE, 'settings.json')
  mkdirSync(CLAUDE, { recursive: true })
  backupOnce(path)
  writeFileSync(path, `${JSON.stringify(withDeny(readJson(path, {})), null, 2)}\n`)
  console.log(`> permissions set in ${path}`)
}

/** A login item that starts the Remote Control server at login, and once now. */
function installRc() {
  if (process.platform === 'win32') return installRcWindows()
  if (process.platform !== 'darwin') return
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${RC_LABEL}.plist`)
  mkdirSync(dirname(plist), { recursive: true })
  if (existsSync(plist)) spawnSync('launchctl', ['unload', plist])
  // The node on PATH (a stable symlink), not process.execPath, which names a versioned folder a brew upgrade removes.
  const node = spawnSync('/bin/sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim() || process.execPath
  writeFileSync(plist, launchAgent(node, join(KIT, 'rc-servers.mjs')))
  console.log(`> Remote Control LaunchAgent at ${plist}`)
  if (!run('launchctl', ['load', '-w', plist])) console.log('  launchctl load failed: run it by hand')
  // At login the agent opens rc-servers.mjs inside ~/Documents, which macOS holds until node is allowed there.
  console.log(`  Give node access to your Documents folder: System Settings > Privacy & Security > Files and Folders (or Full Disk Access) > node (${node}).
  The server runs in ~/Documents/GitHub; node ${join(KIT, 'rc-servers.mjs')} marks that folder trusted and says if it still refuses.`)
}

/** Windows: a hidden .vbs in the Startup folder (no admin, unlike schtasks /sc onlogon), then one run now. */
function installRcWindows() {
  const file = startupFile(homedir(), process.env)
  mkdirSync(dirname(file), { recursive: true })
  // process.execPath is the installed node.exe; it moves only when Node is reinstalled elsewhere.
  writeFileSync(file, startupVbs(process.execPath, join(KIT, 'rc-servers.mjs')))
  console.log(`> Remote Control Startup item at ${file}`)
  if (spawnSync(process.execPath, [join(KIT, 'rc-servers.mjs')], { stdio: 'inherit', windowsHide: true }).status !== 0) console.log(`  could not start it now: run node ${join(KIT, 'rc-servers.mjs')} by hand`)
}

if (flags.has('--export')) exportKit()
else if (flags.has('--rules-only')) installRules()
else if (flags.has('--codex-hooks-only')) installCodexHooks()
else if (flags.has('--agents-only')) installAgents(readJson(join(KIT, 'manifest.json'), {}).agents ?? [], false)
else if (flags.has('--permissions-only')) applyPermissions()
else if (flags.has('--rc-only')) installRc()
else setup(flags.has('--dry-run'))
