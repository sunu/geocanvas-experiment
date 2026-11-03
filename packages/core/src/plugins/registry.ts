import { z } from 'zod'
import { addOp } from '../ops/addOp.js'
import type { OpDef } from '../ops/types.js'
import type { ObjectTypeDef, Plugin } from './types.js'

/**
 * A node that follows another (plans/plan-013.md): when the root `from` changes, the recipe re-renders this
 * node's linked part. The recipes are in @ttx/plugins (links/).
 */
export const linkSchema = z.object({
  from: z.string().min(1).describe('Id of the root object this one follows'),
  recipe: z.string().min(1).describe('What the link writes, e.g. "country"'),
  args: z.record(z.string(), z.unknown()).optional(),
})
export type Link = z.infer<typeof linkSchema>

/** Fields that every object has, beside its type's own fields: placement, its name, and a link when it follows another. */
const placement = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  z: z.number(),
  name: z.string().max(80).optional(),
  link: linkSchema.optional(),
})

/**
 * Everything the plugins contribute: object types and ops. Each addable type also gets a
 * '<type>.add' op. Ids must be unique across plugins.
 */
export class Registry {
  readonly plugins: Plugin[]
  private types = new Map<string, ObjectTypeDef>()
  private schemas = new Map<string, z.ZodObject>()
  private opDefs = new Map<string, OpDef<any, any>>()
  /** The plugin of each op and object type; a '<type>.add' op belongs to its type's plugin. */
  private owners = new Map<string, string>()

  constructor(plugins: Plugin[]) {
    this.plugins = sortByDependencies(plugins)
    for (const p of this.plugins) {
      addAll(this.types, p.objectTypes, (d) => d.type, p.id)
      addAll(this.opDefs, p.ops, (d) => d.id, p.id)
      for (const t of p.objectTypes ?? []) this.owners.set(`type:${t.type}`, p.id)
      for (const op of p.ops ?? []) this.owners.set(op.id, p.id)
    }
    for (const t of this.types.values()) {
      this.schemas.set(t.type, placement.extend(t.fields.shape))
      if (t.addable === false) continue
      const add = addOp(t)
      addAll(this.opDefs, [add], (d) => d.id, 'registry')
      this.owners.set(add.id, this.pluginOfType(t.type)!)
    }
  }

  pluginOfType(type: string): string | undefined {
    return this.owners.get(`type:${type}`)
  }

  pluginOfOp(id: string): string | undefined {
    return this.owners.get(id)
  }

  /**
   * The plugins turned off on a board: the optional ones among `ids` (Board.disabledPlugins), and every plugin
   * that depends on one of them. A plugin that is not optional is never turned off.
   */
  disabled(ids: readonly string[]): Set<string> {
    const out = new Set(this.plugins.filter((p) => p.optional && ids.includes(p.id)).map((p) => p.id))
    // Sorted by dependencies, so one pass reaches every plugin that depends on a disabled one.
    for (const p of this.plugins) if (p.optional && p.dependsOn?.some((d) => out.has(d))) out.add(p.id)
    return out
  }

  /** False for an op of a disabled plugin, or one that adds a type of a disabled plugin (OpDef.adds). */
  opEnabled(op: OpDef<any, any>, disabled: ReadonlySet<string>): boolean {
    if (!disabled.size) return true
    const own = this.pluginOfOp(op.id)
    if (own && disabled.has(own)) return false
    return !op.adds?.some((type) => disabled.has(this.pluginOfType(type) ?? ''))
  }

  objectType(type: string): ObjectTypeDef | undefined {
    return this.types.get(type)
  }

  objectTypes(): ObjectTypeDef[] {
    return [...this.types.values()]
  }

  /** The full schema of an object of this type: placement plus the type's fields. */
  objectSchema(type: string): z.ZodObject {
    const s = this.schemas.get(type)
    if (!s) throw new Error(`Unknown object type: ${type}`)
    return s
  }

  op(id: string): OpDef<any, any> | undefined {
    return this.opDefs.get(id)
  }

  ops(): OpDef<any, any>[] {
    return [...this.opDefs.values()]
  }
}

function addAll<T>(map: Map<string, T>, items: T[] | undefined, key: (item: T) => string, pluginId: string) {
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
      if (!d) throw new Error(`Plugin ${p.id} needs plugin ${dep}, which is not loaded`)
      visit(d, [...stack, p.id])
    }
    seen.add(p.id)
    out.push(p)
  }
  for (const p of plugins) visit(p, [])
  return out
}
