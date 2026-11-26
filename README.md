# claude-mods

## New computer in 5 steps

1. Install Homebrew, Node 22.13+, VS Code (with the `code` command), the Claude Code CLI, the Codex CLI and the AWS CLI.
2. Clone `claude-mods` and `switchboard` into `~/Documents/GitHub`.
3. Run `node kit/setup.mjs --dry-run` to see the steps, then `node kit/setup.mjs`. It installs plugins, skills, rules for Claude and Codex, role agents, settings, the Switchboard VSIX and the Remote Control login item (macOS also gets an hourly sweep that ends phone sessions idle over 6 hours; a message from the phone serves one again).
4. Sign in to what never travels: `claude`, `codex login`, `aws login --profile default`, `/jev-setup` (OpenRouter key), `/bland:setup`.
5. Reload VS Code and click the Switchboard icon in the left bar.
6. In Switchboard, Settings, Installed (Coder view), Sync: Sign in with GitHub. Memory notes, the vault, Jev presets and Switchboard's settings come down from the private `switchboard-sync` repo in your account; on the first computer the same button creates it. New Switchboard versions and claude-mods updates arrive by themselves after that (Switchboard: Check for updates runs it now).

On Windows, the same steps with winget instead of Homebrew, in PowerShell:

1. `foreach ($p in 'OpenJS.NodeJS.LTS','Microsoft.VisualStudioCode','Git.Git','GitHub.cli','Amazon.AWSCLI') { winget install -e --id $p }`, then Claude Code (`irm https://claude.ai/install.ps1 | iex`) and the Codex CLI (`npm i -g @openai/codex`). Open a new terminal so PATH picks them up.
2. Clone `claude-mods` and `switchboard` into `%USERPROFILE%\Documents\GitHub`.
3. `node kit\setup.mjs --dry-run`, then `node kit\setup.mjs`. The Remote Control login item is a hidden `switchboard-rc.vbs` in your Startup folder instead of a LaunchAgent.
4. to 6. as above. Git for Windows is what lets hooks and the status line run in Git Bash. Switchboard's Set up button works the same; Keep awake and closing Chrome tabs are macOS only.

Before you move, run `node kit/setup.mjs --export` on the old machine so the kit is current. Secrets and keys never travel in the kit.

Claude Code mods (function hook plugins), served from this folder as the local marketplace `kenneth-mods`, and the kit that sets all of it up on another machine. Edit a mod here, then run `/reload-plugins` in a session: the plugin is read from this folder, not from a copy.

The mods draw nothing in the terminal but two dim bands (cache-keeper's and todo-band's) role-rows, which redraws the subagent rows, and smart-select's one-line Smart row, plus side-pane's pane beside the chat. What they know shows in Switchboard (the VS Code extension based on Agent Flow), in its sidebar and editor tab.

