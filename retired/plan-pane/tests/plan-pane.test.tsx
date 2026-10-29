import { expect, test } from 'claude-code/testing'

import { parsePlan } from '../hooks/register.tsx'

test('reads tasks and their boxes', () => {
  const view = parsePlan('p.md', ['# P', '### Task 1: Settings', '- [x] **Step 1**', '- [x] **Step 2**', '### Task 2: Memory', '- [x] a', '- [ ] b', '### Task 3: Mods', '- [ ] c'].join('\n'))
  expect(view.tasks).toEqual([
    { title: '1 Settings', done: 2, total: 2 },
    { title: '2 Memory', done: 1, total: 2 },
    { title: '3 Mods', done: 0, total: 1 },
  ])
})
