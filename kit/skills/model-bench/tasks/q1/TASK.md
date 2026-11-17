Review the todo store in src/ (TypeScript, Node 24, no build step) against the invariants below. Do not edit any file.

Invariants: every Store is independent; `state()` returns a snapshot that later appends, undos or commands never change (neither the Map nor the Todo objects inside it); `version` always equals `events.length`; undo returns exactly to the state before the last event.

Report only problems you verified (by reading the code or running a quick check), one per line, as:
BUG <n>: <file>:<line>: <what breaks and why>
