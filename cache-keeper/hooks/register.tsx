// Keeps an idle chat's prompt cache warm: a silent fork just before the cache would expire
// rereads the same prefix and resets its lifetime. Shows warm/cold above the prompt, in the
// status line and on the chat's Switchboard card.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Keep } from '../types'

const MIN = 60_000
const PROMPT = 'Keep-alive ping from cache-keeper. Reply with one word: ok.'
// ponytail: the engine does not expose the cache TTL, so it is a setting (60m on a subscription,
// 5m in overage). A wrong guess shows up as a cold ping, which stops that idle stretch.
let ttl = 60 * MIN
let margin = 5 * MIN
let idleCap = 3 * 60 * MIN
// Read under half the context: the conversation prefix was gone, only system/tools hit.
const COLD_SHARE = 0.5
const RETRY_MS = MIN

const keep = atom({ plugin: 'cache-keeper', key: 'keep' } as const, null)

const mins = (ms: number) => Math.max(0, Math.round(ms / MIN))
const size = (n: number) => n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / 1e3)}k`

export function bandLine(k: Keep, now: number, m = margin): string | undefined {
  if (k.state === 'cold') return `cache-keeper · cache went cold · the next prompt re-reads ${size(k.tokens)} tokens`
  if (k.state !== 'warm') return undefined
  const left = mins(k.warmUntil - now), next = mins(k.warmUntil - m - now)
  const pings = k.pings ? `${k.pings} ping${k.pings === 1 ? '' : 's'} sent · next in ${next}m` : `keep-alive ping in ${next}m`
  return `cache-keeper · ${size(k.tokens)} tokens cached · warm ${left}m · ${pings}`
}

export function statusLine(k: Keep, now: number): string | undefined {
  return k.state === 'warm' ? `cache warm ${mins(k.warmUntil - now)}m` : k.state === 'cold' ? 'cache cold' : undefined
}

// Switchboard discovery and post, trimmed from usage-meter.
type Target = { port: number; token: string }
let targets: Target[] = []
let foundAt = -Infinity

async function discover($: EngineInterface) {
  const now = await $.clock.now()
  if (now - foundAt < 30_000) return targets
  foundAt = now
  const dir = `${((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/\\/g, '/')}/.claude/switchboard`
  const found: Target[] = []
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'workspaces.json') continue
    try {
      const f = JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))
      if (typeof f.port === 'number' && typeof f.hubToken === 'string') found.push({ port: f.port, token: f.hubToken })
    } catch { /* mid-write */ }
  }
  return (targets = found)
}

async function post($: EngineInterface, k: Keep, sessionId?: string) {
  const body = { kind: 'cache', sessionId: sessionId ?? await $.session.id(), cwd: await $.session.cwd(), state: k.state, warmUntil: k.warmUntil, tokens: k.tokens, pings: k.pings }
  await Promise.all((await discover($)).map(async t => {
    const sent = await $.http.fetch(`http://127.0.0.1:${t.port}/hub`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token, ...body }),
    }).catch(() => undefined)
    if (!sent || sent.status === 403) foundAt = -Infinity
  }))
}

// A running turn is kept in $.state (busy), since a reload can land mid-turn. gen and forking are
// module-only: a reload drops the timers and the fork they belong to.
let gen = 0
// ponytail: the types do not say whether a fork raises main-loop turn events; any arriving
// mid-fork are taken as the fork's own. A real prompt landing in that second is caught at its end.
let forking = false
let timer: Timer | undefined

async function set($: EngineInterface, k: Keep, sessionId?: string) {
  await update($, keep, () => k)
  $.ui.status(statusLine(k, k.now))
  await post($, k, sessionId).catch(() => undefined)
}

function schedule($: EngineInterface, at: number, now: number) {
  timer?.cancel()
  const mine = gen
  timer = $.clock.after(Math.max(0, at - now), () => { void ping($, mine).catch(() => undefined) })
}

async function ping($: EngineInterface, mine: number) {
  const k = await read($, keep)
  if (k?.busy || mine !== gen || k?.state !== 'warm') return
  const now = await $.clock.now()
  if (now - k.idleSince >= idleCap) return set($, { ...k, state: 'off', now })
  forking = true
  const r = await $.model.fork({ prompt: PROMPT }).finally(() => { forking = false })
  if ((await read($, keep))?.busy || mine !== gen) return
  const at = await $.clock.now()
  if (!r.isAnswered && r.reason === 'nothing-to-fork') return set($, { ...k, state: 'off', now: at })
  if (!r.isAnswered && r.reason !== 'empty-reply') {
    // api-error or aborted: the cache was not touched, try again while it may still be warm.
    if (at + RETRY_MS < k.warmUntil) schedule($, at + RETRY_MS, at)
    else await set($, { ...k, state: 'cold', now: at })
    return
  }
  if (r.usage.cache_read_input_tokens < k.tokens * COLD_SHARE) {
    $.ui.log(`cache-keeper: the cache had already expired (read ${size(r.usage.cache_read_input_tokens)} of ${size(k.tokens)}); not pinging until the next turn`)
    return set($, { ...k, state: 'cold', now: at })
  }
  const next = { ...k, warmUntil: at + ttl, pings: k.pings + 1, now: at }
  await set($, next)
  schedule($, next.warmUntil - margin, at)
}

export const register: Register = (on, options) => {
  if (typeof options.ttlMinutes === 'number' && options.ttlMinutes > 0) ttl = options.ttlMinutes * MIN
  if (typeof options.idleHours === 'number' && options.idleHours > 0) idleCap = options.idleHours * 60 * MIN
  margin = Math.min(5 * MIN, ttl / 5)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Countdown redraw, and a warm keep picked back up after a reload.
    $.clock.every(MIN, () => {
      void (async () => {
        if ((await read($, keep))?.state !== 'warm') return
        const now = await $.clock.now()
        const k = await update($, keep, c => c && { ...c, now })
        if (k) $.ui.status(statusLine(k, now))
      })().catch(() => undefined)
    })
    const k = await read($, keep)
    if (k?.state === 'warm' && !k.busy) schedule($, k.warmUntil - margin, await $.clock.now())
    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && !forking) {
      gen++
      timer?.cancel()
      timer = undefined
      await update($, keep, c => c && { ...c, busy: true })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || forking) return done
    const now = await $.clock.now()
    const tokens = (await $.session.usage()).context.tokens ?? 0
    const finished = e.answer.includes('Commit message:')
    const k: Keep = { state: finished ? 'off' : 'warm', warmUntil: now + ttl, tokens, pings: 0, idleSince: now, now }
    await set($, k)
    if (!finished) schedule($, k.warmUntil - margin, now)
    return done
  })

  // Exit, /clear, resume: the card should stop saying warm.
  on('session.end', async ($, e, next) => {
    const k = await read($, keep)
    if (k && k.state !== 'off') {
      gen++
      timer?.cancel()
      await set($, { ...k, state: 'off', now: await $.clock.now() }, e.sessionId)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const k = await read($, keep)
    const line = k && !e.props.isWorking && !e.props.hasSurvey ? bandLine(k, k.now) : undefined
    if (!line) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{line}</Text>
  })
}
