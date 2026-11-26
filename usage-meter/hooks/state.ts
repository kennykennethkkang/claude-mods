import type { Result, Shell } from './handoff'
import type { Summary, Task } from './handoff-note'
import type { Target } from './hub'
import type { Hold, HubPause, Window } from './limits'
import type { Run } from './model'

export const agentCache = new Map<string, { mtimeMs: number; model?: string }>()
// This chat's subagent runs, in the order they ended. ponytail: in memory, so a mod reload forgets the chain.
export const runs: Run[] = []
export const live = new Map<string, { role: string; brief: string; model: string; files: Set<string>; smartKey?: string }>()
export const company: { at: number; paused: boolean; budgets: Record<string, number>; smart: boolean; codexFirst: boolean; advanced: Record<string, boolean>; limit?: HubPause; windows: Window[]; codexWindows: Window[]; pauseAt?: number | null; pauseOff: number } = { at: -Infinity, paused: false, budgets: {}, smart: true, codexFirst: true, advanced: {}, windows: [], codexWindows: [], pauseOff: -Infinity }
export const held: { id?: string; hold?: Hold; resumedAt?: number } = {}
export const feed: {
  targets: Target[]; foundAt: number; lastLive: number; compactAt?: number; handedOff?: string; prompt?: string; ask?: string; requests: string[]; errors: string[]
  file?: string; plan?: string; brief?: string; tasks: Map<string, Task>; shells: Map<string, Shell>; results: Result[]; summary?: Summary
  // Subagents TaskStop cut off since the last request.
  stopped: string[]
  restored?: string; pausing?: number; freshNote?: string; nudge?: { n: number; tasks: string }
} = { targets: [], foundAt: -Infinity, lastLive: -Infinity, tasks: new Map(), requests: [], errors: [], shells: new Map(), results: [], stopped: [] }
export const ind: { at: number; flags: Record<string, unknown> } = { at: -Infinity, flags: {} }
// onAt of the rounds already stopped, and of flags this chat ended itself (the file can lag the hub).
export const indStopped = new Map<string, number>()
export const indDone = new Map<string, number>()

// Reassigned values live here so every file reads and writes the same one.
export const st = {
  measured: [] as Window[],
  holdBusy: false,
  activeAt: -Infinity,
  quietTicks: 0,
  lastAnswer: '',
  polling: false,
  handingOff: undefined as Promise<void> | undefined,
  handoffFailedAt: undefined as number | undefined,
}
