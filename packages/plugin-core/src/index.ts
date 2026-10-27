import { builtinOps, definePlugin } from '@geo-canvas/core'
import { coreNodeOps } from './ops.js'
import { coreNodeTypes } from './nodes.js'
import { corePortTypes } from './ports.js'

export * from './ports.js'
export * from './nodes.js'
export * from './ops.js'
export * from './geo/project.js'

/** The core plugin. It is always on. It uses the same plugin API as every other plugin. */
export const corePlugin = definePlugin({
  id: 'core',
  version: '0.0.1',
  title: 'Core',
  portTypes: corePortTypes,
  nodeTypes: coreNodeTypes,
  ops: [...builtinOps, ...coreNodeOps],
})
