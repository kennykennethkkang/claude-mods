# Scoring rubric

Adapted from claude-skill-awwwards by Thomas Pons (MIT, see LICENSE). Trimmed to what the judge needs.

## Criteria

Score each 0 to 10, one decimal. Overall = Design x 0.4 + Usability x 0.2 + Creativity x 0.2 + Content x 0.2. Site of the Day sits at 8.0 and up.

| Criterion | Weight | Look for |
|---|---|---|
| Design | 40% | Visual impact, type hierarchy and craft, colour harmony, spacing rhythm, consistency of radius, borders and shadows, originality |
| Usability | 20% | Clear navigation, readable contrast, mobile adapted rather than squished, tap targets, visible focus and hover feedback, reduced-motion shot still complete, no console errors |
| Creativity | 20% | A concept you could sketch on paper, one memorable moment per page, conventions broken on purpose |
| Content | 20% | Specific copy (no "unlock your potential"), real or purposeful imagery, hierarchy that tells a story, a clear next step |

## Anchors

- 9-10: someone would screenshot it and share it. Nothing generic anywhere.
- 7-8: clearly designed, one or two places fall back to defaults.
- 5-6: competent template. Would not be remembered.
- 0-4: broken layout, unreadable, or every section the same.

## Automatic deductions

Each one caps Design or Creativity at 6 until fixed:

- Purple to blue or indigo to pink gradients, glow blobs.
- Three equal feature cards with an icon, title and two lines each.
- Default Tailwind palette (indigo-500, slate, gray-50 page) or default rounded-lg / rounded-xl on everything.
- Every section centred at the same max width with the same padding.
- Stock photos (laughing team at laptop, handshake, abstract 3D shapes).
- Emoji as icons, "Lorem ipsum", placeholder logos.
- Hover that only changes opacity, or no hover at all.
- Mobile shot with horizontal scroll, overlapping text or a hero taller than two screens of nothing.

## Industry cues

| Field | Mood | Palette | Type | Motion |
|---|---|---|---|---|
| Sports, fitness | Energy, precision | Dark base, one electric accent | Strong sans, mono for numbers | Fast, 200-400ms, counting stats |
| Finance | Trust, control | Neutral or dark, one accent | Clean sans, mono for amounts | Deliberate, no play |
| Creative studio | Awe, personality | Monochrome plus one pop | Huge display type | Theatrical: cursor, page transitions |
| SaaS, dev tools | Competence | Light neutral plus brand | Geometric sans plus mono | Small and functional |
| Health | Calm, care | Warm neutrals, soft greens or blues | Humanist sans, airy | Slow, breathing |
| Luxury, retail | Desire | Dark plus cream or gold | Display serif headings | Slow zoom, editorial reveals |
| Local business, food | Warmth, appetite | Earthy, food-true colours | Characterful serif or grotesk | Light, never in the way |

## Judge output

Per page, exactly this:

```
<page>
Design 7.5 | Usability 8.0 | Creativity 6.5 | Content 7.0 | Overall 7.3
Fixes:
1. <shot file>: <what is wrong> -> <concrete change: element, property, value>
2. ...
```

Fixes are ordered by score gain. Each names the shot it comes from and a change an engineer can make without a design call ("hero h1 to clamp(3.5rem, 9vw, 9rem), tracking -0.03em", not "make the type bolder").
