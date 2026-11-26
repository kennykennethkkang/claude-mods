import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  LEVELS, RULE, appendRows, bare, classify, finalRow, otherOwns, pickRow, questionBucket, questionPick, readLearned, readLevel, readSession, smartPick, tail, writeLevel,
  type Q, type Row, type Task,
} from './smart'

// Smart select, terminal side: a ponytail level per task, a question pick per AskUserQuestion, a band row above the prompt.
// Rows go to ~/.claude/switchboard/smart-picks.d/<session>-select.jsonl; the Switchboard extension joins outcomes and writes smart-learned.json.

type Cur = { key: string; task: Task; pick: string; why: string; text: string }
const NEW_TASK_MIN = 40
const BAND_REFRESH_MS = 5_000
// The terminal draws the button as `[ Smart ]`, 9 cells, then the gap.
const BUTTON_CELLS = 10
// The to-do text keeps at least this many cells before the ponytail group goes.
const MIN_TEXT = 12

// Terminal cells of a code point: 0 for joiners and marks, 2 for CJK and emoji (copied from todo-band).
const cells = (cp: number) =>
  cp < 0x300 ? 1
  : (cp <= 0x36f || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f)) ? 0
  : (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1
export const width = (s: string) => [...s].reduce((n, c) => n + cells(c.codePointAt(0)!), 0)

/** One line cut to the cells it has, with an ellipsis. */
export function fit(text: string, room: number): string {
  if (width(text) <= room) return text
  if (room < 1) return ''
  let out = ''
  let used = 0
  for (const c of text) {
    const w = cells(c.codePointAt(0)!)
    if (used + w > room - 1) break
    out += c
    used += w
  }
  return out + '…'
}

export type Seg = { t: string; dim?: boolean; b?: boolean; c?: string }
export type Todo = { n: number; text: string; total: number }
export type Parts = { todo?: Todo; ponytail?: string; model?: string; cache?: string }

export function todoOf(raw: string | undefined): Todo | undefined {
  try {
    const t = JSON.parse(raw ?? '')
    if (!t || typeof t.n !== 'number' || typeof t.text !== 'string') return undefined
    return { n: t.n, text: t.text.replace(/\s+/g, ' ').trim(), total: typeof t.total === 'number' ? t.total : 1 }
  } catch {
    return undefined
  }
}

const segW = (segs: Seg[]) => segs.reduce((n, s) => n + width(s.t), 0)
function cutSegs(segs: Seg[], room: number): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    if (room <= 0) break
    const t = fit(s.t, room)
    out.push({ ...s, t })
    room -= width(t)
  }
  return out
}

/** Layout A's one row: To-do, ponytail with the model, cache. Folds: model, cache, to-do text, ponytail. A cold cache never folds: the to-do text is cut instead, then +N, then ponytail. */
export function lineSegs(o: Parts, room: number): Seg[] {
  const cold = o.cache === 'cold'
  const build = (text: string | undefined, model: boolean, cache: boolean, pony: boolean, more = true): Seg[] => {
    const groups: Seg[][] = []
    if (o.todo) groups.push([{ t: `To-do ${o.todo.n}`, b: true }, { t: ' ' + (text ?? o.todo.text) }, ...(more && o.todo.total > 1 ? [{ t: ` +${o.todo.total - 1}`, dim: true }] : [])])
    if (pony && o.ponytail) groups.push([{ t: 'ponytail ', dim: true }, { t: o.ponytail }, ...(model && o.model ? [{ t: '  ' + o.model }] : [])])
    if (cache && o.cache) groups.push([{ t: 'cache ', dim: true }, { t: o.cache, c: cold ? 'warning' : undefined }])
    return groups.flatMap((g, i) => (i ? [{ t: '  │  ', dim: true }, ...g] : g))
  }
  for (const t of [build(undefined, true, true, true), build(undefined, false, true, true), build(undefined, false, cold, true)]) if (segW(t) <= room) return t
  if (o.todo) {
    const left = room - segW(build('', false, cold, true))
    if (left >= MIN_TEXT) return build(fit(o.todo.text, left), false, cold, true)
    if (cold) {
      for (const more of [true, false]) {
        const l = room - segW(build('', false, true, false, more))
        if (l >= 1) return build(fit(o.todo.text, l), false, true, false, more)
      }
      return cutSegs([{ t: 'cache ', dim: true }, { t: 'cold', c: 'warning' }], room)
    }
    return cutSegs(build(undefined, false, cold, false), room)
  }
  if (cold && o.ponytail) {
    const t = build(undefined, false, true, false)
    if (segW(t) <= room) return t
    return cutSegs(t, room)
  }
  return cutSegs(build(undefined, false, cold, true), room)
}

