import type { State } from "./state.ts";

export function listOpen(state: State) {
  return [...state.todos.values()].filter((t) => !t.done);
}

export function stats(state: State) {
  const all = [...state.todos.values()];
  const done = all.filter((t) => t.done).length;
  return { total: all.length, done, open: all.length - done };
}
