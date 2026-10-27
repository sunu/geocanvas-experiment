import type { NodeRecord } from '../doc/schema.js'
import type { OpDef } from '../ops/types.js'
import { templateOp } from '../templates/instantiate.js'
import type {
  DataFunctionDef,
  NodeTypeDef,
  Plugin,
  PortMap,
  PortTypeDef,
  TemplateDef,
} from './types.js'

/** Everything that the enabled plugins of one doc contribute. */
export class Registry {
  readonly plugins: Plugin[]
  private nodeTypes = new Map<string, NodeTypeDef>()
  private opDefs = new Map<string, OpDef<any, any>>()
  private portTypes = new Map<string, PortTypeDef>()
  private dataFns = new Map<string, DataFunctionDef>()
  private providerMap = new Map<string, unknown>()
  private templateDefs = new Map<string, TemplateDef>()

  constructor(plugins: Plugin[]) {
    this.plugins = sortByDependencies(plugins)
    for (const p of this.plugins) {
      addAll(this.nodeTypes, p.nodeTypes, (d) => d.type, p.id)
      addAll(this.opDefs, p.ops, (d) => d.id, p.id)
      addAll(this.portTypes, p.portTypes, (d) => d.id, p.id)
      addAll(this.dataFns, p.dataFunctions, (d) => d.id, p.id)
      addAll(this.templateDefs, p.templates, (d) => d.id, p.id)
      for (const [id, inst] of Object.entries(p.providers ?? {})) this.providerMap.set(id, inst)
    }
    // Each template also gets its own palette op, e.g. 'disasters.sitrep.create'.
    for (const t of this.templateDefs.values()) {
      const op = templateOp(t)
      if (!this.opDefs.has(op.id)) this.opDefs.set(op.id, op)
    }
  }

  nodeType(type: string): NodeTypeDef | undefined {
    return this.nodeTypes.get(type)
  }
  allNodeTypes(): NodeTypeDef[] {
    return [...this.nodeTypes.values()]
  }
  op(id: string): OpDef<any, any> | undefined {
    return this.opDefs.get(id)
  }
  ops(): OpDef<any, any>[] {
    return [...this.opDefs.values()]
  }
  portType(id: string): PortTypeDef | undefined {
    return this.portTypes.get(id)
  }
  dataFunction(id: string): DataFunctionDef | undefined {
    return this.dataFns.get(id)
  }
  allDataFunctions(): DataFunctionDef[] {
    return [...this.dataFns.values()]
  }
  template(id: string): TemplateDef | undefined {
    return this.templateDefs.get(id)
  }
  templates(): TemplateDef[] {
    return [...this.templateDefs.values()]
  }
  provider<T>(id: string): T {
    if (!this.providerMap.has(id)) throw new Error(`Unknown provider: ${id}`)
    return this.providerMap.get(id) as T
  }

  inputsOf(node: NodeRecord): PortMap {
    const def = this.nodeType(node.type)
    if (!def?.inputs) return {}
    return typeof def.inputs === 'function' ? def.inputs(node, this) : def.inputs
  }

  outputsOf(node: NodeRecord): PortMap {
    const def = this.nodeType(node.type)
    if (!def?.outputs) return {}
    return typeof def.outputs === 'function' ? def.outputs(node, this) : def.outputs
  }

  /** True if a value of port type `from` can go into a port of type `to`. */
  portAccepts(from: string, to: string): boolean {
    if (from === to || to === 'any') return true
    return this.portType(to)?.accepts?.includes(from) ?? false
  }
}

function addAll<T>(
  map: Map<string, T>,
  items: T[] | undefined,
  key: (item: T) => string,
  pluginId: string,
): void {
  for (const item of items ?? []) {
    const k = key(item)
    if (map.has(k)) throw new Error(`Plugin ${pluginId}: duplicate id ${k}`)
    map.set(k, item)
  }
}

function sortByDependencies(plugins: Plugin[]): Plugin[] {
  const byId = new Map(plugins.map((p) => [p.id, p]))
  const out: Plugin[] = []
  const seen = new Set<string>()
  const visit = (p: Plugin, stack: string[]) => {
    if (seen.has(p.id)) return
    if (stack.includes(p.id)) throw new Error(`Plugin dependency cycle: ${[...stack, p.id].join(' -> ')}`)
    for (const dep of p.dependsOn ?? []) {
      const d = byId.get(dep)
      if (!d) throw new Error(`Plugin ${p.id} needs plugin ${dep}, which is not enabled`)
      visit(d, [...stack, p.id])
    }
    seen.add(p.id)
    out.push(p)
  }
  for (const p of plugins) visit(p, [])
  return out
}

/** All plugins that the app knows about. A doc enables a subset of them. */
export class PluginCatalog {
  private available = new Map<string, Plugin>()

  constructor(plugins: Plugin[], readonly alwaysOn: string[] = ['core']) {
    for (const p of plugins) this.available.set(p.id, p)
  }

  list(): Plugin[] {
    return [...this.available.values()]
  }

  get(id: string): Plugin | undefined {
    return this.available.get(id)
  }

  /** Build a registry for a set of plugin ids. Adds dependencies and always-on plugins. */
  resolve(enabled: string[]): Registry {
    const ids = new Set([...this.alwaysOn, ...enabled])
    const add = (id: string) => {
      const p = this.available.get(id)
      if (!p) return
      for (const dep of p.dependsOn ?? []) {
        if (!ids.has(dep)) {
          ids.add(dep)
          add(dep)
        }
      }
    }
    for (const id of [...ids]) add(id)
    const plugins = [...ids].map((id) => this.available.get(id)).filter((p): p is Plugin => !!p)
    return new Registry(plugins)
  }
}
