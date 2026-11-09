// Phone mode: with Switchboard's Phone toggle on, AskUserQuestion is denied and the chat calls Kenneth instead.
// The hub mirrors the toggle into ~/.claude/switchboard/limits.json as phone: true.
import type { EngineInterface, Register } from 'claude-code'

type Question = { question?: unknown; options?: Array<{ label?: unknown; preview?: unknown }> }

const CALL = 'python3 ~/.claude/skills/phone/call.py'
const READ_MS = 5_000
const cache = { at: -Infinity, on: false }

async function phoneOn($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  if (now - cache.at < READ_MS) return cache.on
  cache.at = now
  const home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/\\/g, '/')
  try { cache.on = JSON.parse(String(await $.fs.read(`${home}/.claude/switchboard/limits.json`))).phone === true } catch { cache.on = false }
  return cache.on
}

const sh = (s: string) => `"${s.replace(/["\\$`]/g, '\\$&')}"`

/** The deny text: push pictures, one call per question with the options by name, carry on with the answer. */
export function denial(input: { questions?: unknown }): string {
  const qs = (Array.isArray(input.questions) ? input.questions : []) as Question[]
  const pictures = qs.some(q => q.options?.some(o => typeof o.preview === 'string' && o.preview))
  const lines = qs.map(q => {
    const names = (q.options ?? []).map(o => String(o.label ?? '')).filter(Boolean)
    return `${CALL} ${sh(`${String(q.question ?? '')}${names.length ? ` Options: ${names.join(', ')}.` : ''}`)} "CONTEXT"`
  })
  return [
    'Phone mode is on: Kenneth is away from the keyboard, so call him instead of asking here.',
    `1. Pictures first${pictures ? ' (this question has previews)' : ''}: push any screenshots or previews to his phone with SendUserFile (status proactive) or PushNotification, plus the comparison page link if there is one. Then the question should say "look at A and B on your phone".`,
    '2. Run one call per question, saying the options by name, with one or two sentences of CONTEXT:',
    ...lines.map(l => `   ${l}`),
    '3. Read the ANSWER line and carry on with it. Do not re-ask in chat.',
    'On exit 2 (no answer) do not redial: leave the question on screen as text and pick the safer default, or stop if there is none. On exit 1, ask here as usual.',
  ].join('\n')
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'AskUserQuestion' || !(await phoneOn($))) return next(e)
    return { deny: denial(e as { questions?: unknown }) }
  })
}
