Planted bugs in src/ (count one only when the report names the cause, not just the symptom):

1. Shared start state: `EMPTY` in state.ts is a single module-level object and `project` reduces into it, so every Store (and every re-projection) mutates the same object. Stores leak into each other.
2. Snapshot not isolated: `apply` mutates the state it is given and `Store.append` applies onto the cached state, so the object returned by `state()` changes after later appends.
3. Todo objects mutated in place: `completed`/`reopened` set `done` on the existing Todo object instead of a copy, so a held snapshot's Todo changes (shallow copy of the Map alone would not fix it).
4. Undo and version wrong: after `undo` the cache is rebuilt by `project` from the already mutated `EMPTY`, so deleted todos stay deleted and `version` keeps counting past `events.length`.

A false positive is a reported problem that is not real or not one of the above and not a genuine defect against the invariants.
