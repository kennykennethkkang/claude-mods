import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./src/store.ts";
import { create, complete } from "./src/commands.ts";
import { stats } from "./src/queries.ts";

test("create and complete", () => {
  const s = new Store();
  create(s, "a", "milk");
  complete(s, "a");
  assert.deepEqual(stats(s.state()), { total: 1, done: 1, open: 0 });
});
