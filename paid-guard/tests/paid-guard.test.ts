import { expect, test } from 'claude-code/testing'

import { spendOf } from '../hooks/register.ts'

test('spots paid calls', () => {
  expect(spendOf('Bash', { command: 'bland call send --task x' })?.key).toBe('bland')
  expect(spendOf('Bash', { command: 'curl -s localhost:3000/api/shop/search?q=coat' })?.key).toBe('shop')
  expect(spendOf('Bash', { command: 'curl -X POST http://localhost:3000/api/closet/virtualtryon/newblack' })?.key).toBe('newblack')
  expect(spendOf('Bash', { command: 'aws ec2 terminate-instances --instance-ids i-1' })?.key).toBe('aws')
  expect(spendOf('Bash', { command: 'aws --profile p --region r ec2 terminate-instances' })?.key).toBe('aws')
  expect(spendOf('Bash', { command: 'aws ec2 --region us-east-1 run-instances' })?.key).toBe('aws')
  expect(spendOf('Bash', { command: 'aws s3 rm s3://b --recursive' })?.key).toBe('aws')
  expect(spendOf('mcp__openrouter__generate-image', {})?.key).toBe('openrouter')
  expect(spendOf('Bash', { command: 'python3 ~/.claude/skills/claude-x-jev/scripts/jev.py ask --preset p-route x' })?.key).toBe('openrouter')
  expect(spendOf('Bash', { command: 'python3 jev.py status' })).toBeUndefined()
  expect(spendOf('mcp__perplexity__perplexity_research', {})?.key).toBe('perplexity')
  expect(spendOf('mcp__plugin_bland_bland__send_sms', {})?.key).toBe('bland')
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___call_aws', { cli_command: 'aws rds delete-db-instance --db-instance-identifier armasu-beta' })?.key).toBe('aws')
  expect(spendOf('Bash', { command: 'python3 scripts/upload_to_stitch.py --project p site.html' })?.key).toBe('stitch')
  expect(spendOf('Bash', { command: 'curl -X POST https://stitch.googleapis.com/v1/projects' })?.key).toBe('stitch')
})

test('leaves free calls alone', () => {
  expect(spendOf('Bash', { command: 'aws ec2 describe-instances' })).toBeUndefined()
  expect(spendOf('Bash', { command: 'aws --profile prod s3 ls s3://b' })).toBeUndefined()
  expect(spendOf('Bash', { command: 'curl -s localhost:3000/api/closet' })).toBeUndefined()
  expect(spendOf('mcp__openrouter__list-models', {})).toBeUndefined()
  expect(spendOf('mcp__perplexity__perplexity_other', {})).toBeUndefined()
  expect(spendOf('Read', { file_path: '/x' })).toBeUndefined()
  expect(spendOf('Bash', { command: 'bash scripts/fetch-stitch.sh https://example.com/s.html out.html' })).toBeUndefined()
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___call_aws', { cli_command: 'aws rds describe-db-instances' })).toBeUndefined()
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___search_documentation', { search_phrase: 'create bucket' })).toBeUndefined()
})

test('a free call goes straight through', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(ran)).not.toMatch(/paid-guard/)
})

const HOME = '/h'
const SB = `${HOME}/.claude/switchboard`
const MONTH = new Date().toISOString().slice(0, 7)

// Stands for the engine: files in a map, every ask counted, no real network.
type Opts = { fetched?: string[]; env?: Record<string, string>; keychain?: Record<string, string>; body?: unknown; bodies?: Record<string, unknown> }
function engine(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, o: Opts = {}) {
  const asked: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : o.env?.[e.name] }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/p' }))
  on('session.id', () => ({ value: 's' }))
  // The 4 s limit check timer never fires here.
  on('clock.sleep', () => new Promise(() => {}))
  on('process.run', (_, e) => {
    const name = e.argv[e.argv.indexOf('-a') + 1]
    const v = o.keychain?.[name]
    return { value: { exitCode: v ? 0 : 44, stdout: v ? `${v}\n` : '', stderr: '' } }
  })
  on('http.fetch', (_, e) => {
    o.fetched?.push(`${e.url} ${JSON.stringify(e.init?.headers ?? {})}`)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(o.bodies?.[e.url] ?? o.body ?? {}) } }
  })
  // $.ui.ask is an AskUserQuestion call; no answer here, so the mod reads it as Deny.
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') { asked.push(JSON.stringify(e)); return { deny: 'no one here' } }
    return { result: {} }
  })
  return asked
}

