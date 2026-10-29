export type DietRow = { label: string; tokens: number }
export type Diet = { total: number; rows: DietRow[]; unused: string[]; since: string }

declare module 'claude-code' {
  interface PluginState {
    'context-diet': { diet: Diet | null }
  }
}
