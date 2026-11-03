import { definePlugin } from '@ttx/core'

/**
 * External agents through the MCP companion (plans/plan-010.md). It has no ops or types: it is here so that a board
 * can turn them off in Settings, apart from the board's own agent (apps/web/src/mcp/executor.ts checks it).
 */
export const mcpPlugin = definePlugin({
  id: 'mcp',
  title: 'External agents (MCP)',
  description: 'Your own Claude or Codex, through the local MCP companion.',
  optional: true,
})
