export type Server = { pid: number; command: string; port: number; folder: string }

declare module 'claude-code' {
  interface PluginState {
    'dev-servers': { servers: Server[] }
  }
}
