export type Keep = {
  state: 'warm' | 'cold' | 'off'
  warmUntil: number
  tokens: number
  pings: number
  /** When the lead's last turn ended. */
  idleSince: number
  /** The lead's turn is running. */
  busy?: boolean
  /** Last minute tick, so the band's countdown redraws. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keeper': { keep: Keep | null }
  }
}
