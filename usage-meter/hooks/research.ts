import type { EngineInterface } from 'claude-code'
import { askHome } from './feed'
import { cwdOf, homeDir } from './hub'

// Research detect: a local word score on the first prompt of a chat, then one offer to the hub.
export const RESEARCH_AT = 2
const WORDS: [string, RegExp][] = [
  ['look up', /\blook(ing)? up\b/i],
  ['compare', /\bcompar(e|es|ing|ison)\b/i],
  ['what is', /\bwhat (is|are)\b(?! (going on|happening|wrong|broken))/i],
  ['how does', /\bhow (does|do)\b/i],
  ['sources', /\b(sources?|cite|citations?)\b/i],
  ['docs', /\bdocs\b|\bdocumentation\b/i],
  // "research component" and the like name a Switchboard part, not a research ask.
  ['research', /\bresearch(?!\s+(?:component|panel|tab|window|mode|tracker|offer|folder|chat|space|page|view|button|feature|card|section|screen)s?\b)\w*|\bpapers?\b/i],
]
const FILE = /(?:[\w.-]+\/)+[\w.*-]+\.\w+|\b[\w-]+\.(?:tsx?|m?js|json|md|py|css|swift|go|rs)\b/g
const EDIT = /\b(fix|build|refactor|add|implement|rename|bump|rewrite|change|update|delete|remove|make|open|show)\b/gi
/** +2 per matched word, -2 per file path and per distinct edit verb. */
export function researchScore(text: string) {
  const hits = WORDS.filter(([, r]) => r.test(text)).map(([w]) => w)
  const files = new Set(text.match(FILE) ?? []).size
  const edits = new Set((text.match(EDIT) ?? []).map(s => s.toLowerCase())).size
  return { score: 2 * hits.length - 2 * files - 2 * edits, reason: hits.join(', ') }
}
/** Tells the home window this chat reads like research; nothing inside ~/Documents/Research. */
export async function offerResearch($: EngineInterface, text: string) {
  const { score, reason } = researchScore(text)
  if (score < RESEARCH_AT) return
  const root = `${await homeDir($)}/Documents/Research`
  const cwd = await cwdOf($)
  if (cwd === root || cwd.startsWith(`${root}/`)) return
  await askHome($, 'research-offer', JSON.stringify({ sessionId: await $.session.id(), score, reason }))
}
