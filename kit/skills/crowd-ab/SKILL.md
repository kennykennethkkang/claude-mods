---
name: crowd-ab
description: Use when the user says "crowd ab", "1000 AI users", "synthetic users", "which version would users pick", "A/B these", or right after a design or skill head-to-head, before shipping a UI change Kenneth will see, and whenever two near-duplicate skills or plugins are compared.
---

# Crowd A/B

A panel of synthetic users votes between 2 to 4 options. Default 1000 personas through Jev (claude-x-jev), about $0.05 for two short options. It is a cheap sniff test of preference, not a measure of real conversion.

## When to run

- After a design head-to-head or a skill head-to-head, on the finalists.
- Before shipping a UI change Kenneth will see.
- When two near-duplicate skills or plugins are compared: run it next to the hidden-test bench, never instead of it. The bench says which one works; this says which one people would pick.

## Inputs

- Goal: what the user is trying to do ("sign up for a free account").
- 2 to 4 options, each one of:
  - copy or skill output: pass the text, or `@file.txt`
  - HTML: `@page.html` (tags stripped to visible text)
  - screenshot: Jev reads text only. Read each image yourself and write one neutral, factual description per option with the same fields in the same order (layout, main text, buttons, colors, contrast, size of tap targets). Never say which you prefer in it. Pass those as the options. With `--panel`, the haiku panel gets the same descriptions.
- Who writes the options: an agent that built neither option (usually qa). The builder of a variant never writes its description or runs crowd-ab on its own work.
- Labels: `--label` per option, same order, for the report.

## Run

```
node <this skill>/scripts/crowd-ab.mjs --goal "sign up" \
  --option @a.html --option @b.html --label "New" --label "Current" \
  [--n 1000] [--cap 1] [--seed 1] [--out dir] [--panel] [--dry-run]
```

What it does, so you do not redo it by hand:
- Builds N personas varied by age, tech skill, device, accessibility needs, intent and patience (seeded, repeatable).
- Jev: rates each option alone per persona (5 level appeal score plus the main reason from a fixed list: clearer, faster, trust, looks, accessible, familiar, none), one call per persona per option. The persona's pick is the higher score; scores within 0.15 of a level count as no preference. Never ask Jev to pick between options shown side by side: in a 1000 persona test it chose whichever was shown first 99.4% of the time. Jev returns labels only, never prose, so reasons are categories.
- Haiku panel: shows all options in a shuffled order per persona so position bias cancels, and reports how often the option shown first won (near 50% for two options means no bias; far off means the panel is reading position, not content).
- Prints a cost estimate, runs a 10 persona pilot, extrapolates the real cost and stops if it is over `--cap` (default $1).
- Fallback when Jev is missing or `jev.py status` fails (or `--panel`): 30 personas via `claude -p --model haiku`, 4 at a time, with a one-line free text reason each. Stops on "hit your" usage limits.

## Reading the result

- Win rate is the leader against the runner-up on decisive votes; "no preference" is counted and shown but left out of that rate.
- 95% Wilson interval. A winner is declared only if the interval excludes 50%. Otherwise say "no winner" and do not pick one anyway.
- Segment splits show where the leader loses (for example 65+ or screen reader users). Segments under about 30 votes are noise; say so.
- Report to the user: verdict line, win rate with interval, no-preference share, position bias line (panel runs), the 2 or 3 segments that differ most, top reasons per option, cost.

## Limits

- Synthetic users share one model's taste. Treat a narrow win as a tie, and never as proof real users agree.
- Keep option text comparable in length and detail; a richer description wins on detail, not merit.
- The OpenRouter key is saved for jev.py. Never print it or pass it on the command line.

## Test

`node --test <this skill>/scripts/crowd-ab.test.mjs` covers the interval, winner rule, segments, reasons and order decoding.
