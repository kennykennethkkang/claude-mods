// Pure scoring for the deep-research eval: judge output, gold check, per-arm totals.

const bit = v => (v === 1 || v === true ? 1 : 0)

/** The judge's last {...} block as { correct, cited, supported }. */
export function parseJudge(text) {
  const blocks = [...String(text).matchAll(/\{(?:[^{}]|\{[^{}]*\})*\}/g)].map(m => m[0])
  for (const b of blocks.reverse()) {
    try {
      const j = JSON.parse(b)
      if (!('correct' in j)) continue
      const claims = Array.isArray(j.claims) ? j.claims : []
      return { correct: bit(j.correct), cited: claims.length, supported: claims.reduce((n, c) => n + bit(c?.supported), 0) }
    } catch {}
  }
  return { correct: 0, cited: 0, supported: 0, error: 'no json' }
}

/** 1 when every alias regex is in the answer. A judge-free cross-check. */
export const goldMatch = (answer, aliases) => (answer && aliases.every(a => new RegExp(a, 'i').test(answer)) ? 1 : 0)

const round = x => Math.round(x * 1000) / 1000

/** Per arm: mean judge correctness, mean gold match, supported/cited, total cost. Limit-hit runs are dropped. */
export function summarize(rows) {
  const out = {}
  for (const r of rows.filter(r => !r.limited)) {
    const a = (out[r.arm] ??= { n: 0, correct: 0, gold: 0, cited: 0, supported: 0, cost: 0 })
    a.n++; a.correct += r.correct; a.gold += r.gold; a.cited += r.cited; a.supported += r.supported; a.cost += r.cost ?? 0
  }
  for (const [k, a] of Object.entries(out)) {
    out[k] = { n: a.n, correct: round(a.correct / a.n), gold: round(a.gold / a.n), citation: a.cited ? round(a.supported / a.cited) : 0, cost: round(a.cost) }
  }
  return out
}
