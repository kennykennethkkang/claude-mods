import type { Window } from './limits'
import { msOf } from './limits'

const hash = (text: string) => {
  let a = 0x811c9dc5, b = 0x9e3779b9
  for (const c of text) { a = Math.imul(a ^ c.charCodeAt(0), 0x01000193); b = Math.imul(b ^ c.charCodeAt(0), 0x85ebca6b) }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}

export function codexDenial(input: { role: string; prompt: string; session: string; enabled: boolean; roleFile: boolean; codex: Window[]; claude: Window[]; now: number; seen: Set<string> }): string | undefined {
  if (!input.enabled || !input.roleFile || !['engineer', 'qa'].includes(input.role) || /^claude only:/im.test(input.prompt)) return undefined
  const week = input.codex.find(w => w.kind === 'codex_seven_day'), five = input.codex.find(w => w.kind === 'codex_five_hour')
  const claudeWeek = input.claude.find(w => w.kind === 'seven_day')
  if (!week || !five || !claudeWeek) return undefined
  const used = (w: Window) => msOf(w.resetsAt) <= input.now ? 0 : w.percentUsed
  const weekUsed = used(week), fiveUsed = used(five), claudeUsed = used(claudeWeek)
  if (weekUsed > 85 || fiveUsed > 85 || weekUsed >= claudeUsed) return undefined
  const key = `${input.session}:${hash(`${input.role}\0${input.prompt}`)}`
  if (input.seen.has(key)) return undefined
  input.seen.add(key)
  const target = input.role === 'qa' ? 'qa-codex' : 'engineer-codex'
  return `Switchboard: Codex has ${100 - Math.floor(weekUsed)}% of its week left, Claude has ${100 - Math.floor(claudeUsed)}% left. Send this to ${target}, or add a line 'Claude only: <reason>' to the brief and send it again (reasons: MCP tools, browser, UI or screen work, skills, mcp__switchboard__ask).`
}
