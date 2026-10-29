import { z } from 'zod'
import { TEMPLATE_OP_PREFIX, templatesPlugin } from '@ttx/plugins'

/** A template as the New board dialog offers it: read from its op, so a new template needs no change here. */
export interface TemplateChoice {
  /** The op is `template.<id>`. */
  id: string
  title: string
  description: string
  /** Its seeds, by arg name, with the form widget that picks each (e.g. `event`, `area`). */
  seeds: { key: string; label: string; widget: string }[]
}

export const TEMPLATE_CHOICES: TemplateChoice[] = (templatesPlugin.ops ?? [])
  .filter((op) => op.id.startsWith(TEMPLATE_OP_PREFIX))
  .map((op) => {
    const schema = z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as { properties: Record<string, { widget?: string; description?: string }> }
    return {
      id: op.id.slice(TEMPLATE_OP_PREFIX.length),
      title: op.title,
      description: op.description,
      seeds: Object.entries(schema.properties).flatMap(([key, p]) => (p.widget ? [{ key, label: p.description ?? key, widget: p.widget }] : [])),
    }
  })

export const templateTitle = (id: string | undefined) => TEMPLATE_CHOICES.find((t) => t.id === id)?.title
