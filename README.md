# claude-mods

## New computer in 5 steps

1. Install Homebrew, Node 20+, VS Code (with the `code` command), the Claude Code CLI, the Codex CLI and the AWS CLI.
2. Clone `claude-mods` and `agent-flow` into `~/Documents/GitHub`.
3. Run `node kit/setup.mjs --dry-run` to see the steps, then `node kit/setup.mjs`. It installs plugins, skills, rules for Claude and Codex, role agents, settings, Jev presets, the Switchboard VSIX and the Remote Control login item.
4. Sign in to what never travels: `claude`, `codex login`, `aws login --profile default`, `/jev-setup` (OpenRouter key), `/bland:setup`.
5. Reload VS Code and click the Switchboard icon in the left bar.

Before you move, run `node kit/setup.mjs --export` on the old machine so the kit is current. Secrets and keys never travel in the kit.

Three Claude Code mods (function hook plugins), served from this folder as the local marketplace `kenneth-mods`, and the kit that sets all of it up on another machine. Edit a mod here, then run `/reload-plugins` in a session: the plugin is read from this folder, not from a copy.

The mods draw nothing in the terminal. What they know shows in Switchboard (the VS Code extension based on Agent Flow), in its sidebar and editor tab.

| Mod | What it does |
|-----|--------------|
| usage-meter | Feeds every open Switchboard window: this chat's context, the 5 hour and weekly limits, the token diet and Jev runs. Carries back what is typed in Switchboard (a message, Remote Control, a compaction). When the context fills, it keeps a handoff note (plan, open tasks, latest decisions, branch; never keys) in the compaction, or hands over to a fresh chat |
| repo-rules | Refuses `git commit` and `git push`, `git rm --cached`, `prettier --write`, and new em dashes in files under ~/Documents/GitHub or Claude's memory; each refusal shows in Switchboard's Guard activity |
| paid-guard | Asks before Bland calls, OpenRouter generation, NewBlack renders, paid shop searches, Gemini requests and AWS changes; each answer shows in Guard activity |

`retired/` keeps context-diet, plan-pane and dev-servers, whose jobs moved into the Hub (Token diet, Plan and Dev servers cards).

## Install

```
claude plugin marketplace add ~/Documents/GitHub/claude-mods
claude plugin install usage-meter@kenneth-mods
claude plugin install repo-rules@kenneth-mods
claude plugin install paid-guard@kenneth-mods
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
cd ~/Documents/GitHub/agent-flow/extension
npx @vscode/vsce@3 package --no-dependencies --allow-missing-repository -o ~/Documents/GitHub/claude-mods/kit/switchboard-<version>.vsix
```

The status line (`kit/statusline.mjs`) is one row: model, context against the compaction point, the 5 hour and weekly limits with their resets, and the chat's cost.
