---
name: goal
description: Pin this chat to a goal. Turns the user's instructions on how each function should work into a goal file with checks, then works until every point holds. Under Run indefinitely the rounds keep going until the goal is met and its check passes; in a normal chat questions can come up as work goes. Use when the user types "/goal", says "goal:", "the goal is", "keep going until this works", or opens a chat with a spec of how functions must behave.
argument-hint: <how each function should work>
---

# Goal

The user's request: $ARGUMENTS

## 1. Write the goal file

Path: `.switchboard/goals/${CLAUDE_SESSION_ID}.md` in the project folder (make the folder; `.switchboard/` stays in `.git/info/exclude`). If the file exists, this is a new or changed goal: rewrite it. In Codex the id above is not filled in: use the output of `echo "$CODEX_THREAD_ID"` in its place.

Read the code the goal touches first, then write:

```markdown
# Goal

<the goal in one or two lines>

## Functions
- `<name or path>`: <how it must work, in the user's terms: inputs, outputs, edge cases, errors>

## Done when
- <observable result a test or a run can show>

## Decisions
- <what you decided and why, one line each>

Check: `<one shell command that exits 0 only when the goal holds>`
```

- Keep every behavior the user named; do not trade any away for a smaller goal.
- The Check line is one command run from the project folder, for example a test file you add for these functions plus the project's own suite. Write those tests first; they fail until the work is done. Leave the line out only when no command can show it (pure visual work), and then say so in Decisions.
- Write the command as `Check: \`one shell command\`` on its own line. Outside Run indefinitely, done-check runs it from the project root at each main chat stop and holds the stop while it fails, for at most two blocks per turn. Under Run indefinitely, usage-meter runs it from the project root: a failing Check sends another round with its output, a passing one ends the run, and the done line alone cannot end it while the Check fails. A gate set in the hub wins over the Check line.

## 2. Questions

Look for every decision only the user can make (behavior the spec leaves open, a choice between two real designs, an account or a key).

- **Run indefinitely on** (the instructions say "Run indefinitely is on"): ask all of them now, in one AskUserQuestion round, before any work. After the first stop asking is blocked, so anything not asked now you decide yourself and note under Decisions.
- **Normal chat**: ask the ones that block the start now, together. Ask later ones with AskUserQuestion when they come up, and keep working on everything they do not block while you wait.

Decide everything else yourself and note it.

## 3. Work until it holds

- Make a task per Functions line and per Done when line.
- Build or fix, then test each function against its line, not just "the suite is green".
- Run the Check yourself. Done means it exits 0 and every Done when line is shown working.
- Under Run indefinitely, end a round with the line `Run indefinitely: done` only when the goal holds; otherwise just stop and the next round picks up the goal file.
- Keep the goal file current: tick what holds, add decisions. A handoff carries the goal to the fresh chat: a Claude chat gets a copy by itself; a Codex handoff note names the file, so copy it under your own id first.