test('a provider with no cap API asks, and unattended means deny', async ($, on) => {
  const asked = engine(on, {})
  const ran = await $.tool.call({ tool: 'mcp__perplexity__perplexity_search', query: 'x' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/No spend limit confirmed: this provider has no API/)
  expect(JSON.stringify(ran)).toMatch(/paid-guard: Kenneth did not allow/)
})

test('gemini runs under its cap and is counted, then asks once the cap is hit', async ($, on) => {
  const files: Record<string, string> = { [`${SB}/spend-policy.json`]: JSON.stringify({ gemini: { mode: 'cap', monthlyUsd: 0.1 } }) }
  const asked = engine(on, files)
  const cmd = { tool: 'Bash', command: 'curl https://generativelanguage.googleapis.com/v1/x' }
  await $.tool.call(cmd)
  expect(asked.length).toBe(0)
  expect(JSON.parse(files[`${SB}/spend.json`])).toEqual({ month: MONTH, keys: { gemini: { calls: 1, usd: 0.05 } } })
  await $.tool.call(cmd)
  expect(asked.length).toBe(0)
  const third = await $.tool.call(cmd)
  expect(asked.length).toBe(1)
  expect(JSON.stringify(third)).toMatch(/paid-guard/)
})

test('last month spend does not count', async ($, on) => {
  const files: Record<string, string> = {
    [`${SB}/spend-policy.json`]: JSON.stringify({ gemini: { mode: 'cap', monthlyUsd: 1 } }),
    [`${SB}/spend.json`]: JSON.stringify({ month: '2000-01', keys: { gemini: { calls: 99, usd: 99 } } }),
  }
  const asked = engine(on, files)
  await $.tool.call({ tool: 'Bash', command: 'curl https://generativelanguage.googleapis.com/v1/x' })
  expect(asked.length).toBe(0)
  expect(JSON.parse(files[`${SB}/spend.json`]).keys.gemini.calls).toBe(1)
})

test('aws always asks', async ($, on) => {
  const asked = engine(on, {})
  await $.tool.call({ tool: 'Bash', command: 'aws ec2 terminate-instances --instance-ids i-1' })
  expect(asked.length).toBe(1)
})

test('openrouter with a limit on the key runs, checked at most every 10 min', async ($, on) => {
  const fetched: string[] = []
  const asked = engine(on, {}, { fetched, env: { OPENROUTER_API_KEY: 'sk-test' }, body: { data: { limit: 20, limit_remaining: 12.5 } } })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(fetched).toEqual(['https://openrouter.ai/api/v1/key {"Authorization":"Bearer sk-test"}'])
  expect(asked.length).toBe(0)
})

test('openrouter asks when the limit is nearly spent', async ($, on) => {
  const asked = engine(on, {}, { env: { OPENROUTER_API_KEY: 'sk-test' }, body: { data: { limit: 10, limit_remaining: 0.5 } } })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/\$0\.50 of its limit is left/)
})

test('openrouter key with no limit set asks and names why, without the key', async ($, on) => {
  const asked = engine(on, {}, { keychain: { OPENROUTER_API_KEY: 'sk-secret-from-keychain' }, body: { data: { limit: null, limit_remaining: null } } })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/no credit limit set on openrouter\.ai/)
  expect(asked[0]).not.toMatch(/sk-secret/)
})

const KEY = 'https://openrouter.ai/api/v1/key'
const CREDITS = 'https://openrouter.ai/api/v1/credits'

test('openrouter key with no limit runs on prepaid account credit', async ($, on) => {
  const fetched: string[] = []
  const asked = engine(on, {}, { fetched, env: { OPENROUTER_API_KEY: 'sk-test' }, bodies: {
    [KEY]: { data: { limit: null, limit_remaining: null } },
    [CREDITS]: { data: { total_credits: 25, total_usage: 3.75 } },
  } })
  await $.tool.call({ tool: 'Bash', command: 'python3 jev.py ask --preset p-route x' })
  expect(asked.length).toBe(0)
  expect(fetched.map(f => f.split(' ')[0])).toEqual([KEY, CREDITS])
})

test('openrouter key with no limit and spent credit asks', async ($, on) => {
  const asked = engine(on, {}, { env: { OPENROUTER_API_KEY: 'sk-test' }, bodies: {
    [KEY]: { data: { limit: null, limit_remaining: null } },
    [CREDITS]: { data: { total_credits: 10, total_usage: 10 } },
  } })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/no prepaid credit left/)
})

test('openrouter prepaid credit nearly gone asks', async ($, on) => {
  const asked = engine(on, {}, { env: { OPENROUTER_API_KEY: 'sk-test' }, bodies: {
    [KEY]: { data: { limit: null, limit_remaining: null } },
    [CREDITS]: { data: { total_credits: 10, total_usage: 9.6 } },
  } })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/\$0\.40 of its limit is left/)
})

test('no key saved anywhere means no cap confirmed', async ($, on) => {
  const fetched: string[] = []
  const asked = engine(on, {}, { fetched })
  await $.tool.call({ tool: 'mcp__openrouter__send-message' })
  expect(fetched.length).toBe(0)
  expect(asked[0]).toMatch(/no OPENROUTER_API_KEY saved/)
})

test('bland prepaid balance with no auto recharge runs', async ($, on) => {
  const asked = engine(on, {}, { env: { BLAND_API_KEY: 'org_test' }, body: { billing: { current_balance: 30 } } })
  await $.tool.call({ tool: 'mcp__plugin_bland_bland__send_sms' })
  expect(asked.length).toBe(0)
})

test('bland with auto recharge on asks', async ($, on) => {
  const asked = engine(on, {}, { env: { BLAND_API_KEY: 'org_test' }, body: { billing: { current_balance: 30, refill_to: 50 } } })
  await $.tool.call({ tool: 'mcp__plugin_bland_bland__send_sms' })
  expect(asked[0]).toMatch(/auto recharge is on/)
})

test('a limit check that never answers times out and asks', async ($, on) => {
  const asked: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'BLAND_API_KEY' ? 'org_test' : undefined }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('session.cwd', () => ({ value: '/p' }))
  on('session.id', () => ({ value: 's' }))
  on('clock.sleep', () => ({ value: undefined }))
  on('http.fetch', () => new Promise(() => {}))
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') { asked.push(JSON.stringify(e)); return { deny: 'no one here' } }
    return { result: {} }
  })
  const ran = await $.tool.call({ tool: 'mcp__plugin_bland_bland__send_call' })
  expect(asked.length).toBe(1)
  expect(asked[0]).toMatch(/bland limit check did not answer/)
  expect(JSON.stringify(ran)).toMatch(/paid-guard: Kenneth did not allow/)
})
