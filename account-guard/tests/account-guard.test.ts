import { expect, test } from 'claude-code/testing'

import { clisOf, decide, foldersOf, signedOut, type Data } from '../hooks/register.ts'

const H = '/Users/me'
const G = `${H}/Documents/GitHub`
const D: Data = {
  projects: { [`${G}/Armasu`]: 'Armasu', [`${G}/Armasu/infra`]: 'ArmasuInfra' },
  links: { [`${G}/Armasu`]: { auth0: 'a1' }, [`${G}/Switchboard`]: { auth0: null }, [`${G}/Tenant`]: { auth0: 'a3' }, [`${G}/Side`]: { auth0: 'a4' } },
  apps: [{ id: 'auth0', name: 'Auth0', url: 'https://auth0.com', logins: [
    { id: 'a1', label: 'Armasu tenant', url: 'https://manage.auth0.com/x' }, { id: 'a2', label: 'Side', url: 'https://s' },
    { id: 'a3', label: 'Armasu', url: 'https://manage.auth0.com/dashboard', domain: 'armasu.us.auth0.com' },
    { id: 'a4', label: 'Side EU', url: 'https://side.eu.auth0.com/' },
  ] }],
  profiles: ['Armasu', 'ArmasuInfra', 'Other'],
}
const ROOT = '/mods/account-guard'
const run = (cmd: string, cwd: string) => decide(cmd, cwd, H, D, ROOT)

test('finds CLIs at command positions only', () => {
  const ids = ['auth0', 'vercel']
  expect(clisOf('aws s3 ls', ids)).toEqual(['aws'])
  expect(clisOf('cd x && AWS_REGION=us-east-1 aws sts get-caller-identity | jq .', ids)).toEqual(['aws'])
  expect(clisOf('echo $(aws sts get-caller-identity); auth0 apps list', ids)).toEqual(['aws', 'auth0'])
  expect(clisOf('/usr/local/bin/aws s3 ls', ids)).toEqual(['aws'])
  expect(clisOf('echo "run aws s3 ls"; git commit -m \'auth0 fix\'', ids)).toEqual([])
  expect(clisOf('grep aws README.md', ids)).toEqual([])
  expect(clisOf('ls ~/.aws; awsume x', ids)).toEqual([])
  expect(clisOf('npm test', ids)).toEqual([])
  expect(clisOf("cat > notes.md <<'EOF'\naws s3 ls\nauth0 x\nEOF\nls", ids)).toEqual([])
  expect(clisOf('cat <<-EOF > x\n\taws s3 ls\n\tEOF\naws sts get-caller-identity', ids)).toEqual(['aws'])
  expect(clisOf('if aws s3 ls; then echo ok; fi', ids)).toEqual(['aws'])
  expect(clisOf('{ aws s3 ls; }', ids)).toEqual(['aws'])
  expect(clisOf(`echo "it's" && aws s3 ls 'x'`, ids)).toEqual(['aws'])
  expect(clisOf('env -i aws s3 ls', ids)).toEqual(['aws'])
  expect(clisOf('sudo -u x aws s3 ls', ids)).toEqual(['aws'])
  expect(clisOf('env -u HOME FOO=1 vercel ls', ids)).toEqual(['vercel'])
})

test('Windows absolute paths stay absolute and split the right project', () => {
  const folders = foldersOf('cd C:\\Users\\me\\Documents\\GitHub\\Armasu && aws s3 ls', 'C:\\Users\\me', 'C:\\Users\\me')
  expect(folders).toContain('C:/Users/me/Documents/GitHub/Armasu')
})

test('finds CLIs inside shell -c strings, eval and run-wrappers', () => {
  const ids = ['auth0']
  expect(clisOf('bash -c "aws s3 ls"', ids)).toEqual(['aws'])
  expect(clisOf("sh -c 'cd /u/GitHub/B && aws sts get-caller-identity'", ids)).toEqual(['aws'])
  expect(clisOf('zsh -lc "auth0 apps list"', ids)).toEqual(['auth0'])
  expect(clisOf('/bin/bash -e -c "echo \\"x\\"; aws s3 ls"', ids)).toEqual(['aws'])
  expect(clisOf('eval "aws s3 ls"', ids)).toEqual(['aws'])
  expect(clisOf('bash -c "sh -c \'aws s3 ls\'"', ids)).toEqual(['aws'])
  expect(clisOf('ls | xargs -n1 aws s3 rm', ids)).toEqual(['aws'])
  expect(clisOf('nohup aws s3 sync . s3://b &', ids)).toEqual(['aws'])
  expect(clisOf('time aws s3 ls', ids)).toEqual(['aws'])
  expect(clisOf('builtin command aws s3 ls', ids)).toEqual(['aws'])
  // Still no false positives.
  expect(clisOf('echo "aws s3 ls"', ids)).toEqual([])
  expect(clisOf('grep -rn aws .', ids)).toEqual([])
  expect(clisOf('git commit -m "auth0"', ids)).toEqual([])
  expect(clisOf('bash -c "echo aws"', ids)).toEqual([])
})

