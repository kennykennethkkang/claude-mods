---
name: self-improve
description: Use when the user says "self-improve", "/self-improve", "improve this skill", "tune the ops agent", Switchboard's Learn automatically run, or an aar or improve-system report has filed a proposed edit to a kit skill, role agent or rules.md section and it needs testing before Kenneth merges it. Manual, or inside Switchboard's twice-weekly Learn automatically run.
---

# Self-improve

Turns one lesson into one tested edit of one kit file, and hands it to Kenneth. It never applies, commits or pushes anything. Switchboard's Learn automatically applies a run to claude-mods only when the held-out pass rate rises, no item regresses and the target still matches baseline.md; it keeps the old file as previous.md in the run dir and files a to-do with an Undo line.

## Never

- Edit settings, hooks, permissions, CLAUDE.md, or any file under this skill (the judge prompt and evals are frozen). The script refuses these targets and any change to a target's frontmatter.
- Write to the target file. The candidate lives in the run dir until Kenneth merges it.
- Run on a timer, a loop or a schedule of its own. Runs start by hand, right after aar or improve-system files a proposal, or from Switchboard's Learn automatically run (which files the to-do itself: skip todo_add there).
- Judge with the run that wrote the candidate. The judge is a fresh `claude -p` with only task, output and checklist.

## Inputs

- Target: one file in `claude-mods/kit`: `agents/<role>.md`, `skills/<name>/SKILL.md` or `rules.md`.
- Lessons: a text file with the lessons from aar or improve-system reports that point at this target (copy them from the to-do item, the vault `wiki/aar-*.md` or memory).
- Evals: `evals/tasks.json`, tasks with `target` (role or skill name), `split` (`dev` or `heldout`), `prompt` and an outcome `checklist`. The author sees dev tasks only; held-out tasks decide. A target with no held-out tasks cannot run: add at least two first, from real past chats, in a separate change Kenneth reviews.

## Run

```
node <this skill>/scripts/self-improve.mjs --target ~/Documents/GitHub/claude-mods/kit/agents/ops.md --lessons lessons.txt [--budget 3] [--margin 0.1] [--candidate file] [--author-model opus] [--dry-run]
```

What it does:
1. Guards the target, copies it to `~/.claude/self-improve/runs/<stamp>/baseline.md`.
2. Reflection: one `claude -p --model opus` call writes `candidate.md` from target, lessons and dev tasks. `--candidate` skips this with a hand-written one.
3. Rejects the candidate if the frontmatter changed, nothing changed, or more than 30 lines changed.
4. Headless A/B on held-out tasks: `claude -p --setting-sources project`, 2 at a time, variant installed in a scratch workspace. Roles go in `.claude/agents/` and run as the session with `--agent <role>` on the role's own model (a Sonnet main agent tends to answer itself and skip the subagent). Skills go in a `--plugin-dir`, rules in `CLAUDE.md`, both on Sonnet. Bash, Write, Edit and web tools are off.
   One run per task per side, so a 1 item margin is thin: add held-out tasks before trusting a narrow accept.
5. Blind judge per output (Sonnet, fresh context) scores the checklist.
6. Accepts only if the candidate's pass rate beats baseline by `--margin` (default 10 points) and no checklist item that passed on baseline fails on the candidate. Equal pass rate counts only if cost drops 15% or more and turns do not rise.

Stops: any output with "hit your" (usage limit) ends the run; `--budget` (default $3, summed `total_cost_usd`) ends it; `touch ~/.claude/self-improve.off` is the kill switch, checked before every call.

## After the verdict

- Reject: report the reason and the run dir. Nothing else.
- Accept:
  1. `mcp__switchboard__todo_add` with the target path, the verdict line (pass rates, cost) and the path to `candidate.diff`, for Kenneth to merge.
  2. Save a memory note naming the old version (its run dir `baseline.md`) with `supersedes:` the earlier note about this file, if one exists. Never edit the old note.
- Report: target, lessons used, verdict JSON, spent, run dir.

## Test

`node --test <this skill>/scripts/self-improve.test.mjs` covers the target guard, frontmatter freeze, diff cap, accept rule and the eval split.
