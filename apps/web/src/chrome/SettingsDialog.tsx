import type { Runtime } from '@ttx/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkillsSettings } from '../agent/SkillsSettings'
import { usePluginsOff } from '../board/plugins'
import { HubSettings } from '../code/HubSettings'

/**
 * Settings, from the gear in the user menu. Plugins is the board's, for everyone on it: turn optional plugins on or
 * off (board.setPlugins). A plugin that is off is not offered in the toolbar, the palette or to agents; the objects
 * it made stay on the board. Skills are the agent's: the built-in ones to read, and the board's own, for everyone on
 * it (agent/SkillsSettings.tsx); not shown while the agent is off. JupyterHub is this person's own login, kept in this
 * browser (code/hub.ts).
 */
/**
 * A tab's panel: it scrolls on its own. Without Tailwind's preflight, `hidden` does not win over a display class, so
 * the panels of the other tabs would take room beside it.
 */
const PANEL = 'min-h-0 min-w-0 content-start gap-3 overflow-y-auto data-[state=inactive]:hidden'

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
      {/* One size for every tab, so the dialog does not jump when the tab or a skill changes: each panel scrolls. */}
      <DialogContent className="h-[min(640px,85vh)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Plugins and agent skills on this board, and your JupyterHub login.</DialogDescription>
        </DialogHeader>
        {/* Tabs on the left; on a narrow window, in a row above. */}
        <Tabs defaultValue="plugins" orientation="vertical" className="min-h-0 gap-4 max-sm:flex-col">
          <TabsList className="w-40 shrink-0 self-start max-sm:w-full max-sm:flex-row!">
            <TabsTrigger value="plugins">Plugins</TabsTrigger>
            {!off.has('agent') && <TabsTrigger value="skills">Skills</TabsTrigger>}
            <TabsTrigger value="hub">JupyterHub</TabsTrigger>
          </TabsList>
          <TabsContent value="plugins" className={`grid ${PANEL}`}>
            <p className="text-sm text-muted-foreground">
              For everyone on this board. A plugin that is off is not offered in the toolbar, the palette or to agents. What it already added stays on the board.
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
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
          </TabsContent>
          {!off.has('agent') && (
            <TabsContent value="skills" className={PANEL}>
              <SkillsSettings runtime={runtime} />
            </TabsContent>
          )}
          <TabsContent value="hub" className={`grid ${PANEL}`}>
            <p className="text-sm text-muted-foreground">Only for you, in this browser. Code cells run on your own hub, as you.</p>
            <HubSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
