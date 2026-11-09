<purpose>
Turn Jev on for one repo: draft that project's presets, check each on a few real items from the repo, and switch on its hooks for that repo only. Switchboard's "Set up Jev" button starts a chat on this task.
</purpose>

<jobs>
| Job | Preset | Where it runs |
| --- | --- | --- |
| done | `<project>-done` | Switchboard's done-check scores each request in a chat against its Done list (coverage.ts reads this preset when it exists) |
| gate | `<project>-gate` | PreToolUse hook on Bash: asks Kenneth when `destructive`, `paid` or `prod` reaches its `thresholds.high` (0.5 by default); obvious reads and paid-guard's own calls skip Jev; any error leaves the normal prompt |
| tells | `<project>-tells` | Stop hook: em dashes by regex, machine prose by Jev, on changed lines and the proposed commit message; blocks the stop once with the lines to fix |
| route | `<project>-route`, `<project>-findings` | the lead labels a task with a role, and buckets qa's findings by severity, through `jev.py ask` |
</jobs>

<steps>

<step name="read_repo" priority="first">
Read install.md (key and model). Then read the repo: CLAUDE.md or AGENTS.md, the README, the package or build file, the test command. Run:

    node <skill-dir>/scripts/jev-project.mjs draft --folder <repo>

It prints the five drafts, named `<project>-<job>`, where `<project>` is the repo folder in lower case (the name Switchboard shows). Edit the criteria for this repo only where the drafts miss something real: a path that is production, a port never to touch, a paid service it calls. Keep the question keys; coverage.ts reads `addressed`.
</step>

<step name="sanity_check">
For each preset, write 6 to 12 real items from this repo with the label you expect in `_truth`:
- gate: commands from its scripts, CI and recent history, plus a few that should ask (a force push, an rm outside build output, a deploy)
- tells: comment lines and commit subjects from `git log -p`, plus two or three machine-sounding lines
- done: requests and Done lists from recent chats here
- route: tasks from the repo's to-do or recent commits
- findings: review notes from a past qa report, or written from recent bugs

Run each with `python3 <skill-dir>/scripts/jev.py ask --preset <draft.json> --input <items.jsonl>` and count agreement against `_truth`. A miss on a clear item means the criteria need words, not the bar moving (frameworks/criteria-writing.md). Report preset, items, agreement and cost in one line each.
</step>

<step name="turn_on" priority="last">
Run:

    node <skill-dir>/scripts/jev-project.mjs setup --folder <repo>

Add `--jobs done,route` to turn on only some, `--force` to overwrite presets that already exist (tuned ones are kept otherwise). It writes the presets to `~/.claude/jev-presets`, merges the gate and tells hooks into the repo's own `.claude/settings.local.json`, and adds `.claude/` to `.git/info/exclude` so none of it gets committed. Then save any criteria you edited over the written presets.

Close with `node <skill-dir>/scripts/jev-project.mjs status --folder <repo>` and say which jobs are on. New chats in the repo pick up the hooks; Switchboard's Jev card shows the jobs, last runs and cost. To turn a hook off, remove its entry from settings.local.json; to turn done or route off, delete the preset.
</step>

</steps>