test('quoted mentions of sh -c or eval, and scripts named *.sh, are not opened', () => {
  for (const c of [
    `git commit -m "run bash -c 'aws s3 ls' to test"`,
    `echo "try: eval 'aws s3 ls'"`,
    './deploy.sh -c "aws configure list"',
  ]) expect(run(c, `${G}/Switchboard`) ?? 'untouched').toBe('untouched')
})

test('xargs flags that take a value do not hide the CLI', () => {
  for (const c of ['ls | xargs -I {} aws s3 cp {} s3://b/', 'ls | xargs -n 1 aws s3 rm', 'ls | xargs -P 4 aws s3 rm']) {
    expect((run(c, `${G}/Switchboard`) as { deny?: string } | undefined)?.deny ?? `allowed: ${c}`).toMatch(/no AWS profile/)
  }
})

test('cd targets inside a shell -c string count', () => {
  expect(foldersOf("sh -c 'cd /u/GitHub/B && aws sts get-caller-identity'", '/tmp', H)).toEqual(['/tmp', '/u/GitHub/B'])
  expect((run(`bash -c "cd ${G}/Armasu && aws s3 ls"`, `${G}/Switchboard`) as { command: string }).command).toMatch(/^export AWS_PROFILE=Armasu; bash -c/)
})

test('folders are cwd, cd targets and absolute paths', () => {
  expect(foldersOf(`cd ../Armasu && aws s3 ls`, `${G}/Switchboard`, H)).toEqual([`${G}/Switchboard`, `${G}/Armasu`])
  expect(foldersOf(`cd "/u/GitHub/My Proj" && aws s3 ls`, '/tmp', H)).toEqual(['/tmp', '/u/GitHub/My Proj'])
  expect(foldersOf(`aws s3 cp '/u/a b/x.json' s3://b`, '/tmp', H)).toEqual(['/tmp', '/u/a b/x.json'])
  expect(foldersOf(`aws s3 cp ~/Documents/GitHub/Armasu/x.json s3://b`, '/tmp', H)).toEqual(['/tmp', `${G}/Armasu/x.json`])
})

test('no CLI does nothing', () => {
  expect(run('ls -la', `${G}/Switchboard`)).toBeUndefined()
})

test('one aws pick rewrites the command with that profile', () => {
  const r = run('aws s3 ls', `${G}/Armasu/web`) as { command: string; context: string[] }
  expect(r.command).toBe('export AWS_PROFILE=Armasu; aws s3 ls')
  expect(r.context.join()).toMatch(/Armasu.*picked for .*GitHub\/Armasu/)
})

test('deepest pick wins and folder case does not matter', () => {
  expect((run('aws s3 ls', `${G}/armasu/infra/x`) as { command: string }).command).toMatch(/^export AWS_PROFILE=ArmasuInfra; /)
})

test('working from another workspace still finds the pick', () => {
  expect((run(`cd ${G}/Armasu && aws s3 ls`, `${G}/Switchboard`) as { command: string }).command).toMatch(/AWS_PROFILE=Armasu;/)
})

test('two different picks ask which', () => {
  const r = run(`aws s3 ls; cd ${G}/Armasu/infra && aws s3 ls`, `${G}/Armasu`) as { deny: string }
  expect(r.deny).toMatch(/Armasu.*ArmasuInfra/)
})

test('an explicit profile passes untouched', () => {
  expect(run('aws --profile Other s3 ls', `${G}/Switchboard`)).toBeUndefined()
  expect(run('AWS_PROFILE=Other aws s3 ls', `${G}/Armasu`)).toBeUndefined()
})

test('no aws pick asks Kenneth and says how to save it', () => {
  const r = run('aws s3 ls', `${G}/Switchboard`) as { deny: string }
  expect(r.deny).toMatch(/AskUserQuestion/)
  expect(r.deny).toMatch(/mcp__switchboard__ask/)
  expect(r.deny).toMatch(/Armasu, ArmasuInfra, Other/)
  expect(r.deny).toContain(`node ${ROOT}/bin/pick.mjs aws <profile> ${G}/Switchboard`)
  // The suggested folder is the repo top the hook found, not the raw cwd.
  const top = decide('aws s3 ls', `${G}/Switchboard/web/lib`, H, D, ROOT, `${G}/Switchboard`) as { deny: string }
  expect(top.deny).toContain(`pick.mjs aws <profile> ${G}/Switchboard\``)
})

test('web app CLI with a pick runs and names the login', () => {
  const r = run('auth0 apps list', `${G}/Armasu`) as { command?: string; context: string[] }
  expect(r.command).toBeUndefined()
  expect(r.context.join()).toMatch(/Armasu tenant.*manage\.auth0\.com/)
})

