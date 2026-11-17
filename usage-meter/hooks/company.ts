import type { EngineInterface } from 'claude-code'
import { homeDir } from './hub'
import { company } from './state'

export function budgetDenial(role: string, used: Record<string, number>, budgets: Record<string, number>): string | undefined {
  const cap = budgets[role]
  return cap !== undefined && (used[role] ?? 0) >= cap ? `Switchboard: ${role} has used its ${cap} starts for today. Raise the budget on the Company card, or do this yourself.` : undefined
}
export const READS = new Set(['Read', 'Grep', 'Glob'])
export const pausedDenial = (tool: string, paused: boolean) => (paused && !READS.has(tool) ? 'Switchboard is paused from the Company card: reading only until it is resumed.' : undefined)
export const COMPANY_MS = 10_000
/** The hub's company.json, read at most every 10 seconds; missing or broken means not paused, no budgets. */
export async function readCompany($: EngineInterface) {
  const now = await $.clock.now()
  if (now - company.at < COMPANY_MS) return company
  company.at = now
  const home = await homeDir($)
  try {
    const f = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/company.json`)))
    company.paused = f.paused === true
    company.budgets = f.budgets && typeof f.budgets === 'object' ? f.budgets : {}
    company.smart = f.smartModelSwitch !== false
    company.advanced = f.advancedMode && typeof f.advancedMode === 'object' ? f.advancedMode : {}
  } catch { company.paused = false; company.budgets = {}; company.smart = true; company.advanced = {} }
  try {
    const l = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/limits.json`)))
    company.limit = l.paused === true && l.pause && typeof l.pause === 'object' ? l.pause : undefined
    company.windows = Array.isArray(l.windows) ? l.windows : []
    company.pauseAt = l.pauseAt === null ? null : typeof l.pauseAt === 'number' ? l.pauseAt : undefined
    company.pauseOff = typeof l.pauseOff === 'number' ? l.pauseOff : -Infinity
  } catch { company.limit = undefined; company.windows = []; company.pauseAt = undefined; company.pauseOff = -Infinity }
  return company
}
export async function startsToday($: EngineInterface) {
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const kept = ((await $.store.get('starts')) ?? {}) as { day?: string; used?: Record<string, number> }
  return { day, used: kept.day === day ? kept.used ?? {} : {} }
}
