import { expect, test } from 'claude-code/testing'

import { parseLsof } from '../hooks/register.tsx'

test('keeps dev servers, drops the rest, one row per port', () => {
  const out = ['p29313', 'cnode', 'n*:3000', 'p11546', 'cnode', 'n127.0.0.1:4251', 'p24970', 'cDiscord', 'n127.0.0.1:6463', 'p2635', 'cPython', 'n127.0.0.1:4211', 'n[::1]:4211'].join('\n')
  expect(parseLsof(out)).toEqual([
    { pid: 29313, command: 'node', port: 3000 },
    { pid: 2635, command: 'Python', port: 4211 },
    { pid: 11546, command: 'node', port: 4251 },
  ])
})
