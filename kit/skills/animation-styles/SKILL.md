---
name: animation-styles
description: Use when the user asks for an "animation style", "make it look like X", "what styles can you do", "what animation styles are there", or names one of these looks for a page, hero, background or loader - liquid morph, blob, ASCII art, holographic foil, holo card, Bauhaus shapes, neon glow, neon sign, dithering, clay 3D, claymorphism, halftone dots, kinetic typography, pixel art, particle swarm, risograph print, glitch effect, topographic lines, contour lines, glassmorphism, frosted glass, paper cutout, vaporwave grid, synthwave, flow fields, metaballs, ray-marched fractals, mandelbulb.
---

# Animation styles

Twenty looks from the "20 animation styles you can ask Claude for" reel, each with a recipe and a small vanilla snippet that runs as is (no build step, no dependencies).

| # | Style | Look | Technique |
|---|---|---|---|
| 01 | Liquid morph | Glossy gradient blob whose lobes stretch away and melt back | SVG + CSS |
| 02 | ASCII art | Rotating sphere drawn in green terminal characters | JS into a `<pre>` |
| 03 | Holographic foil | Tilting card with a rainbow sheen that tracks the tilt | CSS |
| 04 | Bauhaus shapes | Flat primaries on cream, moving in held mechanical steps | SVG + CSS |
| 05 | Neon glow | Tube lettering with a stacked halo and an irregular flicker | CSS |
| 06 | Dithering | Two tone ordered dither of a drifting light | Canvas 2D |
| 07 | Clay 3D | Matte pastel shapes hopping with squash, a torus floating above | CSS |
| 08 | Halftone dots | Rotated dot screen whose dot area carries the tone | Canvas 2D |
| 09 | Kinetic typography | One heavy word punching in, tickers running both ways | CSS |
| 10 | Pixel art | 32px sunset scene stepping at 8 fps | Canvas 2D |
| 11 | Particle swarm | Hundreds of glowing points orbiting a ring with trails | Canvas 2D |
| 12 | Risograph print | Misregistered multiply inks on grainy paper | SVG + CSS |
| 13 | Glitch effect | RGB split text with sliced bursts between calm stretches | CSS |
| 14 | Topographic lines | Evolving contour map with heavier index lines | Canvas 2D |
| 15 | Glassmorphism | Frosted card over drifting color | CSS |
| 16 | Paper cutout | Layered paper hills panning at different speeds | SVG + CSS |
| 17 | Vaporwave grid | Striped sunset over an endless neon floor grid | CSS |
| 18 | Flow fields | Thin luminous trails following a vector field | Canvas 2D |
| 19 | Metaballs | Glowing blobs that merge when they touch | WebGL |
| 20 | Ray-marched fractals | Lit, rotating Mandelbulb | WebGL |

## How to use

1. Pick the style. If the user is vague ("make it feel retro"), offer two or three from the table that fit and say why.
2. Read that style's recipe in `references/styles.md`: the prompt line, what makes it read right, and the snippet.
3. Adapt the snippet to the page: swap palette and copy, size it to the slot, keep the detail the recipe calls out. Every snippet is a `<style>`, one root element and an optional `<script>` right after it; paste it anywhere.
4. Keep the reduced motion branch every snippet already has, and pause offscreen loops (IntersectionObserver) when more than one runs on a page.

To see all twenty running, open `gallery.html` in a browser: every snippet live, with a copy button for each prompt. It never loads reference media, so it works anywhere. When the local-only `reference/` folder is present (the reel's stills and clips), `reference/gallery.html` is the same page with each clip beside its demo. After editing a snippet in `styles.md`, run `python3 build_gallery.py` to rebuild both pages (`--check` fails if either is stale; the reference page is only checked when `reference/` exists).

## Motion quality

- `accessible-motion` for reduced motion and the pause control WCAG 2.2.2 asks for on anything looping over 5 seconds.
- `gsap-scrolltrigger` when a style should play on scroll or scrub with it.
- `page-transitions` when the style is used between routes or views.
- `animate` for the timing and easing calls once the look is chosen.
