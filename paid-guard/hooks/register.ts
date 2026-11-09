// Holds paid tool calls to a spend policy: ones whose provider confirms a hard limit (key limit or prepaid balance) run, metered ones run under a monthly cap, the rest ask.
import type { EngineInterface, Register } from 'claude-code'

type Spend = { key: string; what: string }

const AWS_VERB = /^(create|delete|put|update|modify|run|terminate|start|stop|reboot|attach|detach|associate|deploy|register|deregister|import|restore|copy|purchase|invoke|rm|mv|cp|sync|mb|rb)\b/
// Flags may sit before the service or the verb (aws --profile p ec2 --region r run-instances). Skip dash tokens; each
// flag without = may have eaten a word as its value, so widen the window by one per flag. Token scan, no backtracking.
// Common flags that take no value, so they do not widen the window.
const AWS_BARE = /^--(recursive|debug|dryrun|dry-run|quiet|force|no-[\w-]+|only-show-errors|human-readable|summarize)$/
const AWS_CHANGE = {
  test: (s: string) => [...s.matchAll(/\baws\s+([^|;&\n"]*)/g)].some(m => {
    const tokens = m[1].split(/\s+/).filter(Boolean)
    const valued = tokens.filter(t => t.startsWith('-') && !t.includes('=') && !AWS_BARE.test(t)).length
    const words = tokens.filter(t => !t.startsWith('-')).slice(0, 2 + valued)
    return words.slice(1).some(w => AWS_VERB.test(w))
  }),
}
const AWS_SPEND: Spend = { key: 'aws', what: 'an AWS change (may cost money)' }

const BASH: { test: { test(s: string): boolean }; spend: Spend }[] = [
  { test: /\bbland\s+(call|sms|batch)\s+(send|create)\b|api\.bland\.ai/, spend: { key: 'bland', what: 'a Bland call or text (Bland credit)' } },
  { test: /openrouter\.ai\/api/, spend: { key: 'openrouter', what: 'an OpenRouter request (OpenRouter credit)' } },
  // Jev runs that call OpenRouter (status makes one tiny call, left out).
  { test: /\bjev\.py\s+(ask|route|match|gate|tune|bench)\b/, spend: { key: 'openrouter', what: 'a Jev run (OpenRouter credit)' } },
  { test: /thenewblack\.ai|\/api\/closet\/virtualtryon/, spend: { key: 'newblack', what: 'a NewBlack try-on render (render credit)' } },
  { test: /\/api\/fitoftheday\/(preview|generate)/, spend: { key: 'fit', what: 'a fit of the day render or generation (Gemini, shop searches, render credit)' } },
  { test: /\/api\/shop\/(search|image-search|brands|product)/, spend: { key: 'shop', what: 'a paid Channel3 shop search' } },
  { test: /generativelanguage\.googleapis\.com/, spend: { key: 'gemini', what: 'a Gemini request' } },
  { test: /upload_to_stitch|stitch\.googleapis\.com/, spend: { key: 'stitch', what: 'a Stitch upload (sends project HTML and screens to Google, uses your Stitch API key)' } },
  { test: AWS_CHANGE, spend: AWS_SPEND },
]

const MCP: { test: RegExp; spend: Spend }[] = [
  { test: /^mcp__openrouter__(generate-image|generate-speech|send-message|send-batch|transcribe-audio|spawn-ori-eval)$/, spend: { key: 'openrouter', what: 'an OpenRouter generation (OpenRouter credit)' } },
  { test: /^mcp__perplexity__perplexity_(search|ask|research|reason)$/, spend: { key: 'perplexity', what: 'a Perplexity search (Perplexity API credit)' } },
  { test: /^mcp__plugin_bland_bland__(create_call|send_call|send_sms|send_sms_batch|create_batch|create_sms_conversation|send_sms_conversation_message|buy_credits|buy_phone_plan|purchase_phone_number|run_test_scenario|batch_run_test_scenarios|create_eval_run|start_agent_check_run|create_disposition_test_run|start_tornado_session|create_translation_session)$/, spend: { key: 'bland', what: 'a Bland call, text or purchase (Bland credit)' } },
]

export const spendOf = (tool: string, input: Record<string, unknown>): Spend | undefined => {
  if (tool === 'Bash') return typeof input.command === 'string' ? BASH.find(r => r.test.test(input.command as string))?.spend : undefined
  // aws-core's server runs CLI commands passed in its input (call_aws).
  if (tool.startsWith('mcp__plugin_aws-core_aws-mcp__')) return AWS_CHANGE.test(JSON.stringify(input)) ? AWS_SPEND : undefined
  return MCP.find(r => r.test.test(tool))?.spend
}

const ONCE = 'Allow once'
const SESSION = 'Allow for this session'

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Tells the Switchboard window for this folder what was asked and the answer; silent when there is none. */
async function report($: EngineInterface, action: 'asked' | 'allowed' | 'refused', detail: string) {
  const home = norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  const dir = `${home}/.claude/switchboard`
  const cwd = norm(await $.session.cwd())
  let best: { port: number; token: string; workspace: string } | undefined
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'workspaces.json') continue
    try {
      const f = JSON.parse(String(await $.fs.read(`${dir}/${e.name}`)))
      const w = typeof f.workspace === 'string' ? norm(f.workspace) : ''
      if (typeof f.port !== 'number' || typeof f.hubToken !== 'string' || !w || (cwd !== w && !cwd.startsWith(`${w}/`))) continue
      if (!best || w.length > best.workspace.length) best = { port: f.port, token: f.hubToken, workspace: w }
    } catch { /* a file mid-write */ }
  }
  if (!best) return
  await $.http.fetch(`http://127.0.0.1:${best.port}/hub`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: best.token, kind: 'guard', mod: 'paid-guard', action, detail, sessionId: await $.session.id() }),
  }).catch(() => undefined)
}

