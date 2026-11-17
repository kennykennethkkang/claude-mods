import type { EngineInterface } from 'claude-code'
import { feed, runs } from './state'

/** Background shells this chat started and has not seen end: Bash run_in_background, ended by TaskStop or its notification. */
export function noteShell(tool: string, e: Record<string, unknown>, result: unknown, text: string) {
  if (tool === 'Bash' && e.run_in_background === true) {
    const r = (result ?? {}) as { backgroundTaskId?: unknown; backgroundOutputPath?: unknown }
    const id = typeof r.backgroundTaskId === 'string' ? r.backgroundTaskId : /background with ID: (\S+?)\.?(?:\s|$)/.exec(text)?.[1]
    if (!id) return
    const output = typeof r.backgroundOutputPath === 'string' ? r.backgroundOutputPath : /Output is being written to: (\S+)/.exec(text)?.[1]
    feed.shells.set(id, { id, command: String(e.command ?? '').slice(0, 200), ...(output ? { output } : {}) })
  } else if (tool === 'TaskStop' || tool === 'KillShell') {
    // Stopped or already gone; either way nothing runs under that id now.
    const id = e.task_id ?? e.shell_id
    const type = (result as { task_type?: unknown } | undefined)?.task_type
    if (typeof id === 'string' && !feed.shells.delete(id) && tool === 'TaskStop' && type !== 'local_bash' && !feed.stopped.includes(id)) feed.stopped.push(id)
  }
}
export function shellsDone(text: string) {
  for (const m of text.matchAll(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>(?:completed|failed|killed|stopped)<\/status>/g)) feed.shells.delete(m[1] ?? '')
}
/** Notices absorbed mid turn never reach prompt.submit; the transcript still has them. */
export function shellsDoneIn(transcript: string) {
  for (const line of transcript.split('\n')) {
    if (!line.includes('absorbed_mid_turn')) continue
    try {
      const q = JSON.parse(line) as { type?: unknown; reason?: unknown; content?: unknown }
      if (q.type === 'queue-operation' && q.reason === 'absorbed_mid_turn' && typeof q.content === 'string') shellsDone(q.content)
    } catch { /* a line mid-write */ }
  }
}
// fs.read refuses files over 4 MiB and a transcript runs to hundreds of MB, so tail seeks to the end.
// The cut first line fails JSON.parse and is skipped.
// ponytail: a notice absorbed more than TAIL_BYTES back is missed; keep a scanned byte offset if that bites.
export const TAIL_BYTES = 2_000_000
export async function syncShells($: EngineInterface, transcript: string) {
  if (!feed.shells.size) return
  const r = await Promise.resolve().then(() => $.process.run(['tail', '-c', String(TAIL_BYTES), transcript], { timeoutMs: 5_000 })).catch(() => undefined)
  if (r?.exitCode === 0) shellsDoneIn(r.stdout)
}
export const liveShells = () => [...feed.shells.values()]
