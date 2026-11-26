#!/usr/bin/env node
// Starts the machine's one Remote Control server (RC_NAME) in ~/Documents/GitHub: marks that folder
// trusted first, stops per-repo servers, keeps one already running in bypass mode, restarts an older one.
// The kit's LaunchAgent runs this at login; running it by hand is safe. --idle (hourly, macOS) only ends phone
// sessions idle for RC_IDLE_MS and starts nothing.
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { idleRc, oldRcPids, RC_IDLE_MS, RC_NAME, rcArgs, rcExitNote, rcPath, procs, rcPattern, rcSpawn, staleRc, withTrust } from './kit.mjs'

const home = homedir()
const root = join(home, 'Documents', 'GitHub')
const logs = join(home, '.claude', 'switchboard')
fs.mkdirSync(logs, { recursive: true })
// launchd and a Startup item start with a bare PATH; claude lives in ~/.local/bin (native), npm's bin or next to node.
const env = { ...process.env, PATH: rcPath(process.platform, { home, execDir: dirname(process.execPath), PATH: process.env.PATH, appData: process.env.APPDATA }) }
// Windows env keys ignore case: drop the copied Path so only PATH reaches claude.
if (process.platform === 'win32') delete env.Path
delete env.CLAUDE_CODE_CHILD_SESSION
const SETTLE_MS = 3_000

/** Starts the server and resolves with a line saying whether it is still up after a few seconds. */
function start() {
  const logPath = join(logs, `rc-${RC_NAME}.log`)
  // A fresh log each run, holding stderr only: stdout is the live screen, megabytes a day.
  const log = fs.openSync(logPath, 'w')
  const child = spawn('claude', rcArgs(), { cwd: root, env, detached: true, stdio: ['ignore', 'ignore', log], ...rcSpawn(process.platform) })
  return new Promise(resolve => {
    const done = line => { clearTimeout(timer); child.removeAllListeners(); child.unref(); resolve(line) }
    const timer = setTimeout(() => done(`started ${RC_NAME} in ${root} (pid ${child.pid}), errors to ${logPath}`), SETTLE_MS)
    child.on('error', e => done(`${RC_NAME}: ${e.message}`))
    child.on('exit', () => done(rcExitNote(RC_NAME, root, fs.readFileSync(logPath, 'utf8'))))
  })
}

/** Servers with RC_NAME running now. */
function running() {
  const out = procs(rcPattern(RC_NAME), process.platform, spawnSync).trim()
  return out ? out.split('\n').map(l => ({ pid: Number(l.split(' ')[0]), args: l })) : []
}

function endIdle() {
  const rows = (spawnSync('ps', ['-Awwo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 16 << 20 }).stdout ?? '').split('\n')
    .flatMap(l => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }] : [] })
  const dir = join(home, '.claude', 'sessions')
  const sessions = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).flatMap(f => { try { return [JSON.parse(fs.readFileSync(join(dir, f), 'utf8'))] } catch { return [] } })
  const idle = idleRc(running().map(s => s.pid), rows, sessions, Date.now())
  // SIGKILL: the server takes it as a crash and serves the session again on the next message. SIGTERM reads as
  // an interrupt and its work stays held. The helpers are ended by hand, since nothing cleans up after SIGKILL.
  for (const pid of idle) {
    try { process.kill(pid, 'SIGKILL') } catch { continue }
    for (const c of rows.filter(r => r.ppid === pid)) { try { process.kill(c.pid) } catch {} }
  }
  console.log(`ended ${idle.length} phone session(s) idle over ${RC_IDLE_MS / 3_600_000} h`)
}

if (process.argv.includes('--idle')) { if (process.platform !== 'win32') endIdle(); process.exit(0) }

// Trust, written atomically and re-read just before, since running chats also write this file.
const configPath = join(home, '.claude.json')
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const next = withTrust(config, [root])
  if (next !== config) {
    const tmp = `${configPath}.kit-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    fs.renameSync(tmp, configPath)
    console.log(`trusted: ${root}`)
  }
} catch (e) {
  console.log(`could not mark ${root} trusted (${e.message}); if the server refuses, run \`claude\` there once`)
}

// Per-repo servers an older kit started: stopped, so every machine ends up with just this one.
const old = oldRcPids(procs('remote-control --name', process.platform, spawnSync))
for (const pid of old) { try { process.kill(pid) } catch {} }
if (old.length) console.log(`stopped ${old.length} per-repo server(s)`)

// On Windows both cmd.exe and claude carry the command line; both are killed on a restart.
const now = running()
if (now.length && !now.some(s => staleRc(s.args))) console.log(`running ${RC_NAME}`)
else {
  // Started before bypass mode: phone chats would still ask for permission.
  for (const s of now) { try { process.kill(s.pid) } catch {} }
  if (now.length) { console.log(`restarting ${RC_NAME} in bypass mode`); await new Promise(r => setTimeout(r, 1000)) }
  console.log(await start())
}