export type Mode = 'provider' | 'cap' | 'ask'
export type Rule = { mode: Mode; monthlyUsd?: number }
// Defaults; ~/.claude/switchboard/spend-policy.json overrides per key (Switchboard's Spend limits writes it).
export const DEFAULTS: Record<string, Rule> = {
  openrouter: { mode: 'provider' }, bland: { mode: 'provider' }, perplexity: { mode: 'provider' },
  newblack: { mode: 'provider' }, fit: { mode: 'provider' }, shop: { mode: 'provider' },
  gemini: { mode: 'cap', monthlyUsd: 5 },
  aws: { mode: 'ask' }, stitch: { mode: 'ask' },
}
// Per call guess in USD, high on purpose: a Gemini call with an image or long context runs a few cents, so 5c each.
const ESTIMATE: Record<string, number> = { gemini: 0.05 }
const FLOOR = 1

type SpendFile = { month: string; keys: Record<string, { calls: number; usd: number }> }
const month = () => new Date().toISOString().slice(0, 7)

async function readJson($: EngineInterface, path: string) {
  try { return JSON.parse(String(await $.fs.read(path))) as unknown } catch { return undefined }
}
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function ruleOf(policy: unknown, key: string): Rule {
  const r = isObj(policy) ? policy[key] : undefined
  const base = DEFAULTS[key] ?? { mode: 'ask' }
  if (!isObj(r) || !['provider', 'cap', 'ask'].includes(r.mode)) return base
  return { mode: r.mode, monthlyUsd: typeof r.monthlyUsd === 'number' && r.monthlyUsd >= 0 ? r.monthlyUsd : base.monthlyUsd ?? 5 }
}

const thisMonth = (f: unknown): SpendFile => (isObj(f) && f.month === month() && isObj(f.keys) ? f as SpendFile : { month: month(), keys: {} })

// ponytail: read then write, so two chats spending at the same instant can drop one count; a lock if that ever matters.
async function record($: EngineInterface, dir: string, key: string) {
  const f = thisMonth(await readJson($, `${dir}/spend.json`))
  const k = f.keys[key] ?? { calls: 0, usd: 0 }
  f.keys[key] = { calls: k.calls + 1, usd: Math.round((k.usd + (ESTIMATE[key] ?? 0)) * 100) / 100 }
  await $.fs.write(`${dir}/spend.json`, JSON.stringify(f))
}

// Key where Switchboard saved it (Keychain, or keys/<NAME>). Never logged.
async function secret($: EngineInterface, dir: string, name: string) {
  const r = await $.process.run(['security', 'find-generic-password', '-s', 'switchboard', '-a', name, '-w'], { timeoutMs: 5000 }).catch(() => undefined)
  if (r?.exitCode === 0 && r.stdout.trim()) return r.stdout.trim()
  const f = await $.fs.read(`${dir}/keys/${name}`).then(String, () => '')
  return f.trim() || undefined
}

type Cap = { capped: true; left?: number } | { capped: false; why: string }

// Live checks of a hard limit set on the provider's own site. Providers missing here expose no cap over their API.
type Check = { url: string; read: (j: any) => Cap }
// `next`: asked only when the first check confirms no cap.
const CHECKS: Record<string, Check & { env: string; auth: (key: string) => Record<string, string>; next?: Check }> = {
  openrouter: {
    env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/key', auth: k => ({ Authorization: `Bearer ${k}` }),
    read: j => typeof j?.data?.limit !== 'number' || typeof j.data.limit_remaining !== 'number'
      ? { capped: false, why: 'this OpenRouter key has no credit limit set on openrouter.ai' }
      : { capped: true, left: j.data.limit_remaining },
    // Prepaid account credit is a hard limit too (Kenneth's rule).
    next: {
      url: 'https://openrouter.ai/api/v1/credits',
      read: j => {
        const left = j?.data?.total_credits - j?.data?.total_usage
        return Number.isFinite(left) && left > 0 ? { capped: true, left }
          : { capped: false, why: 'this OpenRouter key has no credit limit set on openrouter.ai and the account shows no prepaid credit left' }
      },
    },
  },
  bland: {
    env: 'BLAND_API_KEY', url: 'https://api.bland.ai/v1/me', auth: k => ({ authorization: k }),
    read: j => typeof j?.billing?.current_balance !== 'number' ? { capped: false, why: 'Bland did not report a prepaid balance' }
      : j.billing.refill_to != null ? { capped: false, why: 'Bland auto recharge is on, so the balance is no hard limit' }
      : { capped: true, left: j.billing.current_balance },
  },
}
const CAP_EVERY = 10 * 60_000
const CHECK_MS = 4000
const caps = new Map<string, { at: number; cap: Cap }>()

