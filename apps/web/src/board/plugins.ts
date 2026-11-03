import { useMemo, useSyncExternalStore } from 'react'
import { TEMPLATE_OP_PREFIX } from '@ttx/plugins'
import type { Runtime } from '@ttx/core'

/**
 * The plugins turned off on this board, with those that need them (Runtime.disabledPlugins); re-renders when
 * anyone changes them in Settings. Their objects stay; what adds new ones is not offered.
 */
export function usePluginsOff(runtime: Runtime): ReadonlySet<string> {
  const stored = useSyncExternalStore(
    (onChange) => {
      runtime.board.meta.observe(onChange)
      return () => runtime.board.meta.unobserve(onChange)
    },
    () => runtime.board.disabledPlugins.join(','),
  )
  return useMemo(() => runtime.disabledPlugins(), [runtime, stored])
}

/** False when the plugin of this object type is off. A tool such as 'box:line' is its type's. */
export const typeOn = (runtime: Runtime, off: ReadonlySet<string>, tool: string) => !off.has(runtime.registry.pluginOfType(tool.split(':')[0]!) ?? '')

/** True when at least one template can be added: each needs the plugins of its own nodes. */
export const templatesOn = (runtime: Runtime, off: ReadonlySet<string>) =>
  runtime.registry.ops().some((op) => op.id.startsWith(TEMPLATE_OP_PREFIX) && runtime.registry.opEnabled(op, off))
