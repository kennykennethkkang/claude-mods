---
name: toolchain
description: Use when starting work in a repo whose CLAUDE.md does not name its test, lint, typecheck or build commands, when a role needs the checks for an unfamiliar language, or when the lead picks the ecc-agents reviewer or build resolver for a qa or engineer brief.
---

# Toolchain

Reads a repo's manifests and prints the commands to test, lint, typecheck and build, plus the matching ecc-agents reviewer and build resolver.

```bash
node ~/.claude/skills/toolchain/scripts/toolchain.mjs <repo>         # plain text
node ~/.claude/skills/toolchain/scripts/toolchain.mjs <repo> --json  # for scripts
```

It looks at the root and one folder down (monorepos), and lists single-line `run:` steps from `.github/workflows` under "CI runs".

Covers JS/TS (lockfile picks pnpm, yarn, bun or npm), Python (uv, poetry, pipenv, pip; pytest, ruff, mypy, pyright; Django, FastAPI, PyTorch), Go, Rust, Swift (Package.swift or Xcode project), Java and Kotlin (Gradle or Maven), Ruby, PHP, .NET, C/C++ (CMake or Makefile) and Dart/Flutter.

## Use it

- The repo's CLAUDE.md, AGENTS.md or CI wins when they disagree with this; the output is a starting point.
- A missing line means no script or config was found. Do not invent one; check the README.
- Lead: paste the Reviewer line into qa briefs and the Build resolver line into engineer briefs when a build breaks. Call them as subagents (`ecc-agents:<name>`).
- Xcode schemes are guessed from the project name; run `xcodebuild -list` if the test command fails on the scheme.