test('auth0 gets --tenant from the picked login domain, after its subcommand words', () => {
  const r = run('auth0 apps list --json', `${G}/Tenant`) as { command: string; context: string[] }
  expect(r.command).toBe('auth0 apps list --tenant armasu.us.auth0.com --json')
  expect(r.context.join()).toMatch(/--tenant armasu\.us\.auth0\.com/)
  expect((run('cd x && auth0 users search -q y', `${G}/Tenant`) as { command: string }).command)
    .toBe('cd x && auth0 users search --tenant armasu.us.auth0.com -q y')
  expect((run('auth0 apps list | jq .; auth0 users show abc1', `${G}/Tenant`) as { command: string }).command)
    .toBe('auth0 apps list --tenant armasu.us.auth0.com | jq .; auth0 users show --tenant armasu.us.auth0.com abc1')
})

test('auth0 inside shell -c and eval strings gets --tenant inside the string', () => {
  const T = 'armasu.us.auth0.com'
  const cmd = (c: string) => (run(c, `${G}/Tenant`) as { command?: string }).command
  expect(cmd('bash -c "auth0 apps list --json"')).toBe(`bash -c "auth0 apps list --tenant ${T} --json"`)
  expect(cmd("sh -c 'cd /u/GitHub/B && auth0 users search -q y'")).toBe(`sh -c 'cd /u/GitHub/B && auth0 users search --tenant ${T} -q y'`)
  expect(cmd(`bash -c "sh -c 'auth0 apps list'"`)).toBe(`bash -c "sh -c 'auth0 apps list --tenant ${T}'"`)
  expect(cmd(`eval 'auth0 apps list'; auth0 users list`)).toBe(`eval 'auth0 apps list --tenant ${T}'; auth0 users list --tenant ${T}`)
  // An explicit --tenant holds for its own call only.
  expect(cmd('bash -c "auth0 apps list --tenant x.auth0.com"')).toBeUndefined()
  expect(cmd('auth0 apps list --tenant x.auth0.com; auth0 users list')).toBe(`auth0 apps list --tenant x.auth0.com; auth0 users list --tenant ${T}`)
})

test('$(...) and backticks inside double quotes are commands; single quotes stay data', () => {
  const T = 'armasu.us.auth0.com'
  expect(clisOf('echo "$(auth0 apps list)"', ['auth0'])).toEqual(['auth0'])
  expect(clisOf('echo "x `aws s3 ls`"', [])).toEqual(['aws'])
  expect(clisOf(`echo '$(aws s3 ls)' '\`auth0 x\`'`, ['auth0'])).toEqual([])
  expect(clisOf('echo "$(echo "aws s3 ls")"', [])).toEqual([])
  const cmd = (c: string) => (run(c, `${G}/Tenant`) as { command?: string }).command
  expect(cmd('echo "$(auth0 apps list)"')).toBe(`echo "$(auth0 apps list --tenant ${T})"`)
  expect(cmd('echo "`auth0 apps list`"')).toBe(`echo "\`auth0 apps list --tenant ${T}\`"`)
  expect((run('echo "$(aws s3 ls)"', `${G}/Switchboard`) as { deny?: string }).deny).toMatch(/no AWS profile/)
})

test('auth0 tenant falls back to a url host on auth0.com, never manage.auth0.com', () => {
  expect((run('auth0 apps list', `${G}/Side`) as { command: string }).command).toBe('auth0 apps list --tenant side.eu.auth0.com')
  expect((run('auth0 apps list', `${G}/Armasu`) as { command?: string }).command).toBeUndefined()
})

test('auth0 with an explicit --tenant passes untouched, and aws still gets its prefix', () => {
  expect((run('auth0 apps list --tenant other.auth0.com', `${G}/Tenant`) as { command?: string }).command).toBeUndefined()
  const both = { ...D, projects: { ...D.projects, [`${G}/Tenant`]: 'Other' } }
  expect((decide('aws s3 ls && auth0 apps list', `${G}/Tenant`, H, both, ROOT) as { command: string }).command)
    .toBe('export AWS_PROFILE=Other; aws s3 ls && auth0 apps list --tenant armasu.us.auth0.com')
})

test('auth0 with no saved logins points at the Auth0 sign-in', () => {
  const none = { ...D, apps: [{ id: 'auth0', name: 'Auth0', logins: [] }] }
  expect((decide('auth0 apps list', `${G}/Switchboard`, H, none, ROOT) as { deny: string }).deny).toMatch(/Settings > Accounts > Auth0 \(it runs auth0 login and adds the tenants\)/)
})

