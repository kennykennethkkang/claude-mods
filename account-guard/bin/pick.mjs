#!/usr/bin/env node
// Saves which account a project uses: node pick.mjs <aws|appId> <profile|login id or label> <folder>
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const [kind, value, folderArg] = process.argv.slice(2)
const fail = msg => { console.error(`pick: ${msg}`); process.exit(1) }
if (!kind || !value || !folderArg) fail('usage: pick.mjs <aws|appId> <profile|login> <folder>')

const dir = process.env.ACCOUNT_GUARD_DIR || join(homedir(), '.claude/switchboard')
// A missing file starts empty; one that does not parse is never overwritten.
const read = f => {
  let text
  try { text = readFileSync(join(dir, f), 'utf8') } catch { return {} }
  try { return JSON.parse(text) } catch (e) { fail(`${join(dir, f)} does not parse (${e.message}); fix it by hand, nothing was written`) }
}
const write = (f, data) => {
  const tmp = join(dir, `${f}.${process.pid}.tmp`)
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, join(dir, f))
}
// Reuse a key that differs only in case (macOS folders).
const folder = resolve(folderArg).replace(/(.)\/+$/, '$1')
const same = map => Object.keys(map).find(k => k.replace(/\/+$/, '').toLowerCase() === folder.toLowerCase())
// Picks cover subfolders, so only a repo top (or a folder already picked) may hold one; never / or home.
const keyIn = map => {
  const k = same(map)
  if (folder !== '/' && folder !== homedir() && (k || existsSync(join(folder, '.git')))) return k ?? folder
  fail(`${folder} is not a repo top (no .git) or a folder already picked; pass the repo top`)
}

if (kind === 'aws') {
  let config = ''
  try { config = readFileSync(process.env.AWS_CONFIG_FILE || join(homedir(), '.aws/config'), 'utf8') } catch {}
  const profiles = [...config.matchAll(/^\[(?:profile\s+([^\]]+)|(default))\]/gm)].map(m => (m[1] ?? m[2]).trim())
  if (!profiles.includes(value)) fail(`no AWS profile ${value}. Profiles: ${profiles.join(', ') || 'none'}`)
  const prefs = read('aws-prefs.json')
  prefs.projects = prefs.projects ?? {}
  prefs.projects[keyIn(prefs.projects)] = value
  write('aws-prefs.json', prefs)
  console.log(`aws uses ${value} for ${folder}`)
} else {
  const data = read('logins.json')
  const app = (data.apps ?? []).find(a => a.id === kind)
  if (!app) fail(`no app ${kind} on Switchboard's Accounts page`)
  const login = (app.logins ?? []).find(l => l.id === value) ?? (app.logins ?? []).find(l => l.label === value)
  if (!login) fail(`no ${kind} login ${value}. Logins: ${(app.logins ?? []).map(l => `${l.label} (${l.id})`).join(', ') || 'none'}`)
  data.links = data.links ?? {}
  const key = keyIn(data.links)
  data.links[key] = { ...data.links[key], [kind]: login.id }
  write('logins.json', data)
  console.log(`${kind} uses ${login.label ?? login.id} for ${folder}`)
}
