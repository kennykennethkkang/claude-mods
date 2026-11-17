# claude-mods

## New computer in 5 steps

1. Install Homebrew, Node 20+, VS Code (with the `code` command), the Claude Code CLI, the Codex CLI and the AWS CLI.
2. Clone `claude-mods` and `switchboard` into `~/Documents/GitHub`.
3. Run `node kit/setup.mjs --dry-run` to see the steps, then `node kit/setup.mjs`. It installs plugins, skills, rules for Claude and Codex, role agents, settings, Jev presets, the Switchboard VSIX and the Remote Control login item.
4. Sign in to what never travels: `claude`, `codex login`, `aws login --profile default`, `/jev-setup` (OpenRouter key), `/bland:setup`.
5. Reload VS Code and click the Switchboard icon in the left bar.

On Windows, the same steps with winget instead of Homebrew, in PowerShell:

1. `foreach ($p in 'OpenJS.NodeJS.LTS','Microsoft.VisualStudioCode','Git.Git','GitHub.cli','Amazon.AWSCLI') { winget install -e --id $p }`, then Claude Code (`irm https://claude.ai/install.ps1 | iex`) and the Codex CLI (`npm i -g @openai/codex`). Open a new terminal so PATH picks them up.
2. Clone `claude-mods` and `switchboard` into `%USERPROFILE%\Documents\GitHub`.
3. `node kit\setup.mjs --dry-run`, then `node kit\setup.mjs`. The Remote Control login item is a hidden `switchboard-rc.vbs` in your Startup folder instead of a LaunchAgent.
4. and 5. as above. Switchboard's Set up button works the same; Keep awake is macOS only.

Before you move, run `node kit/setup.mjs --export` on the old machine so the kit is current. Secrets and keys never travel in the kit.

Claude Code mods (function hook plugins), served from this folder as the local marketplace `kenneth-mods`, and the kit that sets all of it up on another machine. Edit a mod here, then run `/reload-plugins` in a session: the plugin is read from this folder, not from a copy.

The mods draw nothing in the terminal but two dim bands: cache-keeper's and todo-band's. What they know shows in Switchboard (the VS Code extension based on Agent Flow), in its sidebar and editor tab.

