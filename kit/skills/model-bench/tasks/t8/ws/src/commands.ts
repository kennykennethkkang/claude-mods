import type { Store } from "./store.ts";

const now = () => Date.now();

function existing(store: Store, id: string) {
  const t = store.state().todos.get(id);
  if (!t) throw new Error(`no todo ${id}`);
  return t;
}

export function create(store: Store, id: string, title: string): void {
  if (store.state().todos.has(id)) throw new Error(`duplicate ${id}`);
  store.append({ type: "created", id, title, at: now() });
}

export function complete(store: Store, id: string): void {
  existing(store, id);
  store.append({ type: "completed", id, at: now() });
}

export function reopen(store: Store, id: string): void {
  existing(store, id);
  store.append({ type: "reopened", id, at: now() });
}

export function remove(store: Store, id: string): void {
  existing(store, id);
  store.append({ type: "deleted", id, at: now() });
}