test('web app CLI with no pick (null) asks and lists logins', () => {
  const r = run('auth0 apps list', `${G}/Switchboard`) as { deny: string }
  expect(r.deny).toMatch(/Armasu tenant \(a1\), Side \(a2\)/)
  expect(r.deny).toContain(`pick.mjs auth0 <login id> ${G}/Switchboard`)
})

const SB = `${H}/.claude/switchboard`
function engine(on: Parameters<Parameters<typeof test>[1]>[1], cwd: string, ran: string[], text?: string) {
  const files: Record<string, string> = {
    [`${SB}/aws-prefs.json`]: JSON.stringify({ chrome: {}, projects: D.projects }),
    [`${SB}/logins.json`]: JSON.stringify({ apps: D.apps, links: D.links }),
    [`${H}/.aws/config`]: '[sso-session s]\n[profile Armasu]\nregion=x\n[profile ArmasuInfra]\n',
  }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? H : undefined }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.list', (_, e) => ({ value: e.path === `${G}/Switchboard` ? [{ name: '.git', kind: 'dir' }] : [] }))
  on('session.cwd', () => ({ value: cwd }))
  on('tool.call', (_, e) => { if (e.tool === 'Bash') ran.push(String(e.command)); return { result: {}, text } })
}

test('the hook rewrites aws and adds context', async ($, on) => {
  const ran: string[] = []
  engine(on, `${G}/Armasu`, ran)
  const out = await $.tool.call({ tool: 'Bash', command: 'aws s3 ls' })
  expect(ran).toEqual(['export AWS_PROFILE=Armasu; aws s3 ls'])
  expect(JSON.stringify(out)).toMatch(/account-guard/)
})

test('the hook says AWS is signed out when aws output shows an expired session', async ($, on) => {
  engine(on, `${G}/Armasu`, [], "aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.")
  const out = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'aws logs tail x' }))
  expect(out).toMatch(/AWS is signed out for profile Armasu/)
})

test('the note also fires when the aws call names its own profile', async ($, on) => {
  engine(on, `${G}/Armasu`, [], 'The SSO session associated with this profile has expired or is otherwise invalid. To refresh this SSO session run aws sso login with the corresponding profile.')
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'aws sts get-caller-identity --profile Armasu' }))).toMatch(/AWS is signed out for profile Armasu/)
})

test('the hook stays quiet on a normal aws answer', async ($, on) => {
  engine(on, `${G}/Armasu`, [], '{"Account": "1"}')
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'aws sts get-caller-identity' }))).not.toMatch(/signed out/)
})

test('the hook denies with no pick and leaves other commands alone', async ($, on) => {
  const ran: string[] = []
  engine(on, `${G}/Switchboard/web/lib`, ran)
  const out = await $.tool.call({ tool: 'Bash', command: 'aws s3 ls' })
  expect(JSON.stringify(out)).toMatch(/Armasu, ArmasuInfra/)
  expect(JSON.stringify(out)).toContain(`<profile> ${G}/Switchboard\``)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ran).toEqual(['ls'])
})

test('spots an expired or missing AWS session in aws output', () => {
  for (const t of [
    "aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.",
    "Your session has expired. Please reauthenticate using 'aws login'.",
    'Error when retrieving token from sso: Token has expired and refresh failed',
    'An error occurred (ExpiredToken) when calling the GetCallerIdentity operation: The security token included in the request is expired',
    'An error occurred (ExpiredTokenException) when calling the ListBuckets operation: The security token included in the request is expired',
    'aws: [ERROR]: An error occurred (ExpiredToken) when calling the GetCallerIdentity operation: The security token included in the request is expired',
    'The SSO session associated with this profile has expired or is otherwise invalid. To refresh this SSO session run aws sso login with the corresponding profile.',
    'Error loading SSO Token: Token for https://x.awsapps.com/start does not exist',
    'aws: [ERROR]: An error occurred (NoCredentials): Unable to locate credentials. You can configure credentials by running "aws configure".',
    'Unable to locate credentials. You can configure credentials by running "aws configure".',
    'some earlier output\nUnable to locate credentials. You can configure credentials by running "aws configure".\n',
  ]) expect(signedOut(t)).toBe(true)
  expect(signedOut('{\n  "UserId": "AIDA123",\n  "Account": "123456789012",\n  "Arn": "arn:aws:iam::123456789012:user/x"\n}')).toBe(false)
  expect(signedOut('')).toBe(false)
  for (const t of [
    '2026-11-21T10:00:00 app: user token has expired, refreshing',
    '{"message":"session has expired"}',
    '2026-11-21 WARN worker: Unable to locate credentials for tenant 4',
    'echo "An error occurred (ExpiredToken) when calling"',
    'Unable to locate credentials for tenant 4',
    'Error loading SSO Token: worker log quoted this',
    'An error occurred (ExpiredToken) when calling my wrapper',
  ]) expect(signedOut(t)).toBe(false)
})
