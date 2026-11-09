---
name: awwwards
description: Use when the user types "/awwwards", or asks for an award-level, Awwwards or Site of the Day website, landing page or portfolio that must be scored and pushed past 8/10 rather than just built.
---

# Awwwards

Build a site, screenshot it, have a fresh judge score it on the Awwwards criteria, fix, repeat until every page scores 8.0 or better. The loop is the point: the builder never grades its own work.

Art direction and polish live in other skills. Load them, do not restate them here:
- `design-taste-frontend` for directions, type, palette and section blueprints.
- `impeccable` (and `frontend-design`) for craft, audit and polish passes.
- `web-design-guidelines` and `accessibility` when usability scores lag.

## 1. Who is it for

Ask once, all together (AskUserQuestion as lead, `mcp__switchboard__ask` as a subagent): who visits, what they should do, what it sells or shows, the tone in three words, sites they like, and brand assets (logo, fonts, photos, copy). Use real copy and photos when given; never stock.

## 2. Banned defaults

These read as AI made. Do not ship any of them:
- Purple, blue or indigo-pink gradients, glow blobs, glassmorphism by default.
- Three equal feature cards with icon, title and two lines.
- The default Tailwind palette and radius (indigo-500, slate-*, gray-50 page, rounded-lg on everything).
- Every section centred at the same width with the same padding.
- Stock photos, emoji as icons, lorem ipsum, fake logos.
- Pure #000 or #fff backgrounds, Inter for everything.

## 3. Three concepts, then one

Draft three that differ on more than colour. For each, five lines: the idea in one sentence, composition (grid, how sections vary), type pair, palette (4 to 6 values), the one signature moment (interaction or motion). Score each against the audience from step 1, pick one, say why in one line. Show all three to the user only if they asked to choose.

## 4. Build

Design tokens first (colour, type scale with `clamp()`, spacing, easing as CSS custom properties), then static layout, then motion. Every animation has a `prefers-reduced-motion` path that still shows the content. Serve on a free local port; never 3000 or 3131.

## 5. Shoot

```
node <this skill>/scripts/shoot.mjs http://localhost:<port> --out shots
```

Crawls same-site links (or `--pages /,/work,/about`), and for each page writes `desktop.png` (1440 wide, full page), `mobile.png` (390 wide), `reduced-motion.png` and `hover-NN.png` per link, button or card, plus `shots/manifest.json` with HTTP status and console errors. Hover shots stop at `--max-hovers` per page (default 8) and the crawl at `--max-pages` (default 12); raise them for a bigger site. It refuses non-local hosts and ports 3000 and 3131, blocks any request or WebSocket that goes elsewhere, and stops if a page redirects off the local site. A site on a font or image CDN needs `--allow-host fonts.gstatic.com,fonts.googleapis.com`; that lets through fonts, images, stylesheets and media only, never scripts, fetches, pages or sockets. `manifest.json` lists what was blocked.

Playwright comes from the project. If the project does not have it, do not add it there; install a pinned copy in the scratchpad and point at it:

```
npm i --prefix <scratchpad>/pw playwright@1.64.1
node <scratchpad>/pw/node_modules/playwright/cli.js install chromium   # only if the browser is missing
NODE_PATH=<scratchpad>/pw/node_modules node <this skill>/scripts/shoot.mjs ...
```

## 6. Judge

Spawn a new agent each round with the Agent tool. Give it only:
- the shots folder and `manifest.json` path,
- `references/rubric.md` from this skill,
- the audience line from step 1.

Not the source, not the concepts, not earlier scores. A judge that knows the intent grades the intent. Prompt: "Read the rubric, then Read every PNG in the folder. Score each page exactly in the rubric's output format. Be harsh: 8.0 means Site of the Day."

## 7. Loop

Apply the judge's fixes in order, reshoot, spawn a fresh judge. Stop when every page's overall is 8.0 or higher, or after 5 rounds. Keep a table of scores per page per round. If a score stalls for two rounds, the problem is the concept, not the details: rework the section the judge keeps naming.

## 8. Report

- Score table, round by round, final row first.
- Where the shots are, and the fixes the last judge still listed.
- Stop the dev server you started. Keep `shots/` out of git (add it to `.git/info/exclude`).

## Common mistakes

| Mistake | Fix |
|---|---|
| Judging your own screenshots | Always a fresh Agent; you only apply fixes |
| Reusing one judge across rounds | It anchors on its old scores; spawn a new one |
| Fixing what is easy instead of what scores | Take fixes in the judge's order |
| Hover shots all look the same | The site has no hover design; that is a Usability and Design fix |
| Reduced-motion shot is blank or half loaded | Content hidden until an animation runs; show it by default |
