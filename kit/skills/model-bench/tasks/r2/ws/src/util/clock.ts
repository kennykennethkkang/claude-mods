export type Clock = { now(): number }

export const systemClock: Clock = { now: () => Date.now() }

export class FakeClock implements Clock {
  t: number
  constructor(t = 1_700_000_000_000) {
    this.t = t
  }
  now() {
    return this.t
  }
  advance(ms: number) {
    this.t += ms
  }
}
