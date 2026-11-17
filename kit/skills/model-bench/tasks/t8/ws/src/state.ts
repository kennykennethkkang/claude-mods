import type { Event } from "./events.ts";

export type Todo = { id: string; title: string; done: boolean };
export type State = { todos: Map<string, Todo>; version: number };

const EMPTY: State = { todos: new Map(), version: 0 };

export function apply(state: State, e: Event): State {
  switch (e.type) {
    case "created":
      state.todos.set(e.id, { id: e.id, title: e.title, done: false });
      break;
    case "completed": {
      const t = state.todos.get(e.id);
      if (t) t.done = true;
      break;
    }
    case "reopened": {
      const t = state.todos.get(e.id);
      if (t) t.done = false;
      break;
    }
    case "deleted":
      state.todos.delete(e.id);
      break;
  }
  state.version++;
  return state;
}

export function project(events: Event[]): State {
  return events.reduce(apply, EMPTY);
}
