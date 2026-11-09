# Making a mod

A mod is a Claude Code plugin in this repo, served by the local `kenneth-mods` marketplace. For the hook API itself (what `register.ts` can hook, panes, bands, toasts, commands), run the `plugin-authoring` skill in a chat.

## Layout

Copy `paid-guard/` as the starting point:

```
my-mod/
  .claude-plugin/plugin.json   name, version, description, author Kenneth Kang, license MIT
  hooks/hooks.json             { "modules": ["./register.ts"] }
  hooks/register.ts            the code; export the pure parts so tests can import them
  tests/my-mod.test.ts         import { expect, test } from 'claude-code/testing'
```

Keep the logic in plain exported functions (like `spendOf` in paid-guard) and the register call thin, so most of it tests without a running chat.

## Add it to the marketplace

Add `{ "name": "my-mod", "source": "./my-mod" }` to `.claude-plugin/marketplace.json`.

## Check it

```
claude plugin validate ./my-mod
claude plugin test ./my-mod
```

## Install it here

```
claude plugin marketplace update kenneth-mods
claude plugin install my-mod@kenneth-mods
```

Start a new chat to load it. Turn it off with `claude plugin disable my-mod@kenneth-mods` or its switch in Switchboard's Setup group. It shows in Switchboard's tools list as a mod (any plugin id ending in `@kenneth-mods`).

## Ship it with Switchboard

Only when it should go to other machines through Set up:

1. Add the name to `"mods"` in `agent-flow/extension/kit/setup.json`.
2. Build the extension (`cd agent-flow/extension && pnpm build`). `esbuild.js` copies the mod and the marketplace file into `extension/kit/mods`; do not edit that copy by hand.
3. Set up on a fresh machine installs it as `my-mod@kenneth-mods` from the bundled copy.

## Rules that bite

- No keys or sign-ins in a mod. Read them from the env or the OS store at run time.
- A mod that runs on every tool call must stay fast: no network, no big file reads.
- Retired mods move to `retired/` and leave `marketplace.json`.
