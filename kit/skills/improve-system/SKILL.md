---
name: improve-system
description: Use when the user says "improve system", "/improve-system", "what do you keep getting wrong", "review my week", "what should be a skill", or a twice-weekly scheduled run fires. Reads the local Claude Code transcripts across every chat for a window of days and reports repeat mistakes, repeat tasks worth a skill, and rules that would have prevented them.
---

# Improve system

Looks across many chats for patterns: what Claude got wrong more than once, what the user keeps asking for by hand, and what context would have stopped it. `aar` reviews one chat; this one reviews the week. It only reads and proposes. It never edits CLAUDE.md, rules, skills or settings.

Fully local: transcripts stay on this machine, no network calls, nothing sent anywhere. Under `~/.claude` it reads only `projects/*/*.jsonl`, memory files and `CLAUDE.md`; never `settings*.json`, `.credentials*` or `.claude.json`.

## Arguments

- Days: default 7. "last 3 days" means `--days 3`.
- Project: optional, a part of the project folder name, `--project switchboard`.

## Steps

1. Scan. Never read whole transcripts into context; the script does the reading.

   ```
   node <this skill>/scripts/scan.mjs --days 7 [--project name]
   ```

   It prints one JSON object: `projects` (sessions, typed turns, tool errors, interrupts), `retries` (a failed tool call run again unchanged), `corrections` (typed turns that read like a correction or frustration), `errors` (tool errors grouped, with counts and projects), `repeated` (4 to 8 word phrases typed in two or more sessions) and `openers` (the first ask of each session). Secrets are redacted before printing, best effort: private keys, URL passwords, `sk-`/`rk-`/`pk-` and Stripe `sk_live_`/`rk_test_` keys, AWS `AKIA`, GitHub `gh*_`, Slack `xox*-`, Google `AIza`, JWTs, `Bearer` values, `key`/`token`/`secret`/`password` assignments (plain or JSON-quoted), hex runs of 32+ and mixed runs of 40+ outside file paths. Anything else can slip through; treat the output as private.

2. Check what is already known, so the report does not repeat it:
   - `hub_recall` for the main topics found, if that tool is available.
   - If a vault exists at `~/Documents/vault`: its `wiki/aar-*.md` and `wiki/improve-system.md` (earlier runs).
   - The project memory folders' `MEMORY.md` and `~/.claude/CLAUDE.md`.
   - The open Switchboard to-do, if Switchboard is installed, so the same fix is not filed twice.

3. When a hit needs context, grep the one transcript for it (`grep -n "phrase" ~/.claude/projects/<dir>/<id>.jsonl | head`) and read a few lines around it. Do not open whole files.

4. Write the report (below).

5. File each proposed rule or skill change with `mcp__switchboard__todo_add` (without Switchboard, list them at the end of the report): the exact target file and the exact text to add or replace. Point at the source a rule or skill is built from, not an installed copy: if a `claude-mods` clone exists, that is `kit/rules.md`, `kit/skills/<name>/SKILL.md` or `kit/agents/<role>.md` there, not the copies in `~/.claude` or `switchboard/extension/kit`. Never apply them.

6. If a vault exists at `~/Documents/vault`, append the dated report to its `wiki/improve-system.md` following its `README.md` (add it to `wiki/index.md` if the page is new, a dated line in `wiki/log.md` either way). Otherwise the report in the reply is the record. One-line facts that are already settled go to memory the way `aar` does it.

## What counts

- A mistake is a pattern when it shows up in two or more sessions, or three times in one. One-offs go nowhere.
- A correction keyword alone is not a mistake. "again" can mean "run it again". Read the text before counting it.
- A repeat task is the same ask in two or more sessions that takes the same steps each time: "ask all questions first", "add the commit message", "watch this reel with gemini". Phrases that are just how the user talks are not tasks.
- A rule proposal must name the file, the text and the mistake it would have stopped. Same bar as `aar`: no "be more careful".

## Report

```
Improve system: <since> to <today>, <n> sessions, <projects>

Repeat mistakes
- <what went wrong>: <n> times in <projects>. Why: <mechanism>. Fix: <to-do id or "known, see <memory/page>">

Make it a skill or automation
- <task>: asked in <n> sessions. Draft: <skill name, or hook/schedule/alias>

Rules that would have helped
- <file>: "<text>" stops <mistake>. Filed: <to-do id>

Nothing new: <areas checked that came up clean>
```

Keep it under a screen. Zero findings in a section is a fine answer.

## Drafting a skill

Only when the user asks for it, or picks one from the report: draft a `SKILL.md` for the top repeat task in the reply (or under the scratchpad), with `name`, a `description` that starts "Use when" and names the user's own trigger phrases from `repeated`, and the steps as they were done in the sessions. It is saved (to `claude-mods/kit/skills/<name>/` if that clone exists, else `~/.claude/skills/<name>/`) only after the user approves it. Follow `superpowers:writing-skills` if installed.

## Running it twice a week

Switchboard does it: with Settings, Learn automatically on (the default), one window runs `claude -p` naming this skill in the agent-flow folder twice a week, when usage is under the pause threshold. That run passes each proposal to `self-improve`; Switchboard applies clear wins and files the rest. Without Switchboard, a cron or launchd job running `claude -p "/improve-system"` works; a cloud `/schedule` routine cannot read the local transcripts.

