// /servers: what listens on localhost for dev work, with Open and Stop.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Server } from '../types'

const PANE = 'dev-servers'
const servers = atom({ plugin: 'dev-servers', key: 'servers' } as const, [])
// Runtimes that serve dev work; Discord, OneDrive, the editor and the like are left out.
const DEV = /^(node|python[\d.]*|bun|deno|ruby|php|uvicorn|gunicorn)$/i

export const parseLsof = (out: string): Omit<Server, 'folder'>[] => {
  const found: Omit<Server, 'folder'>[] = []
  let pid = 0
  let command = ''
  for (const row of out.split('\n')) {
    if (row.startsWith('p')) pid = Number(row.slice(1))
    else if (row.startsWith('c')) command = row.slice(1)
    else if (row.startsWith('n')) {
      const port = Number(/:(\d+)$/.exec(row)?.[1])
      if (port && DEV.test(command) && !found.some(s => s.port === port)) found.push({ pid, command, port })
    }
  }
  return found.sort((a, b) => a.port - b.port)
}

const scan = async ($: EngineInterface): Promise<Server[]> => {
  const ran = await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])
  return Promise.all(parseLsof(ran.stdout).map(async s => {
    const cwd = await $.process.run(['lsof', '-a', '-p', String(s.pid), '-d', 'cwd', '-Fn'])
    const path = cwd.stdout.split('\n').find(l => l.startsWith('n'))?.slice(1) ?? ''
    return { ...s, folder: path.split('/').slice(-2).join('/') }
  }))
}

const refresh = async ($: EngineInterface) => {
  const list = await scan($)
  await update($, servers, () => list)
}

// :3000 keeps localhost for its sign-in cookies; choosers use 127.0.0.1.
const urlOf = (port: number) => `http://${port === 3000 ? 'localhost' : '127.0.0.1'}:${port}/`

const stop = async ($: EngineInterface, s: Server) => {
  const answer = await $.ui.ask(`Stop ${s.command} on :${s.port} (${s.folder})?`, ['Stop it', 'Keep it']).catch(() => 'Keep it')
  if (answer !== 'Stop it') return
  await $.process.run(['kill', String(s.pid)])
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'servers', description: 'List dev servers listening on localhost, with Open and Stop' })
    return next(e)
  })

  on('command.run', { command: 'servers' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Dev servers' })
    const list = await read($, servers)
    return { text: list.length ? `Listening: ${list.map(s => `:${s.port} ${s.folder}`).join(', ')}` : 'No dev servers listening.' }
  })

  on('turn.complete', async ($, e, next) => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) await refresh($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, servers)
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No dev servers listening.</Text>}
        {list.map(s => (
          <Box key={`row-${s.port}`}>
            <Text wrap="truncate">:{String(s.port).padEnd(6)}{s.command.padEnd(8)}{s.folder}  </Text>
            <Button key={`open-${s.port}`} label="Open" onPress={() => void $.process.run(['open', urlOf(s.port)])} />
            <Text> </Text>
            <Button key={`stop-${s.port}`} label="Stop" onPress={() => void stop($, s)} />
          </Box>
        ))}
        <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
      </Box>
    )
  })
}
