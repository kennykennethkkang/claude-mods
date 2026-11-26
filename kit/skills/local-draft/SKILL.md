---
name: local-draft
description: Use when a text-in, text-out first draft could come from the local Ollama model instead of Claude tokens: a PR body, changelog lines, a summary of a file or log, a scaffold or boilerplate file, issue triage notes. Also when the user says "local draft", "draft it locally", "use ollama" or "use gemma". Not for code that must be exactly right, security calls, counts or decisions.
allowed-tools: [Bash, Read]
---

# Local draft

A local model (Ollama, `gemma3:12b` by default) writes the first draft; you check it and finish it. It costs no credits but is slow and loose, so its output is a draft, never applied or quoted unchecked.

```bash
python3 ~/.claude/skills/local-draft/draft.py "Write a PR body for this diff" /tmp/change.diff
python3 ~/.claude/skills/local-draft/draft.py "Scaffold a pytest file for parse_utc in lend/clock.py" lend/clock.py
```

Pass the files the draft must rest on. The script sends instructions as the system message and the files between SOURCE markers, asks for JSON (echoed file names, two or three verbatim quotes, the draft), and rejects the answer when an echoed name or a quote does not match the sources. A rejected draft is retried once, never patched. On a 16 GB Mac gemma3:12b writes about 2 tokens a second, so a draft takes several minutes: run it in the background.

## Before you use the draft

- Code does counting, grouping, sorting and every number; the model only writes prose from facts you hand it.
- Check every file name, function name, number and claim in the draft against the source. Fix or drop what does not hold.
- Exit 3 (server down) or 2 (failed checks): write it yourself, do not retry in a loop.
- Copy the script's last line (`LOCAL-LLM: used - <model> ...` or `LOCAL-LLM: n/a - <reason>`) into your report, with the real discrepancy count after your own check.

## Settings

Env: `OLLAMA_HOST` (default `http://localhost:11434`), `LOCAL_DRAFT_MODEL` (default `gemma3:12b`), `LOCAL_DRAFT_CTX` (default 16384; the script reuses the context the model is already loaded with, since a different `num_ctx` reloads it; raise it for long inputs if memory allows, the model takes up to 128k), `LOCAL_DRAFT_TIMEOUT` seconds (default 900), `LOCAL_DRAFT_MAX_TOKENS` (default 1024). Thinking is off (`think: false`).

Setup on a new Mac: `brew install ollama && brew services start ollama && ollama pull gemma3:12b`.

Rules adapted from the local-llm-routing pack in [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments) by ChiefGyk3D, Apache-2.0.