| Mod | What it does |
|-----|--------------|
| usage-meter | Feeds every open Switchboard window: this chat's context, the 5 hour and weekly limits, the token diet and Jev runs. Carries back what is typed in Switchboard (a message, Remote Control, a compaction). When the context fills, it keeps a handoff note (plan, open tasks, latest decisions, branch; never keys) in the compaction, or hands over to a fresh chat. Starts each role on the `model:` in its `~/.claude/agents/<role>.md`; the smart switch (`smartModelSwitch` in company.json, on by default) raises a role one step (haiku, sonnet, opus, fable) after three redesign rounds on the same files, learns per project in `~/.claude/switchboard/model-learn.json` and the project's `model-escalations.md` memory note. With `advancedMode` on for a project it tells the lead to follow the `stages` skill. Run indefinitely (per chat, flag in `~/.claude/switchboard/indefinite.json`): blocks each Stop with a next-round prompt until the answer has the line `Run indefinitely: done`, denies AskUserQuestion after the first round and `mcp__switchboard__ask`, and skips blocking during a usage hold or handoff. With a `/goal` file for the chat, the round prompt points at it and its `Check:` line is the gate unless the hub set one, and the done line cannot end the run while that Check fails; a fresh chat after a handoff gets a copy of the old chat's goal file, and the ask rule says to ask everything in one round up front |
| repo-rules | Refuses `git commit` and `git push`, `git rm --cached`, a typed command that presses Switchboard's git buttons over /hub/command (a speed bump, not a boundary), `prettier --write`, and new em dashes in files under ~/Documents/GitHub or Claude's memory; each refusal shows in Switchboard's Guard activity |
| paid-guard | Spend gate for Bland, OpenRouter (Jev), Perplexity, NewBlack, paid shop searches, Gemini, Stitch and AWS. A call runs unasked only when the provider confirms a hard limit on that key, checked live every 10 min (OpenRouter `/api/v1/key` limit, Bland prepaid balance with auto recharge off); with no confirmed cap it asks once per chat per provider, or refuses when no one can answer. Gemini runs under Switchboard's monthly cap; AWS changes and Stitch uploads always ask. Each answer shows in Guard activity; keys come from env or Switchboard's saved key and are never logged |
| bash-approve | Bash runs without a permission prompt in acceptEdits, auto, dontAsk and bypass modes, unless Switchboard's Ask before actions is on; in default and plan mode (or when the mode is unknown) the normal prompt stays. A settings deny rule still wins, and it always refuses rm -r of /, ~ or ~/Documents/GitHub, sudo, a download piped into a shell (plain http reads of localhost or 127.0.0.1 may pipe into a script), a force push to main or master, reading .env files, keychain secrets or ~/.ssh keys, and disk erases |
| chat-wait | Lets a chat see this project's other live chats (chats_check) and wait for them to finish (chats_wait), then go on from their report or stop and ask when one needs you or has failing tests. A wait follows a handoff to the next chat and ends early only when you unlink it in Switchboard. A chat cannot end its turn while a wait is open: it is told to call chats_wait again (for about three hours at most), and once the targets finish the stop hands it their reports. A target counts as still working while it has subagents or shells running, and as finished at its Approve question or once approved. An edit to a file another live chat edited in the last ten minutes is stopped once and pointed at chats_wait |
| done-check | Holds a chat (or role subagent) from ending while a goal file (`.switchboard/goals/<session>.md`) has a Check command that still fails (outside Run indefinitely), its task list has open items, files were edited after the last test, lint or typecheck run, or it claims success over a failed check. Never holds a question, a usage limit or usage-meter pause, a handoff or a chat with no edits, and at most twice a turn. Writes ~/.claude/switchboard/done-check/<session>.json so Switchboard can show Verified or Unverified, at each stop and again the moment the lead asks the closing Approve question. In a session with no ask tool, the Approve question written as text counts as asked |
| cache-keeper | Keeps an idle chat's prompt cache warm: a silent ping (a fork that reruns the last request, nothing added to the chat) just before the cache expires, until 3 idle hours, a finished chat, a usage pause or /clear. A dim band above the prompt and the chat's Switchboard card show warm or cold. Cache lifetime (60m) and the idle cap are settings |
| phone-mode | With Switchboard's Phone toggle on, AskUserQuestion is denied and the chat calls Kenneth through the phone skill instead; the closing Approve question still goes to the card, and chats in Run indefinitely are left to usage-meter |
| tab-close | When a chat or role subagent ends its turn, closes the agent-browser sessions it opened, and holds the stop once while a Playwright MCP browser, claude-in-chrome tab, Scrapling session or Firecrawl browser it opened is still open, naming the tool that closes each. Never holds a question or a turn that leaves a For you step on the page |
| todo-band | When Switchboard starts a chat on a to-do item, one dim line above the prompt names it: To-do N, whether the autopilot started it, the item and who left it. Reads SWITCHBOARD_TODO; nothing shows without it |
| account-guard | Sign-in CLIs use the account picked for the project: an `aws` command with no profile of its own gets the AWS profile picked for any folder it touches (cwd, `cd` targets, absolute paths; deepest folder wins), and a web app CLI from Switchboard's Accounts page (auth0, vercel, ...) is told which login to use; `auth0` also gets `--tenant <domain>` of the picked tenant on each call that names none, inside `-c` and `eval` strings and `$(...)` or backticks in double quotes too. Strings run by `bash -c`, `sh -c`, `zsh -c` or `eval` are checked the same way. With no pick, or two different ones, the call is refused and the chat asks Kenneth, then saves the answer for the repo top with `bin/pick.mjs` (it refuses /, home, a non-repo folder and a data file that does not parse) |

`retired/` keeps context-diet, plan-pane and dev-servers, whose jobs moved into the Hub (Token diet, Plan and Dev servers cards).

## Built here

