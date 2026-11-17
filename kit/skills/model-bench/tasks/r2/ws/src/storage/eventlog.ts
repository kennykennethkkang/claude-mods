import type { Clock } from '../util/clock.ts'
import type { LogEvent } from '../domain/types.ts'

export class EventLog {
  events: LogEvent[] = []
  clock: Clock
  constructor(clock: Clock) {
    this.clock = clock
  }
  append(type: string, orderId: string | null, data: Record<string, unknown> = {}) {
    const e = { seq: this.events.length + 1, at: this.clock.now(), type, orderId, data }
    this.events.push(e)
    return e
  }
  forOrder(id: string) {
    return this.events.filter(e => e.orderId === id)
  }
  ofType(type: string) {
    return this.events.filter(e => e.type === type)
  }
}
