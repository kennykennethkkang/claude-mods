---
name: model-bench
description: Benchmark every role agent (engineer, qa, researcher, Explore, designer, ops, growth) on each current Claude model and effort level with hidden-test and rubric-graded tasks, then recommend the cheapest model per role that scores within 5 points of the best. Use when the user says "model bench", "test models", "which model for each role", "benchmark the new models", "A/B the models", or a chat started by Switchboard's Test models button.
---

# model-bench

Each role runs headless as itself (`claude -p --agent <role>`, its own role file with the model and effort lines swapped) on fixed tasks, in a clean workspace with only `~/.claude/CLAUDE.md` loaded. Scoring follows what the task folder holds: `hidden/` tests, a `rubric.md` judge, or `answers.json` regexes.

- engineer: t8 to t13 (small fixes and features; current models saturate them) and the projects p1 (greenfield service from a 200 line spec, 80 hidden tests) and p2 (cross-cutting feature plus interacting bugs in a 1,200 line codebase, 55 hidden tests). Projects get a $25 budget and 90 minutes.
- qa: q1 to q3, reviews with planted bugs, Sonnet judge, false positives cost half a bug.
- researcher and Explore: r1 (lookups) and r2 (eight questions that need tracing across files).
- designer d1, ops o1, growth g1: work graded by an Opus judge against a strict rubric, with every file the run created or changed.

## Steps

1. Check which models exist: `claude -p "Reply OK" --model <id> --output-format json` for any new id the user names. A 404 `unrecognized_model` means it is not out yet; say so and bench the aliases (`fable opus sonnet haiku`).
2. Run it in the background (resumable, stops the queue on a usage limit; rerun the same command to continue). Default round, cheap tasks first:
   `node <skill>/scripts/bench.mjs --tasks q3,r2,d1,o1,g1 --reps 2 --jobs 3 && node <skill>/scripts/bench.mjs --roles engineer --tasks p1,p2 --jobs 2`
   `--models` narrows the models, `--roles` and `--tasks` the set, `--reps` repeats, and `--efforts medium,xhigh` runs every model at each effort level (arms show as `opus@xhigh`). Role files default to medium effort when they set none. Results land in `~/.claude/model-bench/results.json` and `report.txt`; `--report` reprints the table without running. `--rescore` re-judges kept rubric runs in place, once the bench has exited (a running chain rewrites results.json from memory); rows with no saved reply keep their score.
3. Show the table per role (score, sd, cost, wall, output tokens) and the pick. Where a pricier model beats the pick by 10 points or more, say so with the numbers and let the user choose.
4. Ask which picks to apply. Apply each by setting the `model:` line (and `effort:` when an effort arm won) of `~/.claude/agents/<role>.md` (the same file the gear's Role models rows write). In the claude-mods repo also update `kit/agents/<role>.md` so new installs get it.

`--codex gpt-6-luna@high,gpt-5.6-terra@medium` benches engineer-codex and qa-codex instead: the same tasks through `codex exec` with the role header, rows tagged `codex:model@effort`, tokens from Codex's log, cost n/a.

Isolation: each run works in its own copy of the task folder and is sandboxed there. Codex runs with `--sandbox workspace-write` (writes only in the run dir, no network); Claude runs with `--permission-mode acceptEdits` and Claude Code's Bash sandbox on (`scripts/sandbox.mjs`). Nothing prompts, and a write outside the run dir is refused. The judge call has no tools.

Costs are API-equivalent from the CLI's own `total_cost_usd`. The project tasks run long on Opus and Fable, so on a subscription a full round can take more than one 5 hour window; the queue stops at the limit and the same command picks up where it left off.
