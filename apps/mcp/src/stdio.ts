#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_PORT, log, startCompanion } from './companion.ts'

/**
 * For MCP clients that start a command (Claude Desktop, or any client set up with stdio): forwards the client's
 * messages to the companion's /mcp, so every client shares one companion and its paired tabs. Starts the companion
 * in this process when none runs.
 */
const port = Number(process.env.TTX_MCP_PORT ?? DEFAULT_PORT)
try {
  await startCompanion({ port, appUrl: process.env.TTX_APP_URL })
  log(`started the companion on port ${port}`)
} catch (err) {
  // ponytail: when this process started it and exits, other clients lose it; run `npm run mcp` to keep one up.
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
}

const remote = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
const local = new StdioServerTransport()
local.onmessage = (message) => void remote.send(message).catch((err) => log(`companion: ${err.message}`))
remote.onmessage = (message) => void local.send(message)
remote.onerror = (err) => log(`companion: ${err.message}`)
local.onclose = () => process.exit(0)
await remote.start()
await local.start()
