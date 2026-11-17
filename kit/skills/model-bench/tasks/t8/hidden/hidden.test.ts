import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./src/store.ts";
import { create, complete, reopen, remove, rename } from "./src/commands.ts";
import { stats, listOpen } from "./src/queries.ts";

test("stores are independent", () => {
  const a = new Store(); create(a, "x", "one");
  const b = new Store();
  assert.equal(b.state().todos.size, 0);
  create(b, "x", "two");
  assert.equal(a.state().todos.get("x")!.title, "one");
});

test("undo delete restores", () => {
  const s = new Store(); create(s, "a", "milk"); s.state(); remove(s, "a");
  assert.equal(s.state().todos.has("a"), false);
  s.undo();
  assert.equal(s.state().todos.get("a")!.title, "milk");
});

test("undo complete reopens", () => {
  const s = new Store(); create(s, "a", "milk"); complete(s, "a"); s.state(); s.undo();
  assert.equal(s.state().todos.get("a")!.done, false);
});

test("snapshot is stable", () => {
  const s = new Store(); create(s, "a", "milk"); create(s, "b", "eggs");
  const snap = s.state();
  complete(s, "a"); remove(s, "b"); create(s, "c", "tea");
  assert.equal(snap.todos.get("a")!.done, false);
  assert.equal(snap.todos.has("b"), true);
  assert.equal(snap.todos.has("c"), false);
  assert.equal(snap.version, 2);
  s.undo(); s.undo();
  assert.equal(snap.todos.get("a")!.done, false);
});

test("version equals events length", () => {
  const s = new Store();
  for (let i = 0; i < 5; i++) create(s, "t" + i, "x");
  s.state(); complete(s, "t1"); s.undo(); reopen(s, "t2");
  assert.equal(s.state().version, s.events.length);
  const s2 = new Store(); create(s2, "q", "y");
  assert.equal(s2.state().version, 1);
});

test("rename", () => {
  const s = new Store(); create(s, "a", "milk");
  rename(s, "a", "  oat milk ");
  assert.equal(s.state().todos.get("a")!.title, "oat milk");
  assert.equal(s.events.at(-1)!.type, "renamed");
  s.undo();
  assert.equal(s.state().todos.get("a")!.title, "milk");
});

test("rename and create validation", () => {
  const s = new Store(); create(s, "a", "milk");
  assert.throws(() => rename(s, "a", "   "));
  assert.throws(() => rename(s, "zz", "x"));
  remove(s, "a");
  assert.throws(() => rename(s, "a", "x"));
  assert.throws(() => create(s, "b", "  "));
  create(s, "c", "  bread ");
  assert.equal(s.state().todos.get("c")!.title, "bread");
  assert.equal(s.events.length, 3);
});

test("queries still work", () => {
  const s = new Store(); create(s, "a", "1"); create(s, "b", "2"); complete(s, "a");
  assert.deepEqual(listOpen(s.state()).map((t) => t.id), ["b"]);
  assert.deepEqual(stats(s.state()), { total: 2, done: 1, open: 1 });
});
