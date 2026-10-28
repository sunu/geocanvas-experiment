import { DEFAULT_PORT, log, startCompanion } from './companion.ts'

/** npm run mcp: the companion, for MCP clients that connect over HTTP (Claude Code, Codex). */
const companion = await startCompanion({ port: Number(process.env.TTX_MCP_PORT ?? DEFAULT_PORT), appUrl: process.env.TTX_APP_URL })
log(`MCP endpoint: ${companion.url}`)
log(`Claude Code: claude mcp add --transport http ttx ${companion.url}`)
log(`Codex: add [mcp_servers.ttx] url = "${companion.url}" to ~/.codex/config.toml`)
log('Then give your agent a board link; it gives you back a link that pairs this browser.')
