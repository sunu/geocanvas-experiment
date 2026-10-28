import { log, startCompanion } from './companion.ts'
import { DEFAULT_PORT, savedToken } from './pairing.ts'

/** npm run mcp: the companion, for MCP clients that connect over HTTP (Claude Code, Codex). */
const companion = await startCompanion({ port: Number(process.env.TTX_MCP_PORT ?? DEFAULT_PORT), appUrl: process.env.TTX_APP_URL, token: savedToken() })
log(`MCP endpoint: ${companion.url}`)
log(`Claude Code: claude mcp add --transport http ttx ${companion.url}`)
log(`Codex: add [mcp_servers.ttx] url = "${companion.url}" to ~/.codex/config.toml`)
log('Then give your agent a board link; it gives you back a link that pairs this browser.')
