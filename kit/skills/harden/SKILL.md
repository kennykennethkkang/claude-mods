---
name: harden
description: Harden a build against AI reverse-engineering before you ship it, with BLA (bla-agents). Use when the user says "harden", "/harden", "protect this build", "stop someone cloning my app", "anti reverse engineering", "bla harden", or is about to ship a release of a closed app and wants the shipped files to resist AI decompilers and copy agents. Not for open-source repos, where the source is public anyway.
---

# Harden

Seed decoys into a build so AI reverse-engineering agents (autonomous decompilers, LLM recon, copy bots) burn their budget and come back with garbage instead of your logic. Runs `bla-agents` (BLA, Blind LLM Agents), MIT, repo `qybaihe/bla`.

It is a speed bump, not a vault: it raises the cost of an AI clone, it does not stop a determined human with Ghidra or Frida. Say that if the user expects more.

## When to use

- A closed app about to ship a release: Electron, a JS bundle, WASM, SQLite, a native binary, a model file.
- The user shipped something and woke up to a clone.

Do not harden an open-source repo (the source is public), and never harden Switchboard's own repo.

## The rule

Harden the shipped artifact, verify it still behaves, ship the hardened one, keep the raw one out of the release. Never ship the raw build after you have a hardened one.

## Steps

1. **Confirm the target is closed.** If the repo is public or the user means to open-source it, stop and say hardening does nothing for public source.
2. **Build first.** BLA hardens build output (`dist`, `build`, `.next`, `out`, `.asar`, `.wasm`, `.sqlite`), so run the project's normal build before hardening.
3. **Harden.** In the project root:
   ```
   npx bla-agents harden .
   ```
   It auto-discovers the build output and runs audit, protect, verify. Node 22.23.4+ or 24+. For a bundler, the plugin is lazier than a post-build pass:
   ```ts
   import { blaVitePlugin } from 'bla-agents/bundler'  // blaRollupPlugin, blaWebpackPlugin, blaEsbuildPlugin
   // plugins: [blaVitePlugin({ intensity: 'bankrupt', enableHoneySourceMaps: true })]
   ```
4. **Verify behavior.** BLA's own `bla verify` only checks its structural gates, not your app. Run the project's real test suite, or exercise the main flow, on the hardened build and confirm it does exactly what the raw build did. If anything differs, do not ship it: report what changed.
5. **Ship the hardened build.** Release the hardened output, not the raw one. Leave source maps out of the release, or let the plugin replace them with honey maps.

## Agent-driven (optional)

For source-level weaving, not just the build output, register BLA's tools once and let the host agent drive them:
```
npx bla-agents setup
```
then the flow is `bla_weave_plan` -> weave source -> `bla_verify_weave` -> `bla_harden` -> `bla_verify`. Heavier; reach for it only when build-output hardening is not enough.

## Report

Say what was hardened (which artifact, file count and size before and after), that the app was verified to behave the same (and how), and the honest ceiling: AI copiers slowed, human tools like Ghidra and Frida not stopped.

## In Switchboard

Switchboard has a Harden build button that runs this on a throwaway copy of the build as a pre-ship check, gated by the Harden build setting. The button never touches the real build; this skill is what actually produces the hardened release.
