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

The mods draw nothing in the terminal but cache-keeper's one dim band. What they know shows in Switchboard (the VS Code extension based on Agent Flow), in its sidebar and editor tab.

| Mod | What it does |
|-----|--------------|
| usage-meter | Feeds every open Switchboard window: this chat's context, the 5 hour and weekly limits, the token diet and Jev runs. Carries back what is typed in Switchboard (a message, Remote Control, a compaction). When the context fills, it keeps a handoff note (plan, open tasks, latest decisions, branch; never keys) in the compaction, or hands over to a fresh chat |
| repo-rules | Refuses `git commit` and `git push`, `git rm --cached`, a typed command that presses Switchboard's git buttons over /hub/command (a speed bump, not a boundary), `prettier --write`, and new em dashes in files under ~/Documents/GitHub or Claude's memory; each refusal shows in Switchboard's Guard activity |
| paid-guard | Spend gate for Bland, OpenRouter (Jev), Perplexity, NewBlack, paid shop searches, Gemini, Stitch and AWS. A call runs unasked only when the provider confirms a hard limit on that key, checked live every 10 min (OpenRouter `/api/v1/key` limit, Bland prepaid balance with auto recharge off); with no confirmed cap it asks once per chat per provider, or refuses when no one can answer. Gemini runs under Switchboard's monthly cap; AWS changes and Stitch uploads always ask. Each answer shows in Guard activity; keys come from env or Switchboard's saved key and are never logged |
| bash-approve | Bash runs without a permission prompt in every mode. A settings deny rule still wins, and it always refuses rm -r of /, ~ or ~/Documents/GitHub, sudo, a download piped into a shell, a force push to main or master, reading .env files, keychain secrets or ~/.ssh keys, and disk erases |
| chat-wait | Lets a chat see this project's other live chats (chats_check) and wait for them to finish (chats_wait), then go on from their report or stop and ask when one needs you or has failing tests. An edit to a file another live chat edited in the last ten minutes is stopped once and pointed at chats_wait |
| done-check | Holds a chat (or role subagent) from ending while its task list has open items, files were edited after the last test, lint or typecheck run, or it claims success over a failed check. Never holds a question, a usage limit, a handoff or a chat with no edits, and at most twice a turn. Writes ~/.claude/switchboard/done-check/<session>.json so Switchboard can show Verified or Unverified |
| cache-keeper | Keeps an idle chat's prompt cache warm: a silent ping (a fork that reruns the last request, nothing added to the chat) just before the cache expires, until 3 idle hours, a finished chat or /clear. A dim band above the prompt and the chat's Switchboard card show warm or cold. Cache lifetime (60m) and the idle cap are settings |

`retired/` keeps context-diet, plan-pane and dev-servers, whose jobs moved into the Hub (Token diet, Plan and Dev servers cards).

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
