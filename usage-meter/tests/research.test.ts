import { expect, test } from 'claude-code/testing'

import { researchScore, RESEARCH_AT } from '../hooks/research.ts'

const yes = [
  'look up how other tools pick a model per task',
  'compare RouteLLM with FrugalGPT',
  'what is the best way to keep a prompt cache warm',
  'how does Cursor Auto route requests, with sources',
  'research model routing papers and give me the docs links',
  'what is the difference between xhigh and max effort',
  'compare the docs of two terminal libraries and look up their licenses',
  'how does tailscale serve work, cite sources',
  'do some research on onboarding flows for developer tools',
  'look up what the latest docs say about agent hooks',
]
const no = [
  'fix the typo in web/components/switchboard/gear.tsx',
  'build the new settings page',
  'refactor extension/src/hub/picker.ts to drop the old table',
  'add a --model flag to newChatCommand',
  'rename hubState to hub in routes.ts',
  'implement the scorer and add tests',
  'bump the version and update the CHANGELOG',
  'fix the bug where the meter shows 0% after reload',
  'compare the two diffs in extension/src/hub/actions.ts and fix the merge',
  'add the docs link to README.md',
  // Real misfires: "research" names a Switchboard part, "what is going on" is no question.
  'Research component is a bit weird make sure there is a tracker directly on switchboard making it easier to run use and also understand what is going on and if item is researching for another chat make sure that is understood',
  'Last thing is research component should open a new tab within vs code that is just research itself to show the information',
  'the research panel looks off, what is wrong with it',
]

test('scores research asks high and edit asks low', () => {
  for (const t of yes) expect({ t, ok: researchScore(t).score >= RESEARCH_AT }).toEqual({ t, ok: true })
  for (const t of no) expect({ t, ok: researchScore(t).score >= RESEARCH_AT }).toEqual({ t, ok: false })
})

test('names the words that matched', () => {
  const r = researchScore('look up the docs and compare them')
  expect(r.reason).toBe('look up, compare, docs')
  expect(researchScore('fix it').reason).toBe('')
})
