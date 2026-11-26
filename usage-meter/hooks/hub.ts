import type { EngineInterface } from 'claude-code'
import { feed, runs } from './state'

// Usage feed for Switchboard: posts this chat's context, limits, token diet and Jev runs
// to every open Switchboard window, and carries back what was typed in any of them (a
// message, Remote Control, a compaction). Draws nothing in the terminal.

export type Target = { port: number; token: string; workspace: string }
export type Discovery = { port?: unknown; hubToken?: unknown; workspace?: unknown }
export const POST_EVERY_MS = 5_000
export const POLL_MS = 2_000
export const REDISCOVER_MS = 30_000
export const FETCH_MS = 2_000
export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** Every Switchboard window (Agent Flow alone writes no hub token): any of them can show and talk to this chat. */
export function targetsOf(files: Discovery[]): Target[] {
  return files.flatMap(f => typeof f.port === 'number' && typeof f.hubToken === 'string' && typeof f.workspace === 'string'
    ? [{ port: f.port, token: f.hubToken, workspace: norm(f.workspace) }]
    : [])
}
export async function rootOf($: EngineInterface) { return norm(await Promise.resolve().then(() => $.session.root()).catch(() => $.session.cwd())) }
export function cwdOf($: EngineInterface) { return Promise.resolve().then(() => $.session.cwd()).then(norm).catch(() => '') }
export async function homeDir($: EngineInterface) { return norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '') }
/** The window whose folder holds the chat, deepest first: the one that opens the fresh chat. */
export function homeOf(targets: Target[], cwd: string): Target | undefined {
  const c = norm(cwd)
  return targets.filter(t => c === t.workspace || c.startsWith(`${t.workspace}/`)).sort((a, b) => b.workspace.length - a.workspace.length)[0]
}
export async function discover($: EngineInterface) {
  const now = await $.clock.now()
  if (now - feed.foundAt < REDISCOVER_MS) return feed.targets
  feed.foundAt = now
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const dir = `${norm(home)}/.claude/switchboard`
  const files: Discovery[] = []
  // Newest file first: a window writes its own when it starts.
  for (const e of [...await $.fs.list(dir).catch(() => [])].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (e.kind !== 'file' || !/^[0-9a-f]+-\d+\.json$/i.test(e.name)) continue
    try { files.push(JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))) } catch { /* a file mid-write */ }
  }
  feed.targets = targetsOf(files)
  return feed.targets
}
// $.http.fetch takes no timeout or signal, so a frozen window would hold the chat: undefined after two seconds.
// A host with no clock.sleep (a test double) just waits on the fetch.
export function fetchSoon($: EngineInterface, url: string, init?: Parameters<EngineInterface['http']['fetch']>[1]) {
  return Promise.race([
    $.http.fetch(url, init),
    Promise.resolve().then(() => $.clock.sleep(FETCH_MS)).then(() => undefined, () => new Promise<never>(() => {})),
  ]).catch(() => undefined)
}
// fetchSoon for a call the chat waits on: a sleep process, since clock.sleep would spend the handler's 10 s budget.
export function fetchWithin($: EngineInterface, seconds: number, url: string, init?: Parameters<EngineInterface['http']['fetch']>[1]) {
  return Promise.race([
    $.http.fetch(url, init),
    Promise.resolve().then(() => $.process.run(['sleep', String(seconds)], { timeoutMs: (seconds + 5) * 1000 })).then(() => undefined, () => new Promise<never>(() => {})),
  ]).catch(() => undefined)
}
// The window token goes in a header, out of the URL.
export const withToken = (t: Target) => ({ headers: { 'X-Switchboard-Token': t.token } })
export async function post($: EngineInterface, body: Record<string, unknown>) {
  await Promise.all((await discover($)).map(async t => {
    const sent = await fetchSoon($, `http://127.0.0.1:${t.port}/hub`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token, ...body }),
    })
    // A closed window or a new token: look again next time.
    if (!sent || sent.status === 403) feed.foundAt = -Infinity
  }))
}
