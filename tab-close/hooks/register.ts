// Closes what an agent opened in a browser once its turn ends. agent-browser sessions it closes itself;
// MCP browsers live in the MCP server, so an open one holds the stop once with the tool to call.
import type { EngineInterface, Register } from 'claude-code'

const TAIL_BYTES = 512 * 1024

type Kind = { label: string; open: RegExp; close: RegExp; closeWith: string; idIn?: (input: Record<string, unknown>) => unknown; idOut?: RegExp }
const KINDS: Record<string, Kind> = {
  playwright: { label: 'Playwright browser', open: /playwright.*__browser_(?!close$|install$)/, close: /playwright.*__browser_close$/, closeWith: 'browser_close' },
  chrome: {
    label: 'Chrome tab', open: /claude-in-chrome__tabs_create_mcp$/, close: /claude-in-chrome__tabs_close_mcp$/, closeWith: 'tabs_close_mcp',
    idIn: i => i.tabId, idOut: /tab\s*id\D{0,4}(\d+)/i,
  },
  scrapling: {
    label: 'Scrapling session', open: /scrapling__(browser_open|open_request_session)$/, close: /scrapling__close_session$/, closeWith: 'close_session',
    idIn: i => i.session_id, idOut: /session[_ ]?id\W{0,4}([\w-]+)/i,
  },
  firecrawl: {
    label: 'Firecrawl browser', open: /firecrawl.*browser_create$/, close: /firecrawl.*browser_(delete|close)$/, closeWith: 'firecrawl_browser_delete',
    idIn: i => i.sessionId ?? i.session_id ?? i.id, idOut: /(?:session_?id|"id")\W{0,4}([\w-]+)/i,
  },
}

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown }
const text = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => typeof x?.text === 'string' ? x.text : '').join('\n') : ''

// Code Mode leaves an inner call's result block empty; the output sits in the row's toolUseResult.
const codeModeText = (r: unknown): string => text(r) || text((r as { content?: unknown } | undefined)?.content) || (r ? JSON.stringify(r) : '')

// One shell command per segment; agent-browser counts only as the command itself (env prefix or a function body allowed).
// ponytail: read off the Bash text; a session named only in a shell variable is missed.
const AB_CALL = /^\s*(?:\w+\s*\(\)\s*)?[{(]?\s*((?:\w+=\S*\s+)*)(?:npx\s+(?:-y\s+)?)?agent-browser((?:\s+\S+)*)/
function agentBrowser(cmd: string, open: Set<string>) {
  let env: string | undefined
  for (const seg of cmd.split(/;|&&|\|\||\||\n/)) {
    const ex = /^\s*export\s+AGENT_BROWSER_SESSION=["']?([\w.-]+)/.exec(seg)
    if (ex) { env = ex[1]; continue }
    const m = AB_CALL.exec(seg)
    if (!m) continue
    const args = m[2].trim().split(/\s+/).filter(Boolean)
    const at = args.findIndex(a => a === '--session' || a.startsWith('--session='))
    const s = at < 0 ? /AGENT_BROWSER_SESSION=["']?([\w.-]+)/.exec(m[1])?.[1] ?? env ?? 'default'
      : (args[at].includes('=') ? args[at].split('=')[1] : args[at + 1] ?? '').replace(/["']/g, '')
    if (!s) continue
    // The subcommand is the first word that is not a flag or a flag's value.
    const sub = args.filter((a, i) => !a.startsWith('-') && !(i > 0 && args[i - 1].startsWith('--') && !args[i - 1].includes('=')))[0]
    if (sub === 'close') open.delete(s)
    else open.add(s)
  }
}

/** What a transcript tail left open: agent-browser sessions, and MCP browsers by kind and id. */
export function openBrowsers(tail: string) {
  const held = new Map<string, { kind: string; id: string }>()
  const pending = new Map<string, { kind: string; id?: unknown; close?: boolean }>()
  const cli = new Set<string>()
  for (const l of tail.split('\n')) {
    let row: { message?: { content?: unknown }; toolUseResult?: unknown }
    try { row = JSON.parse(l) } catch { continue }
    const c = row.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c as Block[]) {
      if (b?.type === 'tool_use' && b.name) {
        const input = b.input ?? {}
        if (b.name === 'Bash') { agentBrowser(String(input.command ?? ''), cli); continue }
        for (const [kind, k] of Object.entries(KINDS)) {
          if (k.close.test(b.name)) pending.set(String(b.id), { kind, id: k.idIn?.(input), close: true })
          else if (k.open.test(b.name)) pending.set(String(b.id), { kind, id: k.idIn?.(input) })
        }
      } else if (b?.type === 'tool_result' && b.tool_use_id && pending.has(b.tool_use_id)) {
        const p = pending.get(b.tool_use_id)!
        pending.delete(b.tool_use_id)
        if ((b as { is_error?: boolean }).is_error) continue
        if (p.close) { held.delete(`${p.kind}:${p.kind === 'playwright' ? 'browser' : String(p.id ?? '')}`); continue }
        // Playwright has one browser; every other kind is keyed by the id it handed back, else by the call.
        const id = p.kind === 'playwright' ? 'browser' : String(p.id ?? KINDS[p.kind].idOut?.exec(text(b.content) || codeModeText(row.toolUseResult))?.[1] ?? b.tool_use_id)
        held.set(`${p.kind}:${id}`, { kind: p.kind, id })
      }
    }
  }
  return { cli: [...cli], held: [...held.values()] }
}

// Kenneth may need the page: a question, or a For you step left there.
// The For you block runs from its heading to a blank line or the next label (Left:, Risks:); only a step on a page counts.
export const waiting = (msg: string) => /\?\s*$/.test(msg) || /^\W*For you\b[^\n]*(?:\n(?!\s*\n|\W*[A-Z][\w ]{0,20}:)[^\n]*)*?\b(tabs?|page|browser|sign(?:ed)? in)\b/im.test(msg)

export function reason(held: { kind: string; id: string }[]) {
  const list = held.map(h => `${KINDS[h.kind].label}${h.kind === 'playwright' ? '' : ` ${h.id}`} (${KINDS[h.kind].closeWith})`)
  return `tab-close: close what you opened before ending: ${list.join('; ')}. Leave one open only when Kenneth must act there, and say so under For you.`
}

async function onStop($: EngineInterface, e: { transcript_path: string; stop_hook_active: boolean; last_assistant_message?: string }) {
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), e.transcript_path]).catch(() => undefined)
  if (r?.exitCode !== 0) return undefined
  const { cli, held } = openBrowsers(r.stdout)
  for (const s of cli) await $.process.run(['agent-browser', '--session', s, 'close']).catch(() => undefined)
  // Holds once a turn: stop_hook_active means it already asked.
  if (!held.length || e.stop_hook_active || waiting((e.last_assistant_message ?? '').trim())) return undefined
  return reason(held)
}

export const register: Register = on => {
  on('classic.Stop', async ($, e, next) => {
    const why = await onStop($, e)
    return why ? { block: why } : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const why = await onStop($, { ...e, transcript_path: e.agent_transcript_path || e.transcript_path })
    return why ? { block: why } : next(e)
  }).catch(($, e, next) => next(e))
}
