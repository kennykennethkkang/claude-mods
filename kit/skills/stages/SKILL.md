---
name: stages
description: Run a multi-step task as numbered stage folders, one per role step, each with its own CONTEXT.md and output folder, so every brief cites a file and every handoff is a folder the next stage reads. Use when Switchboard says Advanced mode is on for the project, when the user says "stages", "stage folders", "advanced mode", "run this in stages" or "ICM", or when a task needs two or more role steps in order (research, build, review). Small tasks (one role, one step) skip it.
---

# Stages

Each step of a multi-step task gets a folder. The folder says what the step is, what it reads and what it must leave behind. The next step reads the previous step's output, not the chat.

## When

- Two or more role steps in order: stages.
- One role, one step (a typo, a one-file fix, a lookup): no stages, brief as usual.

## Layout

```
.switchboard/stages/<run-id>/
  stages.json
  01_research/
    CONTEXT.md
    output/
  02_build/
    CONTEXT.md
    output/
  03_review/
    CONTEXT.md
    output/
```

- `<run-id>`: `<date>-<slug>-<chat id>`, `2026-11-11-login-redesign-<chat id>`. The chat id is the one Switchboard's Advanced mode line gives ("this chat's id is ..."); Switchboard finds the chat's stages by it.
- `NN_<name>`: two digit order, then a short lowercase name.
- `.switchboard/` stays out of git; Switchboard creates it and adds it to `.git/info/exclude`. If it is missing, create the folders yourself.

## CONTEXT.md

Four headings, short:

```
# 02 build

## Role
engineer

## Inputs
- .switchboard/stages/<run-id>/01_research/output/findings.md
- web/components/login.tsx

## Process
Test first, then the smallest change that passes. Run the repo's checks.

## Outputs
- output/report.md: the Report (Status, Changed, Checked, Open)
- the code change itself, in the repo
```

Inputs name files, never "see the chat". Outputs name files inside that stage's `output/`.

## stages.json

The lead keeps it current. Switchboard's panel reads it.

```json
[
  { "n": 1, "name": "research", "role": "researcher", "status": "done" },
  { "n": 2, "name": "build", "role": "engineer", "status": "doing" },
  { "n": 3, "name": "review", "role": "qa", "status": "todo" }
]
```

`status`: `todo`, `doing`, `done` or `redo`. Rewrite the whole file on each change.

## The lead's loop

1. Plan the stages; write `stages.json` and every `CONTEXT.md` up front. If the first prompt says a saved pipeline seeded a run, that run folder already has them (statuses todo): read them, adjust, and run that folder instead of planning a new one.
2. For each stage, set it `doing`, then brief the role: the CONTEXT.md path, plus anything only you know. Ask it for the Report in its reply and save it into that stage's `output/` yourself; a hook refuses subagent writes of report files there.
3. When the role reports, check the outputs exist and match Outputs. Set `done`, or `redo` and brief again with what was missing.
4. A qa stage that finds problems sends the build stage back to `redo`; its `output/` keeps the findings the engineer reads next.
5. The last stage done is the task done; the usual Approve still closes the chat.

When the user wants to look at a stage before the next starts, stop after setting it `done` and ask; their "Redo" sets it `redo`.

The user can also press Looks good or Redo on the chat card, which rewrites `stages.json` directly. Reread `stages.json` before starting each stage: a stage set back to `redo` runs again first, with the user's reason if they gave one.

## Credits

The idea is Interpretable Context Methodology (ICM) by Jake Van Clief and David McDermott, arXiv 2603.16021, CC BY 4.0. Reference repo RinDig/Interpretable-Context-Methodology, MIT. Idea only; no code or text copied.
