---
name: memory-fix
description: Fix memory graph issues. Use when the user says "memory issue", "fix memory", "memory health", "memory is broken", when the aar skill lists memory health problems, and in the Learn run. Applies the safe fixes with backups, then walks the rest per kind.
---

# Memory fix

Runs the safe repairs on the memory graph by script, then you handle what needs judgment. Never invent facts: a fix that needs one you do not have is listed for Kenneth, not guessed.

## Steps

1. Save a recall baseline: `node ~/.claude/skills/aar/scripts/memory-gold.mjs --save "$TMPDIR/gold-before.json"`. Then `node ~/.claude/skills/memory-fix/scripts/memory-fix.mjs --dry` and read the plan. Drop `--dry` to apply. It reads health from the running hub (exit 2 otherwise), or from `--graph <file.json>`. Backups go to `~/.cache/memory-fix/<time>/`.
2. What it applies: `MEMORY.md` drift (drops lines for missing files, appends `- [name](file.md): description` for unlisted notes); a live note that a live note supersedes moves unedited to `archive/` (not when in a loop); a dangling link retargeted when exactly one note matches by slug, or by edit distance 1 for names of 6 or more characters. It never writes through a symlink or outside the memory and wiki folders.
3. Each line it prints under "needs judgment" has a path. Handle by kind:
   - dangling: find the note the link meant (`hub_recall`, grep the folder), retarget; only if none exists, remove the link. Never leave a link to a note that does not exist.
   - orphan: add a typed relation or `[[link]]` to a genuinely related note. If nothing is related, leave it and report it.
   - duplicates: compare description and type, not just name. Same thing: write the merged note with `supersedes`, archive the old one. Different things: rename one or add `aliases`.
   - contradictions: resolve with `supersedes` only when both notes cover the same subject and one has newer evidence. Otherwise leave and list it for Kenneth.
   - invalid: draft the missing description from the note body, set `metadata.type` to user, feedback, project or reference. Do not make up content.
   - stale (project notes over 90 days): check against code and git. Still true: touch nothing, or update it. Replaced: write the new note with `supersedes`. Unverifiable: report only.
   - loops: keep the newest note, delete the other `supersedes` lines.
4. Rules for relations: `supersedes` when a fact changes (new note, old one moves unedited to `memory/archive/`, drop its index line); `depends-on`, `part-of`, `related` for the rest; `contradicts` only while unresolved. Link only to notes or wiki pages that exist; tools and skills go in backticks. Wiki pages: update `index.md` and append a dated line to `log.md`.
5. Finish: rerun the script, then `node ~/.claude/skills/aar/scripts/memory-health.mjs`, then `node ~/.claude/skills/aar/scripts/memory-gold.mjs --base "$TMPDIR/gold-before.json"`. Exit 1 means a recall hit was lost: restore from the `~/.cache/memory-fix` backup or fix the link. Report what is left.

## Before writing a note

Reconcile first (the Mem0 pattern): `hub_recall` the topic, then pick one. Add when nothing covers it. Supersede when a note covers the same subject and the fact changed. Skip when a note already says it; update its `modified` line only if the content changed.

## Consolidation proposals (Learn run)

Switchboard's twice-weekly Learn run calls this after improve-system: a sleep-time pass that only proposes. Ignore Steps above and the script; this pass edits nothing. Read every note in the folders it names (`MEMORY.md` first, skip `archive/`). Never edit, move or delete a note; write only the proposals file the prompt names.

- Merge: two or more live notes that say the same thing, or one that only narrows another. Give the merged note in full, with `supersedes:` naming every note it replaces.
- Rewrite: a note over about 25 lines, or one whose rule is buried under its story. Keep every fact, command, path and number; cut the rest. Keep `name`, the relations and the `**Why:**` / `**How to apply:**` lines.
- Skip notes in different projects unless they are word for word the same, and anything you would have to guess about.
- At most 10 proposals, biggest saving first. None is a fine result: write nothing.

File format: one `## Merge <a>.md + <b>.md` or `## Rewrite <a>.md` heading per proposal, then the folder, one line on why, and the new note in a fenced block. Switchboard counts the `## ` headings and files one to-do. Applying them later is a chat's job: run the gold check, write the new note, archive the old ones, append each merged note's slug to every ~/.claude/memory-gold.json expect list that names a note it supersedes, rerun the gold check.

## Credits

Ideas only, no code: Letta sleep-time compute (consolidation while idle, arxiv 2504.13171), Mem0 add/update/delete/noop reconcile (arxiv 2504.19413), Graphiti non-lossy invalidation (arxiv 2501.13956), A-MEM linked notes (arxiv 2502.12110).
