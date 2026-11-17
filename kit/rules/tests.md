---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
  - "**/test_*.py"
  - "**/*_test.*"
---

## Writing tests

- Write tests in the runner the repo already uses (check its manifest, CI or existing tests; `node ~/.claude/skills/toolchain/scripts/toolchain.mjs <repo>` lists them) and run every test you write. A run that fails with "No module named" or "command not found" is a fail, not a skip. Delete venvs, caches and scratch scripts you made just to run them.