async function liveCap($: EngineInterface, dir: string, key: string): Promise<Cap> {
  const c = CHECKS[key]
  if (!c) return { capped: false, why: 'this provider has no API to confirm a spend limit' }
  const env = key === 'openrouter' ? await $.env.get('OPENROUTER_API_KEY') : await $.env.get('BLAND_API_KEY')
  const k = env || await secret($, dir, c.env)
  if (!k) return { capped: false, why: `no ${c.env} saved to check its limit` }
  const get = async ({ url, read }: Check): Promise<Cap> => {
    // $.http.fetch takes no timeout; a check that hangs past 4 s counts as no answer.
    const res = await Promise.race([
      $.http.fetch(url, { headers: c.auth(k) }),
      $.clock.sleep(CHECK_MS).then(() => undefined),
    ]).catch(() => undefined)
    if (!res?.ok) return { capped: false, why: `the ${key} limit check did not answer` }
    try { return read(JSON.parse(res.text)) } catch { return { capped: false, why: `the ${key} limit check answered oddly` } }
  }
  const cap = await get(c)
  return !cap.capped && c.next ? get(c.next) : cap
}

async function providerCap($: EngineInterface, dir: string, key: string): Promise<Cap> {
  const hit = caps.get(key)
  if (hit && Date.now() - hit.at < CAP_EVERY) return hit.cap
  const cap = await liveCap($, dir, key).catch(() => ({ capped: false as const, why: 'the limit check failed' }))
  caps.set(key, { at: Date.now(), cap })
  return cap
}

/** Why this call needs Kenneth, or undefined to let it run. `once`: a yes holds for the rest of the chat. */
async function needsAsk($: EngineInterface, dir: string, spend: Spend): Promise<{ why: string; once?: boolean } | undefined> {
  const rule = ruleOf(await readJson($, `${dir}/spend-policy.json`), spend.key)
  if (rule.mode === 'ask') return { why: `This call is ${spend.what}. Run it?` }
  if (rule.mode === 'cap') {
    const used = thisMonth(await readJson($, `${dir}/spend.json`)).keys[spend.key]?.usd ?? 0
    const cap = rule.monthlyUsd ?? 0
    if (used + (ESTIMATE[spend.key] ?? 0) > cap) return { why: `This call is ${spend.what}. It would pass this month's $${cap.toFixed(2)} cap ($${used.toFixed(2)} used so far). Run it?` }
    return undefined
  }
  if (noCapOk.has(spend.key)) return undefined
  const cap = await providerCap($, dir, spend.key)
  if (!cap.capped) return { why: `This call is ${spend.what}. No spend limit confirmed: ${cap.why}. Run it?`, once: true }
  if (cap.left !== undefined && cap.left < FLOOR) return { why: `This call is ${spend.what}. Only $${cap.left.toFixed(2)} of its limit is left. Run it?` }
}

// Providers with no confirmed cap that Kenneth already allowed in this chat.
const noCapOk = new Set<string>()
// Kinds allowed for the rest of the session; a reload asks again.
const allowed = new Set<string>()

async function decide($: EngineInterface, spend: Spend) {
  const home = norm((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '')
  const dir = `${home}/.claude/switchboard`
  const need = allowed.has(spend.key) ? undefined : await needsAsk($, dir, spend)
  if (!need) {
    await report($, 'allowed', `${spend.what} (auto)`).catch(() => undefined)
    await record($, dir, spend.key).catch(() => undefined)
    return true
  }
  await report($, 'asked', spend.what).catch(() => undefined)
  // No one to answer (unattended) reads as Deny.
  const answer = await $.ui.ask(need.why, [ONCE, SESSION, 'Deny']).catch(() => 'Deny')
  if (answer === SESSION) allowed.add(spend.key)
  const ok = answer === ONCE || answer === SESSION
  if (ok && need.once) noCapOk.add(spend.key)
  await report($, ok ? 'allowed' : 'refused', spend.what).catch(() => undefined)
  if (ok) await record($, dir, spend.key).catch(() => undefined)
  return ok
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const spend = spendOf(String(e.tool), e as unknown as Record<string, unknown>)
    if (!spend) return next(e)
    if (!(await decide($, spend))) return { deny: `paid-guard: Kenneth did not allow ${spend.what}.` }
    const out = await next(e)
    // Out of credit: check again on the next call instead of waiting out the 10 min.
    if (/\b402\b/.test(JSON.stringify(out))) caps.delete(spend.key)
    return out
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'paid-guard: the guard failed, so the call was held.' }))
}
