Bug reports for the todo store in src/ (TypeScript, run with Node 24, no build step):

1. "I deleted a todo, hit undo, and it is still gone."
2. "Our test suite is flaky: a todo created in one test shows up in another test's brand new Store."
3. "I grabbed `store.state()`, completed another todo, and the object I grabbed earlier changed under me. Also `state().version` is sometimes bigger than the number of events."

Expected invariants: every Store is independent; `state()` returns a snapshot that later appends, undos or commands never change (neither the Map nor the Todo objects inside it); `version` always equals `events.length`; undo returns exactly to the state before the last event.

Feature: add `rename(store, id, title)` to src/commands.ts. It emits a new `renamed` event (`{ type: "renamed"; id; title; at }`), the projection updates the title, undo works for it like any other event. The title is trimmed; an empty title after trimming throws, renaming an unknown or deleted id throws. `create` should apply the same trimming and empty-title rule.

Repo convention: tests use node:test, run them with `npm test` (that is `node --test`). Do not add dependencies.