| Mod | What it does |
|-----|--------------|
| usage-meter | Feeds every open Switchboard window: this chat's context, the 5 hour and weekly limits, the token diet and Jev runs. Carries back what is typed in Switchboard (a message, Remote Control, a compaction). When the context fills, it keeps a handoff note (plan, open tasks, latest decisions, branch; never keys) in the compaction, or hands over to a fresh chat. Starts each role on the `model:` in its `~/.claude/agents/<role>.md`; the smart switch (`smartModelSwitch` in company.json, on by default) auto-picks the model from the brief (same rule as Switchboard's picker: hard words and learned files step it up, small changes down, fable and top steps held while the 5h window is at 60% or more; a `model` the Agent call sets is kept as is), reruns a round that qa or the gate sent back (same role on the files it just touched: not clean, qa found problems, or the new brief carries the gate's failure) one model step above that pick, up to opus, and raises a role one step (haiku, sonnet, opus, fable) after three redesign rounds on the same files, learns per project in `~/.claude/switchboard/model-learn.json` and the project's `model-escalations.md` memory note. Subagent effort cannot be set from `agent.spawn` (the hook can rewrite model only). The first prompt of a chat that reads like research (look up, compare, sources, docs) is offered to the home window as a research chat; `hub_recall` asks the window that started last, then older ones, and takes `scope: all|research`. With `advancedMode` on for a project it tells the lead to follow the `stages` skill. Run indefinitely (per chat, flag in `~/.claude/switchboard/indefinite.json`): blocks each Stop with a next-round prompt until the answer has the line `Run indefinitely: done`, denies AskUserQuestion after the first round and `mcp__switchboard__ask`, and skips blocking during a usage hold or handoff. With a `/goal` file for the chat, the round prompt points at it and its `Check:` line is the gate unless the hub set one, and the done line cannot end the run while that Check fails; a fresh chat after a handoff gets a copy of the old chat's goal file, and the ask rule says to ask everything in one round up front. Once the chat has been quiet for a minute it asks the windows every 6 seconds instead of 2 |
| repo-rules | Refuses a Workbench chat's Edit or Write (a Codex chat's apply_patch too, through `kit/codex-hooks.mjs`) to a file with no open `adjust` change, `git commit` and `git push`, `git rm --cached`, a typed command that presses Switchboard's git buttons over /hub/command (a speed bump, not a boundary), `prettier --write`, `pkill -f` (it matches other chats' processes), System Events keystrokes (they land in the window Kenneth is typing in), and new em dashes in files under ~/Documents/GitHub, ~/Documents/Research or Claude's memory, and an edit to a repo file another live chat wrote in the last 20 minutes (claims in `~/.claude/switchboard/claims/<repo>.json`, one per worktree, released when the chat ends, fails open; the refusal names the chat and the minutes until the hold lapses); Codex chats share the same claims through `kit/codex-hooks.mjs` (an apply_patch on a file a Claude chat holds is refused, and a patch Codex runs claims its files, freed when an engineer-codex or qa-codex run stops); each refusal shows in Switchboard's Guard activity |
| paid-guard | Spend gate for Bland, OpenRouter (Jev), Perplexity, NewBlack, paid shop searches, Gemini, Stitch and AWS. A call runs unasked only when the provider confirms a hard limit on that key, checked live every 10 min (OpenRouter `/api/v1/key` limit, Bland prepaid balance with auto recharge off); with no confirmed cap it asks once per chat per provider, or refuses when no one can answer. Gemini runs under Switchboard's monthly cap; AWS changes and Stitch uploads always ask. Each answer shows in Guard activity; keys come from env or Switchboard's saved key and are never logged |
| bash-approve | Bash runs without a permission prompt in acceptEdits, auto, dontAsk and bypass modes, unless Switchboard's Ask before actions is on; in default and plan mode (or when the mode is unknown) the normal prompt stays. A settings deny rule still wins, and it always refuses rm -r of /, ~ or ~/Documents/GitHub, sudo, a download piped into a shell (plain http reads of localhost or 127.0.0.1 may pipe into a script), a force push to main or master, reading .env files, keychain secrets or ~/.ssh keys, and disk erases |
| chat-wait | Lets a chat see this project's other live chats (chats_check) and wait for them to finish (chats_wait), then go on from their report or stop and ask when one needs you or has failing tests. A wait follows a handoff to the next chat and ends early only when you unlink it in Switchboard. A chat cannot end its turn while a wait is open: it is told to call chats_wait again (for about three hours at most), and once the targets finish the stop hands it their reports. While a chat waits, a line above its prompt says on whom (for a to-do chat, that the to-do runs after the wait; and how many Left lines it sends to To-do, once it has finished). A target counts as still working while it has subagents or shells running, and as finished at its Approve question or once approved. An edit to a file another live chat edited in the last ten minutes is stopped once and pointed at chats_wait |
| done-check | Holds a chat (or role subagent) from ending while a goal file (`.switchboard/goals/<session>.md`) has a Check command that still fails (outside Run indefinitely), its task list has open items, files were edited after the last test, lint or typecheck run, or it claims success over a failed check. Also holds a lead whose last reply has an em dash or a commit message attribution trailer (Co-Authored-By, Generated with Claude Code), with or without edits. Never holds a question, a usage limit or usage-meter pause, a handoff or a chat with no edits, and at most twice a turn. Writes ~/.claude/switchboard/done-check/<session>.json so Switchboard can show Verified or Unverified, at each stop and again the moment the lead asks the closing Approve question. In a session with no ask tool, the Approve question written as text counts as asked. A chat in ~/Documents/Research (Switchboard's Research mode) is not held for a missing check or the finish steps, only for open tasks and a failed check it calls a pass |
| cache-keeper | Keeps an idle chat's prompt cache warm: a silent ping (a fork that reruns the last request, nothing added to the chat) just before the cache expires, until 3 idle hours (8 while a question or command is open), a finished chat, a usage pause or /clear. A row `cache warm 42m` above the prompt (stacks with other mods' rows; `cold` in the warning color) and the chat's Switchboard card show warm or cold. Cache lifetime (60m), the idle cap and the open-tool cap are settings |
| phone-mode | With Switchboard's Phone toggle on, AskUserQuestion is denied and the chat calls Kenneth through the phone skill instead; the closing Approve question still goes to the card, and chats in Run indefinitely are left to usage-meter |
| tab-close | When a chat or role subagent ends its turn, closes the agent-browser sessions it opened, and holds the stop once while a Playwright MCP browser, claude-in-chrome tab, Scrapling session or Firecrawl browser it opened is still open, naming the tool that closes each. Never holds a question or a turn that leaves a For you step on the page |
| todo-band | When Switchboard starts a chat on a to-do item, one row above the prompt names it: bold `To-do N`, then the item, `+N more` and `left by <source>` dim. Out of room the source goes first, then the item is cut with `…`; on a short terminal (under 20 rows or 90 columns) it shrinks to `To-do 3  item +2`. Cut on terminal cells, never wrapped. Reads SWITCHBOARD_TODO; nothing shows without it |
| role-rows | Redraws the subagent rows under the prompt. Style `d` (default) is a tree grouped by role, laid out like the workflow progress tree: a role's first running agent draws the role in its role color with counts (`engineer  2 running, 1 done`), then one line per agent with a state glyph (⏺ running, ✔ done, ✘ failed, ◌ queued or waiting), model and effort, time running, context used and the label; that role's other rows hide. Finished lines stay, dimmed, for five minutes, then fold into `+N done`; all our bands together take about a third of the rows (three at least): finished agents fold into `+N finished`, then each role into one line (`engineer  2 running 4m, 1 failed`), then the whole tree into one roster line with a waiting role first (`qa waiting · engineer 2 running 4m`). Running time and anything waiting stay visible at every size; lines are cut on terminal cells with an ellipsis, never wrapped. The engine shows at most five agent rows under main and no mod can raise that, so past five roles the fifth row carries the rest. Other styles by `ROLE_ROWS_STYLE`: `a` one dense aligned line per agent, `b` two lines with the label under, `c` grouped under a state heading; in those a row hides a minute after it finishes. An Agent call in the transcript shrinks to one header line (ctrl+o shows it whole). `ROLE_ROWS_RESULT=1` shows only the Status and Open lines of a role's report, `ROLE_ROWS_BAND=1` adds a roster line above the prompt (`3 roles: qa waiting · engineer 4m`). Draws only from what the row already holds; a failure leaves the engine's own row |
| smart-select | A smart pick with a one-line reason for each terminal selection, logged to this chat's own file `~/.claude/switchboard/smart-picks.d/<session>-<mod>.jsonl` (one writer per file; Switchboard reads those and `smart-picks.jsonl`) so Switchboard can learn which picks held up (`smart-learned.json`, written by Switchboard, nudges a pick once another option has 5 rows and a 0.15 better rate). On the first prompt of a chat, and on each new task prompt (40+ characters, a different task type than the last pick), it classifies the task (tiny, fix, feature, ui, research, review, audit, other), picks a ponytail level, writes ponytail's per-project mode file and shared flag so subagents pick it up, and tells the model the level and why; a later switch (a band button or `/ponytail`) logs a final row and holds for the rest of the chat until `/smart` or the Smart button re-applies the pick. It writes the per-project level file only while it still holds what this chat last wrote, and leaves it alone when another chat wrote it in the last 10 minutes (owner stamp `<file>.smart`). Question rows use the hub's bucket (header, else the question text) as their task. AskUserQuestion and `mcp__switchboard__ask` log the "(Recommended)" option, or the first, and the answer. usage-meter logs a role and a model row per subagent spawn (and the escalation as its final). One dim row above the prompt (`Smart ponytail full · sonnet high · roles engineer sonnet  why: ...`) cuts to the terminal width and folds away under 20 rows |
| side-pane | A pane beside the chat that shows what is running, so the bands above the prompt can stay short. From the top: anything waiting on you (an open question, a waiting agent), the running subagents by role with model, effort, time running and their task text wrapped to two lines, Claude and Codex usage (`Claude 5h`, `Claude wk`, `Codex 5h`, `Codex wk`: bar of up to 24 cells, percent, time to reset; under 26 columns the bar drops so the reset time stays whole; a window past its reset reads 0%), this chat's Smart picks (ponytail level, model, effort, why, spawned roles in their palette colors with the model), the Cache state (`warm 42m`, cached tokens, next ping) and `Mods N on` with a Show mods button (hotkey `m`). `/side` opens or closes it, `/side mods` shows or hides the mods list. In the fullscreen layout it docks on the right from 110 columns (it opens by itself from about 144); otherwise it sits inline above the prompt. While it is drawn, only the to-do row stays above the prompt (the Smart and cache rows leave). With no pane, one row above the prompt carries the Smart button, to-do, ponytail with the model and cache, folding model, cache, to-do text, ponytail in that order. Reads `~/.claude/switchboard/limits.json`, `codex-limits.json`, the Smart picks ledger and `enabledPlugins` in `~/.claude/settings.json` every 3 seconds while open, every 30 once the chat has been quiet for a minute with no agent working |
| account-guard | Sign-in CLIs use the account picked for the project: an `aws` command with no profile of its own gets the AWS profile picked for any folder it touches (cwd, `cd` targets, absolute paths; deepest folder wins), and a web app CLI from Switchboard's Accounts page (auth0, vercel, ...) is told which login to use; `auth0` also gets `--tenant <domain>` of the picked tenant on each call that names none, inside `-c` and `eval` strings and `$(...)` or backticks in double quotes too. Strings run by `bash -c`, `sh -c`, `zsh -c` or `eval` are checked the same way. With no pick, or two different ones, the call is refused and the chat asks Kenneth, then saves the answer for the repo top with `bin/pick.mjs` (it refuses /, home, a non-repo folder and a data file that does not parse). When an `aws` call's output has one of the CLI's own signed-out error lines (session expired, ExpiredToken, no credentials, SSO token errors), the result gets a note that AWS is signed out: skip AWS-only reads (prod logs, status probes), list them as skipped, and ask for a login only when the task needs AWS (checks the output text only; Codex does not get the note) |

