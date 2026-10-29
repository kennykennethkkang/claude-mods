export type PlanTask = { title: string; done: number; total: number }
export type PlanView = { name: string; tasks: PlanTask[] }

declare module 'claude-code' {
  interface PluginState {
    'plan-pane': { plan: PlanView | null }
  }
}
