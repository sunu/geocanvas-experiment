import { Button } from '@/components/ui/button'

/**
 * Asks before adding what was dropped on a report (agent-docs/tasks/reports.md §4), by the point of the drop. Add puts
 * the objects back where they were and adds them; Cancel leaves them where they were dropped, as a move. Presses
 * stay here: one on the canvas would start a new gesture, and the drop must be one undo step with its drag.
 */
export function DropConfirm({ at, question, onAdd, onCancel }: { at: { x: number; y: number }; question: string; onAdd(): void; onCancel(): void }) {
  return (
    <div
      className="ttx-ui ttx-dropconfirm absolute z-[1000003] flex w-72 flex-col gap-3 rounded-lg border bg-popover p-3 font-sans text-sm text-popover-foreground shadow-md"
      style={{ left: at.x + 12, top: at.y + 12 }}
      role="dialog"
      aria-label="Add to report"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p>{question}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" autoFocus onClick={onAdd}>
          Add
        </Button>
      </div>
    </div>
  )
}