`retired/` keeps context-diet, plan-pane and dev-servers, whose jobs moved into the Hub (Token diet, Plan and Dev servers cards).

## Built here

Mods: the table above. Kit skills by Kenneth: adjust (makes changes on this device or outside a project, each with a backup, a check and an undo in `~/.claude/switchboard/adjustments`; messages busy chats before a change the whole Mac or network shares; ends with the finish steps), animation-styles, crowd-ab, deep-research, gemini, local-draft (a first draft from a local Ollama model, gemma3:12b by default, rejected unless its echoed file names and quotes match the sources), goal (`/goal <spec>` pins a chat to a goal file at `.switchboard/goals/<chat id>.md` with a Check command; usage-meter steers Run indefinitely rounds at it and ends the run when the Check passes), improve-system, model-bench (runs each role agent on every Claude model over hidden-test tasks and suggests the cheapest model within 5 points of the best), phone, self-improve, stages (Advanced mode: a multi-step task runs as numbered stage folders under `.switchboard/stages/`, each with a CONTEXT.md and an output folder, tracked in stages.json for Switchboard's panel) and toolchain (prints a repo's test, lint, typecheck and build commands and its ecc-agents reviewer). Role agents in `kit/agents`: researcher, engineer, qa, designer, ops, growth, Explore, engineer-codex and qa-codex. qa reviews blind: the lead's brief carries the task, the checks and the diff, never the engineer's report. Switchboard, the app that shows all of it, is in [agent-flow](https://github.com/kennykennethkkang/switchboard).

`kit/codex-hooks.mjs` (Kenneth's): one Codex hook for PreToolUse, PostToolUse and Stop that imports bash-approve, repo-rules, account-guard, phone-mode, paid-guard, tab-close and done-check, so Codex chats get the same hard denials (shell commands, em dashes in apply_patch under the repos), account-guard's picked AWS profile and app logins (Codex cannot rewrite a command, so a fix comes back as a refusal to rerun with it), phone-mode's call-instead-of-ask on `mcp__switchboard__ask` (and `request_user_input`), paid-guard's spend policy (a call that needs Kenneth is refused once with the question to ask through `mcp__switchboard__ask`; the retry goes through), tab-close's hold on browsers the chat left open (read from the PostToolUse record), the same hold on edits with no check after them or open plan items (at most twice a turn), read from the Codex rollout. `node kit/setup.mjs --codex-hooks-only` copies it with type-stripped .mjs copies of those mods to `~/.codex/switchboard-guard` and adds that to `~/.codex/hooks.json` beside Switchboard's hooks (setup runs it too), so the hook runs on any Node and keeps working if this repo moves. The copy rebuilds itself on its next call when a file in this repo is newer, so mod edits reach Codex without rerunning setup. Building the copy needs Node 22.13 or later. If the mods fail to load, a short built-in list still refuses sudo, recursive deletes of root or home, force pushes to main and disk erases. Setup no longer writes engineer-codex and qa-codex as Codex roles.

`kit/skills/aar/scripts/memory-health.mjs` (Kenneth's): prints the memory graph's broken links, unlinked notes, superseded notes left outside `memory/archive/`, stale notes and guesses (`status: unproven`) over 14 days old from the running Switchboard hub, then notes naming files git knew and the disk lost, with the new place when there is one (`memory-paths.mjs`); the aar step and the memory rule run it after saving notes.

`kit/skills/aar/scripts/memory-gold.mjs` (Kenneth's): runs a gold set of `hub_recall` queries (`~/.claude/memory-gold.json`, each with the note slugs it should find) against the running hub and prints hit rank per query, hits and MRR; `--save` keeps a run and `--base` lists hits lost since it, so a note merge or archive that breaks recall shows up. The gold set stays out of the repo since it names private notes.

Tool choice (`kit/rules.md`): agent-browser first for web, Playwright MCP as the fallback, claude-in-chrome for signed-in Chrome, agent-desktop to explore native Mac apps and osascript for steps you repeat.

The Codex copy of the rules (`~/.codex/AGENTS.md`) gets a short tool map appended after them (`CODEX_MAP` in `kit/kit.mjs`, same text as Switchboard), so Codex uses `mcp__switchboard__ask`, `mcp__switchboard__chats_check`, `spawn_agent` and `update_plan` instead of the Claude-only tool names; `~/.claude/CLAUDE.md` is unchanged.

## Credits

Not Kenneth's, kept with their licenses:

- `ecc-agents` and the accessibility, click-path-audit and e2e-testing skills: [ECC](https://github.com/affaan-m/ECC) by Affaan Mustafa, MIT (agent descriptions shortened here).
- aar: adapted from aar-loop by Cooper Simson, MIT.
- stages: the idea of Interpretable Context Methodology (ICM), Jake Van Clief and David McDermott, [arXiv 2603.16021](https://arxiv.org/abs/2603.16021), CC BY 4.0; reference repo [RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology), MIT. Idea only, no code copied.
- awwwards rubric: adapted from [claude-skill-awwwards](https://github.com/tponscr-debug/claude-skill-awwwards) by Thomas Pons, MIT.
- accessible-motion, gsap-greensock, hover-interactions, page-transitions, scroll-animations: Dylan Tarre, MIT.
- image-to-code-skill: Leonxlnx, MIT.
- Design library SOURCES.md: the site list from Hugo Manning's reel [The best inspiration sites](https://www.instagram.com/reel/Df--4CtAgrf/). Names and links only, no assets.
- smart-select reads the level files of [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (the per-project mode file and shared flag format), MIT.
- Memory junk checks (outdated notes, unproven guesses kept out of the index, a rule needs proof): ideas from Sheni Salami's reel [When to delete your second brain](https://www.instagram.com/reel/DgHzMWyhpls/). Idea only.
- Blind qa (a checker that never saw the engineer's reasoning): an idea from kem_glitch on [Instagram](https://www.instagram.com/kem_glitch/). Idea only.
- repo-rules file claims (one chat holds a file it is writing so a second chat in the same folder cannot overwrite it): an idea from kem_glitch on [Instagram](https://www.instagram.com/kem_glitch/). Idea only.
- deep-research and researcher claim labels (verified or inferred, a dated Checked line, a Not checked list of pages not read, not run or that would not open): ideas from ChiefGyk3D's [Clouds-Against-Humanity](https://github.com/ChiefGyk3D/Clouds-Against-Humanity) and [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments), Apache 2.0. Idea only.
- self-improve's 30 result floor (a role or skill counts as a new version only after 30 approved results): ChiefGyk3D's rule for the personas in [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments), Apache 2.0. Idea only.
- local-draft's rules (local output is a draft checked against its source, echo and compare identifiers, quote then answer, send num_ctx, think off, the LOCAL-LLM report line): the local-llm-routing pack in ChiefGyk3D's [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments), Apache 2.0. Rewritten, no text copied.
- extract-design-md, extract-static-html, taste-design: [stitch-skills](https://github.com/google-labs-code/stitch-skills) by Google, Apache 2.0.
- web-design-guidelines: Vercel. claude-x-jev, jev-setup-project: Charles J Dove (Jev). skill-inspector runs NVIDIA SkillSpector.
- Tools the rules point to, installed by Switchboard's Set up, not bundled: [agent-browser](https://github.com/vercel-labs/agent-browser) and [agent-desktop](https://github.com/vercel-labs/agent-desktop) by Vercel Labs, Apache 2.0; [Playwright MCP](https://github.com/microsoft/playwright-mcp) by Microsoft, Apache 2.0.

Full lines are in switchboard's README and NOTICE.

## Install

```
claude plugin marketplace add ~/Documents/GitHub/claude-mods
claude plugin install usage-meter@kenneth-mods
claude plugin install repo-rules@kenneth-mods
claude plugin install paid-guard@kenneth-mods
claude plugin install done-check@kenneth-mods
claude plugin install bash-approve@kenneth-mods
claude plugin install chat-wait@kenneth-mods
claude plugin install cache-keeper@kenneth-mods
claude plugin install ecc-agents@kenneth-mods
claude plugin install phone-mode@kenneth-mods
claude plugin install todo-band@kenneth-mods
claude plugin install tab-close@kenneth-mods
claude plugin install account-guard@kenneth-mods
claude plugin install role-rows@kenneth-mods
claude plugin install smart-select@kenneth-mods
claude plugin install side-pane@kenneth-mods
```

Turn one off with `claude plugin disable <name>@kenneth-mods`, or with its switch in Switchboard's Setup group.

## Check a mod

```
claude plugin validate ./usage-meter
claude plugin test ./usage-meter
```

## The kit: this setup on another machine, Windows too

`kit/` carries the plugins (on or off as they are here), these mods, your skills and archived skills, the safe settings (model, theme, compaction point and the like; never `env`, permissions or hooks), the status line and Switchboard as a `.vsix`. Keys and sign-ins never travel.

On this Mac, refresh it, then commit and push:

```
node kit/setup.mjs --export
```

Switchboard's Portable kit card has an Export now button that runs the same thing.

On the other machine: install Node 22.13 or later, VS Code with its `code` command, and Claude Code, and sign in to Claude Code. Sign in with GitHub in Switchboard's Sync row to pull memory and the vault. Then:

```
git clone <your claude-mods repo>
cd claude-mods
node kit/setup.mjs --dry-run
node kit/setup.mjs
```

The dry run lists every step first. After the setup: `/jev-setup` for the OpenRouter key, `/bland:setup` for Bland, `aws login --profile <name>` for AWS, then restart VS Code.

After changing Switchboard, package it again into the kit:

```
cd ~/Documents/GitHub/switchboard/extension
npx @vscode/vsce@3 package --no-dependencies --allow-missing-repository -o ~/Documents/GitHub/claude-mods/kit/switchboard-<version>.vsix
```

The status line (`kit/statusline.mjs`) is one row: model, context against the compaction point, the 5 hour and weekly limits with their resets, and the chat's cost.