const isNote = (e: { isMeta?: true; command?: unknown; origin?: { kind?: string }; text: string }) =>
  !!e.isMeta || !!e.command || e.origin?.kind === 'task-notification' || e.text.startsWith('<task-notification>')

/** A typed /ponytail: the engine may send it as a command or as plain text. */
export function handSet(e: { command?: unknown; text: string }) {
  return /^\/ponytail\b/.test(e.text.trimStart()) || /^\/?ponytail\b/.test(String((e.command as { name?: string } | undefined)?.name ?? e.command ?? ''))
}

/** The answer text per question: AskUserQuestion's answers map, or the ask tool's `"question": picked` lines. */
export function answersOf(result: unknown, text: string | undefined, questions: Q[]) {
  const out: Array<string | undefined> = []
  const map = (result as { answers?: Record<string, unknown> } | undefined)?.answers
  for (const q of questions) {
    let a: unknown = map && typeof map === 'object' ? map[q.question ?? ''] : undefined
    if (a && typeof a === 'object') a = (a as { answers?: unknown[] }).answers?.[0]
    if (a === undefined && text && q.question) {
      const line = text.split('\n').find(l => l.startsWith(`"${q.question}": `))
      if (line) a = line.slice(q.question.length + 4)
    }
    const s = String(a ?? '').trim()
    out.push(s ? bare(s) : undefined)
  }
  return out
}

export const told = (c: Pick<Cur, 'task' | 'pick' | 'why'>) =>
  c.pick === 'off'
    ? `Smart select: ponytail is off for this ${c.task} task (${c.why}). Work normally; the user can change it with /ponytail.`
    : `Smart select: ponytail level ${c.pick} for this ${c.task} task (${c.why}). Work at that level; the user can change it with /ponytail.`

type St = { cur?: Cur; seen: string; wrote?: string; manual: boolean; note?: string; band: { at: number; rows: Row[] } }

async function ids($: EngineInterface) {
  return { at: await $.clock.now(), session: await $.session.id(), cwd: String(await $.session.cwd().catch(() => '')) }
}

/** `force` is Kenneth's own /smart or button: it writes over a hand level and ends his hold. */
async function apply($: EngineInterface, s: St, task: Task, text: string, force = false) {
  const rule = RULE[task]
  const p = smartPick('ponytail', task, rule.level, rule.why, LEVELS, await readLearned($))
  const wrote = await writeLevel($, p.pick, s.wrote, force)
  if (wrote) s.wrote = p.pick
  const { at, session, cwd } = await ids($)
  const row = pickRow({ at, session, cwd, kind: 'ponytail', task, pick: p.pick, why: p.why, options: LEVELS })
  s.cur = { key: String(row.key), task, pick: p.pick, why: p.why, text }
  // Left alone (another chat owns the level, or he set it): watch what the file holds instead.
  s.seen = wrote ? p.pick : ((await readLevel($).catch(() => null)) ?? p.pick)
  if (force) s.manual = false
  await appendRows($, [row]).catch(() => undefined)
  return s.cur
}

/** The mode file no longer holds what we saw: a band button or /ponytail. Log it as the final. */
async function noteSwitch($: EngineInterface, s: St) {
  if (!s.cur) return
  const now = (await readLevel($).catch(() => null)) ?? 'off'
  if (now === s.seen) return
  s.seen = now
  // Another live chat in this project wrote it: not Kenneth's switch here.
  if (await otherOwns($)) return
  s.manual = true
  const { at, session } = await ids($)
  await appendRows($, [finalRow({ at, session, kind: 'ponytail', key: s.cur.key, final: now })]).catch(() => undefined)
}

