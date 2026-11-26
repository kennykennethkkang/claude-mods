---
name: deep-research
description: Research any question in depth and answer with checked citations. Use when a question needs more than one lookup, spans several sources or hops, asks to compare, survey, explain a history or settle conflicting claims, or when the user says "deep research", "research this properly", "look into this in detail" or "find out everything about". Plain lookups (a file, a symbol, one doc page) stay with the researcher agent.
---

# Deep research

Answer a question with claims you can point to. Every claim in the report has a URL or path and a short quote that was re-read before the report went out.

## When to use

- researcher agent: one fact, one file, one doc page. A lookup.
- this skill: anything with sub-questions, more than one hop ("the founder of the company that made X"), a comparison, a timeline, or a claim the user already doubts.

## Depth

Pick one and say which.

| Level | When | Shape | Budget |
|---|---|---|---|
| quick | 1 to 2 hops, stable facts | do it yourself, 2 to 4 sub-questions | ~15 tool calls |
| standard | a topic, a comparison, a few hops | yourself, breadth then depth | ~40 tool calls |
| deep | broad, contested or many entities | fan out 3 to 6 researcher subagents in parallel, one per sub-question, then merge | ~25 calls each |

For deep, each subagent brief carries: its sub-question, the source rules below, the ledger format, "~25 tool calls", and "return ledger rows only". You merge, verify and write.

## Method

1. **Recall.** `hub_recall` on the topic and read `~/Documents/vault/wiki/<slug>.md` if it exists. Start from what is known; only research what is missing or stale.
2. **Clarify.** Ask (AskUserQuestion, or `mcp__switchboard__ask` as a subagent) only when an ambiguity would change the research: which entity, which region, which time. Otherwise pick the likely reading and state it.
3. **Brief.** Write 3 to 5 lines: the question, what a good answer contains, scope, time window. Then split it into sub-questions. For multi-hop, order the hops: each one names the entity the next one needs.
4. **Breadth.** One or two searches per sub-question to map the ground. WebSearch `extended` for niche, recent or multi-step queries, `standard` otherwise. For live chatter use `last30days`; for pages with heavy JS, or a Reddit post, use `scrapling` (`mcp__scrapling__browser_fetch_once`); library docs go through context7.
5. **Depth.** Open the best sources and read the relevant part. A search summary is a lead, not a source: never cite one. A page that fails to open goes on the Not checked list by name.
6. **Triage each source.** Primary (the paper, the filing, the official doc, the dataset) beats secondary (news, encyclopedias) beats tertiary (blogs, forums, AI summaries). Note the date. Two sources that copy one origin count as one.
7. **Ledger.** Write each claim as a row (below) as you find it.
8. **Cross-check.** Every key claim (one the answer depends on) needs two independent sources, or one primary. Where sources disagree, keep both rows, mark `conflict`, and say which you trust and why.
9. **Verify citations.** Before writing, re-open every URL you will cite (WebFetch) and confirm the quote is on the page and says what the claim says. Any number someone will budget or decide on is re-checked against the page itself. Fix or drop any row that fails. Mark rows `checked`.
10. **Label.** Every claim in the report is verified (you read it on the page this run; it carries the citation) or inferred (your reasoning, AI summaries, memory, or a page you could not open; it carries `(inferred: <why>)`). An unlabelled claim is not allowed; unmarked means verified, so mark every inferred one.
11. **Outline, then write** the report from the ledger only. No claim enters the report without a row.
12. **Save** to the vault (below) when the topic is worth more than a line.

## Claim ledger

Keep it in the scratchpad as `ledger.md`, one row per claim:

```
| # | claim | source URL or path | quote (under 25 words) | type | date | status |
| 1 | Hop 1: X was founded in 1998 | https://... | "founded in 1998 by" | primary | 2023 | checked |
```

type: primary, secondary, tertiary. status: found, cross-checked, conflict, checked, inferred, dropped. date is the source's own date; the read date is the run's date in the report's Checked line.

## Report

```
**Answer:** one or two lines, the direct answer.
**Confidence:** high / medium / low, and why in one line.
**Checked:** YYYY-MM-DD. Claims without an (inferred) mark were read on the cited page that day.

## Findings
Short sections. Each claim ends with its citation: [1], [2].

## Conflicts and gaps
What disagreed, what could not be found, what is older than the user may want.

## Actions
- [dev] **Cache zsh completions**: add the compinit cache check to ~/.zshrc. Undo: restore ~/.zshrc. [3]
- [mac ask] **Update macOS**: install 26.5 from System Settings. Undo: none, the update cannot be rolled back. [5]

## Not checked
- Not read: sources found but not opened, and why.
- Could not open: each URL that failed, with the error (empty page, 403, paywall).
- Not run: commands, code or steps the answer describes but nobody ran.
Write "Nothing" under a line that has no entries; never drop the section.

## Sources
[1] Title, publisher, date. URL
```

**Actions** are changes worth making because of the findings, so the reader can press Apply in Switchboard. One line each, most useful first, 12 at most, in the form above: `[area]`, bold title, exactly what changes, `Undo:`. Areas: mac (settings and apps on this device), dev (Homebrew, shell, editor, local models), kit (Claude, Codex and Switchboard skills, mods and settings), other (other repos, phone, router, home devices), project (the project this chat runs in). Add `ask` when it cannot be undone: deleted data, sign-ins, purchases, OS updates. When an action touches this device, run the adjust skill's `facts` and read the current value first, so nothing is suggested that is already done or does not fit it. Suggest only what the findings support and cite it; leave the section out when nothing is worth changing. A report applies nothing itself.

Quick level can drop to Answer, Confidence, Checked, Not checked and Sources. No tables in the report: the Research panel renders headings, bullets and paragraphs only.

## Vault write-up

For a topic worth keeping: write or update `~/Documents/vault/wiki/<slug>.md` with the answer, key claims with citations and their (inferred) marks, the Checked date and the Not checked list near the top; link related pages with `[[slug]]`; add the page to `wiki/index.md` if new; append a dated line to `wiki/log.md`. Never edit `raw/`.

## Eval

`eval/` holds 25 multi-hop questions with gold answers (q16 to q25 are the harder round 2 set) and a runner that scores this skill against the plain researcher prompt, graded by two judges. See `eval/run.mjs --help`.
