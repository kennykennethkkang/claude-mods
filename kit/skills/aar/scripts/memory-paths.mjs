// Files a memory note names that git knew and the disk no longer has: the note is out of date.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PATH = /(?<![\w/@~.*-])((?:[\w.()[\]-]+\/)+[\w.()[\]-]+\.(?:tsx?|jsx?|mjs|py|sh|css|json|md|swift|ya?ml))\b/g
// A line that says the file went is history, not a pointer.
const HISTORY = /\b(deleted|removed|moved|renamed|gone|replaced|retired|used to|no longer|old)\b/i

const lines = (repo, ...args) => { try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean) } catch { return [] } }

/** [{ file, path, now }] for the notes in memory folder dir whose project is repo; now is where the file went, when only one fits. */
export function gonePaths(dir, repo) {
  const live = lines(repo, 'ls-files', '-co', '--exclude-standard').filter(f => fs.existsSync(path.join(repo, f)))
  const ends = (f, p) => f === p || f.endsWith(`/${p}`)
  let ever
  const out = []
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')) {
    const seen = new Set()
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (HISTORY.test(line.replace(PATH, ''))) continue
      for (const [, p] of line.matchAll(PATH)) {
        if (seen.has(p) || fs.existsSync(path.join(repo, p)) || live.some(f => ends(f, p))) continue
        seen.add(p)
        ever ??= lines(repo, 'log', '--all', '--no-renames', '--name-only', '--format=')
        if (!ever.some(f => ends(f, p))) continue
        const at = live.filter(f => path.basename(f) === path.basename(p))
        out.push({ file: path.join(dir, file), path: p, now: at.length === 1 ? at[0] : undefined })
      }
    }
  }
  return out
}
