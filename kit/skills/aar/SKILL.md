---
name: aar
description: After Action Review of a chat that just ran. Answers the four AAR questions, keeps only concrete lessons, saves them to Claude memory and the vault, and files any skill or rule change as a proposed edit in the Switchboard to-do. Use when the user says "aar", "after action review", "review this session", "what did we learn" or "run an aar", when a handoff note says to run it on the old chat, and before the finishing standup.
---

# AAR

Debrief the chat that just ran, so the next one does not repeat its mistakes or forget what worked. Based on the Army's After Action Review; adapted from aar-loop by Cooper Simson (MIT, see LICENSE).

## Which chat

- Finishing: this chat.
- From a handoff note: the old chat. Read its transcript (the Old transcript path in the note) with grep and targeted reads, not whole. You are usually a subagent here; keep the report short.

## The four questions

Answer each in a line or two, plainly, about what the agent did. Not what the user probably thinks happened.

1. What was supposed to happen?
2. What actually happened?
3. Why was there a difference?
4. What do we do the same or differently next time?

Question 3 wants a mechanism. "The hub returns 304 with an empty body, so the parse threw" is a why. "Should have been more careful" is not.

No difference is a valid answer. Then question 4 locks in what worked: a pattern that held up is a lesson too.

## The lesson bar

A lesson ships only if another agent, months later, could act on it with no judgment call. It names a tool, file, command, number or condition.

Ship:
- "claude-mods has no package.json; run a mod's tests with `claude plugin test ./usage-meter`."
- "Editing extension/kit in switchboard is lost on the next build; edit claude-mods/kit instead."

Drop:
- "Be more careful with builds."
- "Check things before finishing."

Push a vague lesson until it is concrete, or drop it. Zero lessons is fine; do not invent one.

## Where it goes

1. **Memory**, one file per lesson, in this project's memory folder (`~/.claude/projects/<project slug>/memory/`). Read `MEMORY.md` there first; if a memory already covers it, update that file instead of adding one. Run `hub_recall` for the topic first. If the lesson replaces an older one, write the new note with `supersedes: <old-slug>`, then move the old file unedited to `memory/archive/` and drop its `MEMORY.md` line; use `contradicts:` if unresolved, and add `related:` or `depends-on:` where they fit. Link only to notes or wiki pages that exist (skills and tools in backticks), and give every new note at least one link. New file: frontmatter with `name`, `description`, `metadata.type: feedback`; body is the rule, then `**Why:**` (what happened in this chat) and `**How to apply:**`. Add a one-line entry to `MEMORY.md`. A guess (a why you did not reproduce or check, or something true only in an unmerged worktree) takes `status: unproven` in its frontmatter and no `MEMORY.md` line, since every chat loads that file; say under **How to apply** what would prove it. Once proven, drop the status line and add the index line.
2. **Vault**: append the whole AAR (date, chat, four answers, lessons) to `~/Documents/vault/wiki/aar-<project>.md`. Follow `~/Documents/vault/README.md`: if the page is new, add `- [[aar-<project>]] ...` to `wiki/index.md`; append a dated line to `wiki/log.md` either way. Link memory files by `[[name]]`.
3. **Skill or rule changes are never applied.** If the next chat will repeat the mistake unless something it loads changes, write a fix plan: exact target file and exact text to add or replace. A rule needs proof: the lesson came up in two or more chats (name them) or Kenneth said it; a one-off stays a note. File it with `mcp__switchboard__todo_add` for Kenneth to approve. Kit rules, skills, agents and mods live in `claude-mods` (`kit/rules.md`, `kit/skills/<name>/SKILL.md`, `kit/agents/<role>.md`), never the copies in `~/.claude` or `switchboard/extension/kit`.

Before you edit or archive any memory note, `MEMORY.md`, or a kit, rules or agent file, save an undo point: `node ~/.claude/skills/aar/scripts/snapshot.mjs save "aar <chat name>" <the files>`. The hub History lists it with an Undo button; `snapshot.mjs list` and `restore <id>` do the same by hand.

Then run `node ~/.claude/skills/aar/scripts/memory-health.mjs` (from this skill's `scripts/`) and if it lists anything, run the `memory-fix` skill instead of fixing by hand; clear the list before the standup. An `outdated` line is a note naming a file that moved or went: put the new path in, or correct the note against the code.

Before you merge, rewrite or archive existing notes, save a recall run: `node ~/.claude/skills/aar/scripts/memory-gold.mjs --save "$TMPDIR/gold-before.json"`. After, run it again with `--base "$TMPDIR/gold-before.json"` and undo any change that loses a hit. It scores the queries in `~/.claude/memory-gold.json` (`q`, `expect` slugs); add one when a lesson names a note chats should find.

Not every lesson needs a fix plan. Context only goes to memory and the vault.

## Run it honestly

An AAR that always says "went great" is useless. Find the real friction point, even on a run that mostly worked: the retry, the wrong guess, the test that was skipped. Do not dress up context as a fix plan.

## Report

The four answers, the lessons with their memory file paths, the vault page, and the to-do items filed (or "none").
