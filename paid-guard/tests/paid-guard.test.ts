import { expect, test } from 'claude-code/testing'

import { spendOf } from '../hooks/register.ts'

test('spots paid calls', () => {
  expect(spendOf('Bash', { command: 'bland call send --task x' })?.key).toBe('bland')
  expect(spendOf('Bash', { command: 'curl -s localhost:3000/api/shop/search?q=coat' })?.key).toBe('shop')
  expect(spendOf('Bash', { command: 'curl -X POST http://localhost:3000/api/closet/virtualtryon/newblack' })?.key).toBe('newblack')
  expect(spendOf('Bash', { command: 'aws ec2 terminate-instances --instance-ids i-1' })?.key).toBe('aws')
  expect(spendOf('mcp__openrouter__generate-image', {})?.key).toBe('openrouter')
  expect(spendOf('mcp__plugin_bland_bland__send_sms', {})?.key).toBe('bland')
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___call_aws', { cli_command: 'aws rds delete-db-instance --db-instance-identifier armasu-beta' })?.key).toBe('aws')
})

test('leaves free calls alone', () => {
  expect(spendOf('Bash', { command: 'aws ec2 describe-instances' })).toBeUndefined()
  expect(spendOf('Bash', { command: 'curl -s localhost:3000/api/closet' })).toBeUndefined()
  expect(spendOf('mcp__openrouter__list-models', {})).toBeUndefined()
  expect(spendOf('Read', { file_path: '/x' })).toBeUndefined()
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___call_aws', { cli_command: 'aws rds describe-db-instances' })).toBeUndefined()
  expect(spendOf('mcp__plugin_aws-core_aws-mcp__aws___search_documentation', { search_phrase: 'create bucket' })).toBeUndefined()
})

test('a free call goes straight through', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(ran)).not.toMatch(/paid-guard/)
})
