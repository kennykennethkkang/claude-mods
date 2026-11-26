export type Win = { who: 'Claude' | 'Codex'; win: '5h' | 'wk'; pct: number; resetAt?: number }
export type Agent = { id: string; type: string; status: string; model?: string; effort?: string; startTime: number; label: string }
export type Smart = { ponytail?: string; model?: string; effort?: string; why?: string; roles?: { role: string; model: string }[] }
// cache-keeper's keep, as far as the pane reads it
export type Cache = { state: string; warmUntil: number; tokens: number; now: number; pingAt?: number }
export type Snap = {
  at: number
  usage: Win[]
  agents: Agent[]
  // finished agents per role, folded into "+N done"
  done: Record<string, number>
  smart: Smart
  mods: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'side-pane': {
      snap: Shaped<Snap>
      modsOpen: boolean
      placed: boolean
      asks: string[]
    }
  }
}
