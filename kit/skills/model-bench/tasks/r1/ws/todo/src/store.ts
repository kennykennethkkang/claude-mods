import type { Event } from "./events.ts";
import { apply, project, type State } from "./state.ts";

export class Store {
  events: Event[] = [];
  private cache: State | null = null;

  append(e: Event): void {
    this.events.push(e);
    if (this.cache) this.cache = apply(this.cache, e);
  }

  state(): State {
    if (!this.cache) this.cache = project(this.events);
    return this.cache;
  }

  undo(): void {
    this.events.pop();
    this.cache = null;
  }
}