Mods: the table above. Kit skills by Kenneth: animation-styles, crowd-ab, deep-research, gemini, goal (`/goal <spec>` pins a chat to a goal file at `.switchboard/goals/<chat id>.md` with a Check command; usage-meter steers Run indefinitely rounds at it and ends the run when the Check passes), improve-system, model-bench (runs each role agent on every Claude model over hidden-test tasks and suggests the cheapest model within 5 points of the best), phone, self-improve, stages (Advanced mode: a multi-step task runs as numbered stage folders under `.switchboard/stages/`, each with a CONTEXT.md and an output folder, tracked in stages.json for Switchboard's panel) and toolchain (prints a repo's test, lint, typecheck and build commands and its ecc-agents reviewer). Role agents in `kit/agents`: researcher, engineer, qa, designer, ops, growth, Explore, engineer-codex and qa-codex. Switchboard, the app that shows all of it, is in [agent-flow](https://github.com/kennykennethkkang/switchboard).

`kit/codex-hooks.mjs` (Kenneth's): one Codex hook for PreToolUse, PostToolUse and Stop that imports bash-approve, repo-rules, account-guard, phone-mode, paid-guard, tab-close and done-check, so Codex chats get the same hard denials (shell commands, em dashes in apply_patch under the repos), account-guard's picked AWS profile and app logins (Codex cannot rewrite a command, so a fix comes back as a refusal to rerun with it), phone-mode's call-instead-of-ask on `mcp__switchboard__ask` (and `request_user_input`), paid-guard's spend policy (a call that needs Kenneth is refused once with the question to ask through `mcp__switchboard__ask`; the retry goes through), tab-close's hold on browsers the chat left open (read from the PostToolUse record), the same hold on edits with no check after them or open plan items (at most twice a turn), read from the Codex rollout. `node kit/setup.mjs --codex-hooks-only` copies it with type-stripped .mjs copies of those mods to `~/.codex/switchboard-guard` and adds that to `~/.codex/hooks.json` beside Switchboard's hooks (setup runs it too), so the hook runs on any Node and keeps working if this repo moves. The copy rebuilds itself on its next call when a file in this repo is newer, so mod edits reach Codex without rerunning setup. Building the copy needs Node 22.13 or later. If the mods fail to load, a short built-in list still refuses sudo, recursive deletes of root or home, force pushes to main and disk erases. Setup no longer writes engineer-codex and qa-codex as Codex roles.

`kit/skills/aar/scripts/memory-health.mjs` (Kenneth's): prints the memory graph's broken links, unlinked notes, superseded notes left outside `memory/archive/` and stale notes from the running Switchboard hub; the aar step and the memory rule run it after saving notes.

`kit/skills/aar/scripts/memory-gold.mjs` (Kenneth's): runs a gold set of `hub_recall` queries (`~/.claude/memory-gold.json`, each with the note slugs it should find) against the running hub and prints hit rank per query, hits and MRR; `--save` keeps a run and `--base` lists hits lost since it, so a note merge or archive that breaks recall shows up. The gold set stays out of the repo since it names private notes.

Tool choice (`kit/rules.md`): agent-browser first for web, Playwright MCP as the fallback, claude-in-chrome for signed-in Chrome, agent-desktop to explore native Mac apps and osascript for steps you repeat.

The Codex copy of the rules (`~/.codex/AGENTS.md`) gets a short tool map appended after them (`CODEX_MAP` in `kit/kit.mjs`, same text as Switchboard), so Codex uses `request_user_input`, `spawn_agent` and `update_plan` instead of the Claude-only tool names; `~/.claude/CLAUDE.md` is unchanged.

## Credits

Not Kenneth's, kept with their licenses:

- `ecc-agents` and the accessibility, click-path-audit and e2e-testing skills: [ECC](https://github.com/affaan-m/ECC) by Affaan Mustafa, MIT.
- aar: adapted from aar-loop by Cooper Simson, MIT.
- stages: the idea of Interpretable Context Methodology (ICM), Jake Van Clief and David McDermott, [arXiv 2603.16021](https://arxiv.org/abs/2603.16021), CC BY 4.0; reference repo [RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology), MIT. Idea only, no code copied.
- awwwards rubric: adapted from [claude-skill-awwwards](https://github.com/tponscr-debug/claude-skill-awwwards) by Thomas Pons, MIT.
- accessible-motion, gsap-greensock, hover-interactions, page-transitions, scroll-animations: Dylan Tarre, MIT.
- image-to-code-skill: Leonxlnx, MIT.
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
```

Turn one off with `claude plugin disable <name>@kenneth-mods`, or with its switch in Switchboard's Setup group.

## Check a mod

```
claude plugin validate ./usage-meter
claude plugin test ./usage-meter
```

## The kit: this setup on another machine, Windows too

`kit/` carries the plugins (on or off as they are here), these mods, your skills and archived skills, the Jev presets, the safe settings (model, theme, compaction point and the like; never `env`, permissions or hooks), the status line and Switchboard as a `.vsix`. Keys and sign-ins never travel. Keep the repo private: it holds other people's skills and your presets.

On this Mac, refresh it, then commit and push:

```
node kit/setup.mjs --export
```

Switchboard's Portable kit card has an Export now button that runs the same thing.

On the other machine: install Node 20 or later, VS Code with its `code` command, and Claude Code, and sign in to Claude Code. Then:

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
