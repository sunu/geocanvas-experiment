import type { Runtime } from '@ttx/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePluginsOff } from '../board/plugins'

/**
 * The board's settings, for everyone on it. Plugins: turn optional plugins on or off (board.setPlugins). A plugin
 * that is off is not offered in the toolbar, the palette or to agents; the objects it made stay on the board.
 */
export function SettingsDialog({ runtime, open, onOpenChange }: { runtime: Runtime; open: boolean; onOpenChange(open: boolean): void }) {
  const off = usePluginsOff(runtime)
  const stored = runtime.board.disabledPlugins
  const plugins = runtime.registry.plugins.filter((p) => p.optional)
  const title = (id: string) => runtime.registry.plugins.find((p) => p.id === id)?.title ?? id
  const set = (id: string, on: boolean) => {
    const disabled = on ? stored.filter((d) => d !== id) : [...stored, id]
    runtime.beginGesture()
    runtime.dispatch('board.setPlugins', { kind: 'canvas' }, { disabled })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription>These settings are for everyone on this board.</DialogDescription>
        </DialogHeader>
        <section aria-labelledby="ttx-settings-plugins" className="grid gap-3">
          <div>
            <h3 id="ttx-settings-plugins" className="text-sm font-medium">
              Plugins
            </h3>
            <p className="text-sm text-muted-foreground">A plugin that is off is not offered in the toolbar, the palette or to agents. What it already added stays on the board.</p>
          </div>
          <ul className="m-0 grid max-h-[60vh] list-none gap-2 overflow-y-auto p-0">
            {plugins.map((p) => {
              // Off because a plugin it needs is off: turn that one on first.
              const needs = !stored.includes(p.id) && off.has(p.id) ? p.dependsOn?.filter((d) => off.has(d)) : undefined
              return (
                <li key={p.id}>
                  <label className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
                    <Checkbox className="mt-0.5" checked={!off.has(p.id)} disabled={!!needs?.length} onCheckedChange={(on) => set(p.id, on === true)} />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">{p.title}</span>
                      {p.description && <span className="text-sm text-muted-foreground">{p.description}</span>}
                      {!!needs?.length && <span className="text-sm text-muted-foreground">Needs {needs.map(title).join(', ')}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  )
}
