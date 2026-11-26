import type { EngineInterface } from 'claude-code'
import { readCompany } from './company'
import { poll, start } from './feed'
import { OWN, restoreFeed } from './handoff'
import { post } from './hub'
import { company, feed, held, st } from './state'

// Usage hold: owned here, so a chat pauses near the limit and resumes after the reset with no Switchboard window open.
export type Window = { kind: string; percentUsed: number; resetsAt?: string | number }
export type Hold = { kind: string; percent: number; resetsAt: number; mid?: boolean }
export type HubPause = { kind?: unknown; percent?: unknown; resumeAt?: unknown }
export const msOf = (r?: string | number) => (typeof r === 'number' ? r : r ? Date.parse(r) : NaN)
export const kindText = (k: string) => k.replace(/_/g, '-')
/** The fullest window at pauseAt or over (99 by default, null off). One past its reset, or one the hub resumed by hand (pauseOff), counts as empty. */
export function overLimit(windows: Window[], pauseAt: number | null | undefined, now: number, pauseOff = -Infinity): Hold | undefined {
  if (pauseAt === null) return undefined
  const w = windows.filter(l => l.percentUsed >= (pauseAt ?? 99) && msOf(l.resetsAt) > Math.max(now, pauseOff)).sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return w && { kind: w.kind, percent: Math.floor(w.percentUsed), resetsAt: msOf(w.resetsAt) }
}
/** The fullest five_hour window not yet past its reset, in percent; 0 with none, so the gate fails open. */
export const fiveHour = (windows: Window[], now: number) => Math.max(0, ...windows.filter(w => w.kind === 'five_hour' && !(msOf(w.resetsAt) <= now)).map(w => w.percentUsed))
/** The hub's pause from limits.json, until its resumeAt: a window that closed never lifts it, so the time does. */
export const hubHold = (p: HubPause | undefined, now: number): Hold | undefined => {
  if (!p) return undefined
  const resetsAt = typeof p.resumeAt === 'number' ? p.resumeAt : Number.MAX_SAFE_INTEGER
  return resetsAt > now ? { kind: typeof p.kind === 'string' ? p.kind : 'usage', percent: typeof p.percent === 'number' ? p.percent : 99, resetsAt } : undefined
}
export function untilText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`
}
export const holdLine = (h: Hold, now: number) => `Paused: ${kindText(h.kind)} limit at ${h.percent}%, resumes in ${untilText(h.resetsAt - now)}`
export const holdDenial = (h: Hold, now: number) => `Paused by usage-meter: ${kindText(h.kind)} usage at ${h.percent}%. Stop here; this chat resumes by itself when the limit resets, in ${untilText(h.resetsAt - now)}.`
export const HUB_RESUME = 'Usage limit reset. Continue where you stopped'
export const RESUME_DEDUP_MS = 30 * 60_000
// A hold that starts this soon after a tool call, prompt or turn end cut work off, even with no call denied.
export const RECENT_MS = 10 * 60_000
export async function noteActive($: EngineInterface) {
  st.activeAt = await Promise.resolve().then(() => $.clock.now()).catch(() => st.activeAt)
  st.quietTicks = 0
}
export async function loadHold($: EngineInterface) {
  const id = await $.session.id()
  if (held.id === id) return
  const k = (await Promise.resolve().then(() => $.store.get('hold')).catch(() => undefined)) as typeof held | undefined
  const mine = k?.id === id
  Object.assign(held, { id, hold: mine ? k?.hold : undefined, resumedAt: mine ? k?.resumedAt : undefined })
}
export function saveHold($: EngineInterface) { return Promise.resolve().then(() => $.store.set('hold', { ...held })).catch(() => undefined) }
export async function postHold($: EngineInterface) { return post($, { kind: 'hold', sessionId: held.id, hold: held.hold ?? null }).catch(() => undefined) }
export async function liftHold($: EngineInterface, now: number) {
  held.hold = undefined
  held.resumedAt = now
  // The cached limits.json may still hold the pause just lifted; reread it next tick.
  company.at = -Infinity
  await saveHold($)
  await $.ui.status(undefined)
  await postHold($)
}
export const resumeText = (step?: string) => `${OWN}usage limit reset. Carry on from where you stopped${step ? `: ${step}` : ''}. Resume any subagents cut off with SendMessage.`
/** Every poll, idle or not: starts the hold, keeps its status line, and after the reset lifts it with one prompt if it cut work off. */
export async function holdTick($: EngineInterface) {
  if (st.holdBusy) return
  st.holdBusy = true
  try {
    await loadHold($)
    const now = await $.clock.now()
    const c = await readCompany($)
    const due = overLimit([...st.measured, ...c.windows], c.pauseAt, now, c.pauseOff) ?? hubHold(c.limit, now)
    const was = held.hold
    if (due) {
      await restoreFeed($).catch(() => undefined)
      const busy = was ? was.mid : now - st.activeAt < RECENT_MS || feed.shells.size > 0 || [...feed.tasks.values()].some(t => t.status === 'in_progress')
      held.hold = was && was.resetsAt >= due.resetsAt ? was : { ...due, ...(busy ? { mid: true } : {}) }
      if (held.hold !== was) { await saveHold($); await postHold($) }
      await $.ui.status(holdLine(held.hold, now))
      return
    }
    if (!was) return
    await liftHold($, now)
    if (!was.mid) return void (await $.ui.toast('Usage limit reset: unpaused'))
    await $.ui.toast('Resumed: limit reset')
    const step = [...feed.tasks.values()].find(t => t.status === 'in_progress')?.subject ?? feed.prompt
    await $.prompt.submit({ text: resumeText(step) })
  } finally { st.holdBusy = false }
}
/** The denial while held; a denied call means the chat was mid-work, so it gets the resume prompt. */
export async function heldNow($: EngineInterface) {
  await loadHold($)
  const now = await $.clock.now()
  const h = held.hold
  if (!h || h.resetsAt <= now) return undefined
  if (!h.mid) { held.hold = { ...h, mid: true }; await saveHold($) }
  return holdDenial(h, now)
}
/** Held and not past the reset: nothing here may start a turn, since the hold denies its every call. */
export async function holding($: EngineInterface) {
  await loadHold($)
  return held.hold !== undefined && held.hold.resetsAt > (await $.clock.now())
}