export const register: Register = (on) => {
  // seen: the level the ledger last saw; a different one in the mode file means Kenneth switched it.
  // manual: his switch holds until the Smart button re-applies the pick.
  const s: St = { seen: '', manual: false, band: { at: -Infinity, rows: [] } }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'smart', description: 'Re-apply the smart ponytail pick for the current task' }).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'smart' }, async ($, e) => {
    if (!s.cur) return { text: 'Smart select: no task picked yet.' }
    const c = await apply($, s, classify(s.cur.text), s.cur.text, true).catch(() => undefined)
    if (!c) return { text: 'Smart select: could not apply the pick.' }
    s.note = told(c)
    return { text: `Smart: ponytail ${c.pick} (${c.why})` }
  })

  on('prompt.submit', async ($, e, next) => {
    await noteSwitch($, s).catch(() => undefined)
    // Before the first apply there is no pick to switch from, so noteSwitch cannot see it.
    if (handSet(e)) s.manual = true
    if (isNote(e)) return next(e)
    const hold = s.note
    s.note = undefined
    let ctx = hold ? [hold] : []
    if (!s.manual) {
      const task = classify(e.text)
      const fresh = !s.cur || (e.text.length >= NEW_TASK_MIN && task !== 'other' && task !== s.cur.task)
      if (fresh) {
        const c = await apply($, s, task, e.text).catch(() => undefined)
        if (c) ctx = [told(c)]
      }
    }
    return next(ctx.length ? { ...e, context: [...(e.context ?? []), ...ctx] } : e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) await noteSwitch($, s).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Question picks: the "(Recommended)" option, else the first; the final is what was answered.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const qs = (e as { questions?: unknown }).questions
    if ((tool !== 'AskUserQuestion' && tool !== 'mcp__switchboard__ask') || !Array.isArray(qs)) return next(e)
    const questions = qs as Q[]
    const rows: Array<Row | undefined> = []
    try {
      const learned = await readLearned($)
      const { at, session, cwd } = await ids($)
      questions.forEach((q, i) => {
        const rule = questionPick(q)
        if (!rule) return rows.push(undefined)
        // The hub's own bucket (header, else the question text), so rates pool the same way.
        const task = questionBucket(q.header, q.question)
        const p = smartPick('question', task, rule.pick, rule.recommended ? 'marked (Recommended) in the question' : 'first option, none marked', rule.options, learned)
        // Same ms for every question of one call would share a key: offset by index.
        rows.push(pickRow({ at: at + i, session, cwd, kind: 'question', task, pick: p.pick, why: p.why, options: rule.options }))
      })
      await appendRows($, rows.filter((r): r is Row => !!r))
    } catch { /* logging only */ }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    try {
      const got = answersOf(ran.result, ran.text, questions)
      const { at, session } = await ids($)
      const finals = rows.flatMap((r, i) => (r && got[i] ? [finalRow({ at, session, kind: 'question', key: String(r.key), final: got[i]! })] : []))
      await appendRows($, finals)
    } catch { /* logging only */ }
    return ran
  }).catch(($, e, next) => next(e))

  // Other mods share this slot: stack under ours so none hides another. next(e) rejects when nothing answers beneath.
  // Without the side pane this one row carries the to-do, ponytail and cache too (side-pane hides their own rows).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e).catch(() => undefined)
    if (e.props.hasSurvey) return below ?? next(e)
    const cur = s.cur
    const todo = todoOf(await $.env.get('SWITCHBOARD_TODO'))
    // cache-keeper's value, read as its own state: an atom of its own plugin and key
    const keep = e.props.isWorking ? null : await read($, atom({ plugin: 'cache-keeper', key: 'keep' } as never, null as never) as never).catch(() => null) as { state?: string; warmUntil?: number; now?: number } | null
    const cache = keep?.state === 'cold' ? 'cold' : keep?.state === 'warm' ? `warm ${Math.max(0, Math.round(((keep.warmUntil ?? 0) - (keep.now ?? 0)) / 60_000))}m` : undefined
    if (!cur && !todo && !cache) return below ?? next(e)
    const now = await $.clock.now()
    if (cur && now - s.band.at >= BAND_REFRESH_MS) {
      s.band = { at: now, rows: tail(await readSession($), await $.session.id(), ['model', 'effort', 'role']) }
    }
    const roleAts = new Set(s.band.rows.filter(r => r.kind === 'role').map(r => r.at))
    // The chat's own model and effort: rows no spawn wrote.
    const last = (kind: string) => s.band.rows.filter(r => r.kind === kind && !roleAts.has(r.at)).at(-1)
    const val = (r?: Row) => (r ? String(r.final ?? r.pick) : '')
    const model = [val(last('model')), val(last('effort'))].filter(Boolean).join(' ')
    const segs = lineSegs({ todo, ponytail: cur && (s.seen || cur.pick), model, cache }, e.props.bodyColumns - (cur ? BUTTON_CELLS : 0))
    const press = async () => {
      if (!cur) return
      const c = await apply($, s, classify(cur.text), cur.text, true).catch(() => undefined)
      if (!c) return $.ui.toast('Smart select: could not apply the pick')
      s.note = told(c)
      $.ui.toast(`Smart: ponytail ${c.pick} (${c.why})`)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const mine = (
      <Box>
        {cur && <Button key="smart" label="Smart" onPress={press} />}
        <Text wrap="truncate-end">{cur ? ' ' : ''}{segs.map(g => <Text bold={g.b} dimColor={g.dim} color={g.c}>{g.t}</Text>)}</Text>
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  })
}
