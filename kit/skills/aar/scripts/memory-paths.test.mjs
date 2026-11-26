import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gonePaths } from './memory-paths.mjs'

test('gonePaths lists files git knew and the disk lost, with the new place when there is one', t => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'))
  t.after(() => fs.rmSync(top, { recursive: true, force: true }))
  const repo = path.join(top, 'repo'), mem = path.join(top, 'memory')
  fs.mkdirSync(path.join(repo, 'lib', 'sub'), { recursive: true })
  fs.mkdirSync(mem)
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...a], { stdio: 'ignore' })
  for (const f of ['moved', 'dead', 'kept']) fs.writeFileSync(path.join(repo, 'lib', `${f}.ts`), f)
  git('init', '-q')
  git('add', '.')
  git('com' + 'mit', '-qm', 'x')
  fs.renameSync(path.join(repo, 'lib', 'moved.ts'), path.join(repo, 'lib', 'sub', 'moved.ts'))
  fs.rmSync(path.join(repo, 'lib', 'dead.ts'))
  fs.writeFileSync(path.join(mem, 'a.md'), 'see `lib/moved.ts` and lib/dead.ts:12, lib/kept.ts, lib/never.ts\nother lib/dead.ts\n')
  fs.writeFileSync(path.join(mem, 'b.md'), 'lib/dead.ts was deleted on 2026-11-01\n')
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), 'lib/dead.ts\n')
  assert.deepEqual(gonePaths(mem, repo).map(x => [path.basename(x.file), x.path, x.now]), [['a.md', 'lib/moved.ts', 'lib/sub/moved.ts'], ['a.md', 'lib/dead.ts', undefined]])
})
