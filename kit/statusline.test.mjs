// The status line's one row, from the JSON Claude Code pipes to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { line } from './statusline.mjs'

const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')
const NOW = Date.parse('2026-10-23T12:00:00Z')

test('model, context against the compaction point, both limits with resets, and cost', () => {
  const input = {
    model: { display_name: 'Opus 5.5' },
    context_window: { total_input_tokens: 82_000, context_window_size: 1_000_000 },
    cost: { total_cost_usd: 1.234 },
    rate_limits: {
      five_hour: { used_percentage: 41, resets_at: '2026-10-23T14:10:00Z' },
      seven_day: { used_percentage: 78, resets_at: Date.parse('2026-10-25T09:00:00Z') / 1000 },
    },
  }
  assert.equal(plain(line(input, { autoCompactWindow: 200_000 }, NOW)), 'Opus 5.5 · 82K of 200K · 5h 41% 2h 10m · week 78% 1d 21h · $1.23')
})

test('falls back to the window size and leaves out what is missing', () => {
  const input = { model: { display_name: 'Sonnet 5.5' }, context_window: { total_input_tokens: 5_000, context_window_size: 200_000 } }
  assert.equal(plain(line(input, {}, NOW)), 'Sonnet 5.5 · 5K of 200K')
})

test('turns the context amber past 80% and red past 95% of the compaction point, with a word', () => {
  const at = n => line({ model: { display_name: 'M' }, context_window: { total_input_tokens: n } }, { autoCompactWindow: 100_000 }, NOW)
  assert.match(at(85_000), /\x1b\[33m85K high/)
  assert.match(at(96_000), /\x1b\[31m96K near full/)
  assert.doesNotMatch(at(50_000), /\x1b\[3[13]m/)
})

test('tones the limits the same way', () => {
  const at = p => line({ model: { display_name: 'M' }, rate_limits: { seven_day: { used_percentage: p } } }, {}, NOW)
  assert.match(at(85), /\x1b\[33mweek 85% high/)
  assert.match(at(97), /\x1b\[31mweek 97% near full/)
  assert.equal(plain(at(40)), 'M · week 40%')
})

test('ends with the branch when there is one', () => {
  assert.equal(plain(line({ model: { display_name: 'M' } }, {}, NOW, 'MVP-main')), 'M · MVP-main')
})
