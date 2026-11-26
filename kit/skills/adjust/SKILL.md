---
name: adjust
description: Make a real change on this device or outside the open project, with a backup, a check and an undo logged for each one. Use for "change this on my Mac", "adjust", "set this up on this device", "apply this research", "fix this setting", and in every Workbench chat. Covers Mac settings and apps, developer setup (Homebrew, shell, editor, local models), the Claude and Switchboard kit, other repos, phones, routers and home devices.
argument-hint: <what to change>
---

# Adjust

A finding is not the end: change the thing, prove it worked, and leave a way back. Switchboard lists every change on its Workbench page, with Undo.

## Before choosing

1. `node ~/.claude/skills/adjust/scripts/adjust.mjs facts`, and read the current value of whatever may change. Advice that does not fit this device, or is already done, is dropped.
2. Research only what is missing. deep-research when it takes more than a lookup.
3. A change the whole Mac or network shares (brew upgrade or cleanup, Wi-Fi, DNS, power, shared caches, a window reload), made or put to Kenneth: call ListAgents and SendMessage each busy chat what moves and when, and wait for its answer before `begin` or the advice. No answer in 10 minutes: ask Kenneth, naming the chat. Brewed tools can fail until the run exits.

## Each change

```sh
A=~/.claude/skills/adjust/scripts/adjust.mjs
node $A begin --title 'Cache zsh completions' --why 'shell start took 0.9 s' --area dev --target '~/.zshrc' --file ~/.zshrc
# make the change
node $A done <id> --check 'zsh -ic exit'
```

- `begin` takes every file you will edit (`--file`, once per file, new files too) or the command that reverses it (`--undo 'defaults write com.apple.dock autohide -bool false'`), or both. A Workbench chat's edit to a file with no open change is refused.
- Applying a report's action: add `--report <id> --action <key>` from the message.
- One change per record, so each can be undone alone.
- A failed check: `node $A undo <id>` at once, then say so.
- `list` shows the log. A check proves the result (the new timing, the value read back), not just that a command ran.

## What runs, what asks

- Undoable changes run without asking.
- Ask first (AskUserQuestion, or `mcp__switchboard__ask` in a subagent) for anything that cannot be undone: deleted data, sign-ins, purchases, OS updates, factory resets, messages to people, big downloads. Then log it with `--no-undo '<why>'`.
- Commands that need root are never run. Give Kenneth the exact step and open the right settings pane or file in the background (`open -g`).
- Deletes go to the Trash. Never send keystrokes to another app.
- Never open secrets: env files, keys, keychains. `begin` refuses them. Shell and app config files often hold keys too: print only the lines you need, never the whole file.
- Compare before and after for what must not move (`which python3`, PATH), and undo when it did.

## Reach

- **mac**: `defaults read` first, then `defaults write`; the undo is the old value, or `defaults delete` when there was none. osascript, `shortcuts`, user launch agents; agent-desktop for an app nobody scripted.
- **dev**: brew, shell files, VS Code settings, local models. Check free disk before a download; the undo of an install is the uninstall.
- **kit**: edit the source repo (claude-mods, Switchboard), never the installed copy. Run its tests, end with that repo's Commit message block.
- **other**: other repos are edited, never committed or pushed. Phones, routers and home devices only through a CLI or API this machine already reaches; otherwise exact steps for Kenneth.

## End

A short list: what changed, how it was checked, how to undo it, what is left for Kenneth. Then finish like any chat that changed something: aar, the standup, the Left question if anything is left, and the Approve question. Saying the chat is closing does not close it.
