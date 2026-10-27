import * as Y from 'yjs'
import { z } from 'zod'
import {
  builtinOps,
  CanvasRuntime,
  defineOp,
  definePlugin,
  PluginCatalog,
  type Actor,
} from '../src/index.js'

const regenerateOp = defineOp({
  id: 'test.group.regenerate',
  title: 'Regenerate',
  description: 'Replace children with `count` notes.',
  target: { kind: 'node', types: ['test.group'], min: 1, max: 1 },
  args: z.object({ count: z.number().int().min(0) }),
  prepare(ctx, args) {
    const groupId = (ctx.target as { ids: string[] }).ids[0]!
    return { groupId, count: args.count, old: ctx.reader.children(groupId).map((c) => c.id) }
  },
  apply(tx, plan) {
    for (const id of plan.old) tx.deleteNode(id)
    for (let i = 0; i < plan.count; i++) {
      tx.createNode({ type: 'test.note', props: { text: `child ${i}` }, parentId: plan.groupId })
    }
    tx.updateProps(plan.groupId, { lastCount: plan.count })
  },
})

export const corePlugin = definePlugin({
  id: 'core',
  version: '0.0.1',
  title: 'Core',
  portTypes: [{ id: 'number', description: 'A number' }],
  nodeTypes: [
    {
      type: 'test.note',
      title: 'Note',
      description: 'Text note',
      props: z.object({ text: z.string().default('') }),
      defaultSize: { w: 100, h: 100 },
    },
    {
      type: 'test.source',
      title: 'Source',
      description: 'Outputs its value',
      props: z.object({ value: z.number().default(1) }),
      outputs: { value: { type: 'number' } },
      compute: ({ node }) => ({ outputs: { value: node.props.value } }),
      defaultSize: { w: 100, h: 100 },
    },
    {
      type: 'test.double',
      title: 'Double',
      description: 'Doubles its input after a delay',
      props: z.object({}),
      inputs: { value: { type: 'number' } },
      outputs: { value: { type: 'number' } },
      async compute({ inputs }) {
        await new Promise((r) => setTimeout(r, 5))
        const v = inputs.value as number | undefined
        return { outputs: v === undefined ? {} : { value: v * 2 } }
      },
      defaultSize: { w: 100, h: 100 },
    },
    {
      type: 'test.group',
      title: 'Group',
      description: 'Has `value` children',
      props: z.object({ autoSync: z.boolean().default(true), lastCount: z.number().optional() }),
      inputs: { value: { type: 'number' } },
      onInputsChanged: {
        op: 'test.group.regenerate',
        enabledProp: 'autoSync',
        args: (_node, inputs) => (typeof inputs.value === 'number' ? { count: inputs.value } : undefined),
      },
      group: { childType: 'test.note' },
      defaultSize: { w: 300, h: 300 },
    },
  ],
  ops: [...builtinOps, regenerateOp],
  templates: [
    {
      id: 'test.pipeline',
      title: 'Pipeline',
      description: 'Source -> double -> group',
      inputs: z.object({ value: z.number().default(2) }),
      build: (inputs) => ({
        nodes: [
          { key: 'src', type: 'test.source', props: { value: inputs.value }, layout: { x: 0, y: 0 } },
          { key: 'dbl', type: 'test.double', layout: { x: 200, y: 0 } },
          { key: 'grp', type: 'test.group', layout: { x: 400, y: 0 } },
        ],
        links: [
          { from: { key: 'src', port: 'value' }, to: { key: 'dbl', port: 'value' } },
          { from: { key: 'dbl', port: 'value' }, to: { key: 'grp', port: 'value' } },
        ],
      }),
    },
  ],
})

export const extraPlugin = definePlugin({
  id: 'extra',
  version: '0.0.1',
  title: 'Extra',
  dependsOn: ['core'],
  nodeTypes: [
    { type: 'extra.thing', title: 'Thing', description: '', props: z.object({}), defaultSize: { w: 10, h: 10 } },
  ],
  ops: [
    defineOp({
      id: 'extra.thing.poke',
      title: 'Poke',
      description: 'Poke a thing',
      target: { kind: 'node', types: ['extra.thing'] },
      args: z.object({}),
      apply() {},
    }),
  ],
})

export const catalog = new PluginCatalog([corePlugin, extraPlugin])

/** Two Y.Docs that sync in memory, like two clients through a server. */
export function linkedDocs(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'))
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'))
  return [a, b]
}

export const alice: Actor = { kind: 'user', id: 'alice' }
export const bob: Actor = { kind: 'user', id: 'bob' }

export function runtime(ydoc: Y.Doc, actor: Actor = alice) {
  return new CanvasRuntime({ ydoc, catalog, actor })
}

export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))
