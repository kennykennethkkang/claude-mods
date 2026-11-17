import { redact } from './redact'

/** The plan's tasks with steps still unticked. */
export function openTasks(plan: string) {
  const out: Array<{ n: string; title: string; done: number; total: number }> = []
  let cur: (typeof out)[number] | undefined
  for (const line of plan.split('\n')) {
    const head = /^### Task (\d+): (.+)$/.exec(line)
    if (head) {
      const task = { n: head[1] ?? '', title: (head[2] ?? '').trim(), done: 0, total: 0 }
      out.push(task)
      cur = task
      continue
    }
    if (/^#{1,3} /.test(line)) { cur = undefined; continue }
    const step = /^- \[( |x)\] \*\*Step/.exec(line)
    if (step && cur) { cur.total++; if (step[1] === 'x') cur.done++ }
  }
  return out.filter(t => t.total > 0 && t.done < t.total)
}

export function decisions(plan: string, last = 5): string[] {
  const at = plan.indexOf('## Decisions')
  if (at < 0) return []
  const rows: string[] = []
  for (const line of plan.slice(at).split('\n').slice(1)) {
    if (/^#{1,3} /.test(line)) break
    if (line.startsWith('|') && !/^\|\s*-/.test(line) && !/^\|\s*Question\s*\|/.test(line)) rows.push(line.trim())
  }
  return rows.slice(-last)
}

export type Task = { subject: string; status: string }

// Bullets under a plan's "## Dead ends", newest last.
function deadEnds(plan: string): string[] {
  const at = plan.indexOf('## Dead ends')
  if (at < 0) return []
  const rows: string[] = []
  for (const line of plan.slice(at).split('\n').slice(1)) {
    if (/^#{1,3} /.test(line)) break
    if (line.startsWith('- ')) rows.push(line.trim())
  }
  return rows
}

// ~1,250 tokens, plus what is never cut: the last request, open tasks, running work and errors.
const NOTE_BUDGET = 5_000
// [dead ends, files touched, earlier requests, subagent results] kept at each step.
const TRIMS: Array<[number, number, number, number]> = [[5, 40, 5, 8], [3, 15, 3, 4], [1, 5, 1, 2], [0, 0, 0, 0]]
const REQUEST_MAX = 300
const openLine = (t: Task) => `- [ ] ${t.subject} (${t.status.replace('_', ' ')})`

export type Summary = { goal?: string; tests?: string; decisions?: string[]; next?: string }

/** The fixed lines the wrap-up turn ends with; undefined when it wrote none. */
export function summaryOf(answer: string): Summary | undefined {
  const one = (k: string) => new RegExp(`^${k}:[ \\t]*(\\S.*)$`, 'mi').exec(answer)?.[1]?.trim()
  const block = /^Decisions:[ \t]*\n((?:[ \t]*- .*(?:\n|$))+)/mi.exec(answer)?.[1]
  const decisions = block?.split('\n').map(l => l.trim().replace(/^- /, '')).filter(Boolean)
  const s: Summary = { goal: one('Goal'), tests: one('Tests'), next: one('Next'), ...(decisions?.length ? { decisions } : {}) }
  const set = Object.entries(s).filter(([, v]) => v !== undefined)
  return set.length ? Object.fromEntries(set) : undefined
}

export function handoffNote(o: {
  project: string; cwd: string; branch?: string; planPath?: string; planText?: string; session: string; now: number
  tasks?: Task[]; ask?: string; requests?: string[]; errors?: string[]; running?: string[]; changed?: string[]; transcript?: string
  summary?: Summary; results?: string[]; stopped?: string[]
}): string {
  const stamp = new Date(o.now).toISOString().slice(0, 16).replace('T', ' ')
  const plan = o.planText ? openTasks(o.planText) : []
  const picked = o.planText ? decisions(o.planText) : []
  const dead = o.planText ? deadEnds(o.planText) : []
  const tasks = o.tasks ?? []
  // git status lines to paths: the new chat runs git diff itself.
  const files = (o.changed ?? []).map(l => l.slice(3).trim()).filter(Boolean)
  const results = o.results ?? []
  const quote = (t: string) => t.split('\n').map(l => `> ${l}`)
  const cut = (t: string) => (t.length > REQUEST_MAX ? `${t.slice(0, REQUEST_MAX)} (cut, see transcript)` : t)
  // The last request has its own section; the list does not repeat it.
  const asked = o.ask !== undefined && o.requests?.at(-1) === o.ask ? o.requests.slice(0, -1) : o.requests ?? []
  const open = [...tasks.filter(t => t.status !== 'completed').map(openLine), ...plan.map(t => `- Task ${t.n}: ${t.title} (${t.done} of ${t.total} steps done)`)]
  const done = tasks.filter(t => t.status === 'completed').length
  const s = o.summary ?? {}
  const firstAsk = (o.requests?.[0] ?? o.ask ?? '').split('\n')[0]?.slice(0, 200)
  const build = ([deadCap, filesCap, asksCap, resultsCap]: [number, number, number, number]) => {
    const lines = [
      `# Handoff: ${o.project}, ${stamp} UTC`,
      '',
      'Read this note fully before acting. Recreate every open task below with the task tools before any other work, then, if the aar skill is installed, have a subagent run it on the old chat (Old transcript below), then take the next action. A task counts as done only with the check that proved it.',
    ]
    if (o.ask) lines.push('', '## Last request, verbatim', '', ...quote(o.ask))
    lines.push('', '## Goal', '', s.goal ?? (firstAsk || 'see the last request'))
    lines.push('', '## State', '', `- Folder: ${o.cwd}`, `- Branch: ${o.branch ?? 'unknown'}`, `- Plan: ${o.planPath ?? 'none'}`, `- Tests last run: ${s.tests ?? 'unknown, run them first'}`)
    const why = [...(s.decisions ?? []).map(d => `- ${d}`), ...picked]
    if (why.length) lines.push('', '## Decisions', '', ...why)
    // A chat that never used the task tools records none: say so, so the next chat looks elsewhere.
    const none = tasks.length || plan.length ? '- none' : '- none recorded (task tools may be missing in that chat); check Subagent results and Next action'
    lines.push('', '## Open tasks', '', ...(o.stopped ?? []).map(a => `- stopped: ${a} (cut off by TaskStop, check what it finished)`), ...(open.length ? open : [none]))
    if (o.running?.length) lines.push('', '## Running work', '', 'The old chat may still be running these: check its process (ps for its session id) and recent file changes first; if it is alive, wait for its report instead of rerunning. Otherwise check each output and rerun what is cut off.', '', ...o.running.map(r => `- ${r}`))
    if (o.errors?.length) lines.push('', '## Errors', '', '```', ...o.errors, '```')
    if (results.length && resultsCap) lines.push('', '## Subagent results', '', ...results.slice(-resultsCap).map(r => `- ${r}`))
    if (files.length) {
      const shown = files.slice(0, filesCap)
      lines.push('', '## Files touched', '', ...shown, ...(files.length > shown.length ? [`and ${files.length - shown.length} more (git status)`] : []))
    }
    lines.push('', '## Next action', '', s.next ?? (open.length ? 'Take the first open task.' : 'Carry on with the last request.'))
    if (done) lines.push('', `${done} task${done === 1 ? '' : 's'} done in the old chat.`)
    const shown = asked.length > asksCap ? asked.slice(-asksCap) : asked
    if (shown.length) lines.push('', '## Earlier requests', '', ...(asked.length > shown.length ? [`${asked.length - shown.length} older, see transcript`, ''] : []), ...shown.flatMap((r, i) => [...(i ? [''] : []), ...quote(cut(r))]))
    const deadShown = dead.slice(dead.length - Math.min(deadCap, dead.length))
    if (deadShown.length) lines.push('', '## Dead ends', '', ...deadShown, ...(dead.length > deadShown.length ? [`(${dead.length - deadShown.length} older in the plan)`] : []))
    lines.push(
      '',
      `- Old transcript: ${o.transcript ?? 'unknown'} (grep it for detail, do not paste it)`,
      `- Old session: ${o.session}`,
      '',
      'Keys, tokens and passwords are never written here; anything shaped like one was removed.',
    )
    return redact(lines.join('\n'))
  }
  const kept = (o.ask?.length ?? 0) + (o.errors ?? []).join('\n').length + open.join('\n').length + (o.running ?? []).join('\n').length
  let note = ''
  for (const caps of TRIMS) {
    note = build(caps)
    if (note.length <= NOTE_BUDGET + kept) break
  }
  return note
}

/** Last check before the note goes out: every unfinished task in the store is under Open tasks. */
export function ensureOpenTasks(note: string, tasks: Task[]): string {
  const at = note.indexOf('## Open tasks')
  const end = at < 0 ? -1 : note.indexOf('\n## ', at + 1)
  const section = at < 0 ? '' : note.slice(at, end < 0 ? undefined : end)
  // The note is redacted, so subjects are too, to compare and to insert.
  const missing = tasks.map(t => ({ ...t, subject: redact(t.subject) })).filter(t => t.status !== 'completed' && !section.includes(`] ${t.subject} (`)).map(openLine)
  if (!missing.length) return note
  if (at < 0) {
    // Where it belongs: before the first section that follows Open tasks.
    const where = Math.min(...['\n## Running work', '\n## Errors', '\n## Subagent results', '\n## Files touched', '\n## Next action'].map(h => note.indexOf(h)).filter(i => i >= 0), note.length)
    return `${note.slice(0, where)}\n\n## Open tasks\n\n${missing.join('\n')}${note.slice(where)}`
  }
  const cut = end < 0 ? note.length : end
  return `${note.slice(0, cut).replace(/\n+$/, '').replace(/\n- none(?: recorded .*)?$/, '')}\n${missing.join('\n')}\n${note.slice(cut)}`
}
