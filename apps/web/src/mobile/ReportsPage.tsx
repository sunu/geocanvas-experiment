import { useMemo, useState } from 'react'
import { DotsThreeIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { ReportBoardObject } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Board, BoardObject } from '../board/board'
import { boardReports } from '../reports/reports'
import { ReportContent } from '../reports/ReportObject'

/**
 * The board's reports, to read on a phone: one at a time, its title and blocks at the screen's width (the widget's
 * ReportContent, in one column). Until report mode exists (agent-docs/tasks/reports.md step 5), it is edited from its
 * widget: the ⋯ button opens it full screen, with its commands.
 */
export function ReportsPage({ runtime, objects, onOpen }: { runtime: Runtime; objects: BoardObject[]; onOpen(id: string): void }) {
  // Read again when anything on the board changes: a report, or one of its sources.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reports = useMemo(() => boardReports(runtime.board as Board), [runtime, objects])
  const [chosen, setChosen] = useState<string>()
  const current = (reports.find((r) => r.id === chosen) ?? reports[0])?.id
  const report = current ? (runtime.board.get(current) as ReportBoardObject | undefined) : undefined

  if (!report)
    return (
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">
        No reports on this board yet. Add one with + on the Board tab, or ask the agent to draft one.
      </p>
    )
  return (
    <div className="ttx-m-reports">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === current}
              className={cn('shrink-0 rounded-md border px-3 py-1.5 text-sm', r.id === current ? 'bg-accent font-medium' : 'bg-card text-muted-foreground')}
              onClick={() => setChosen(r.id)}
            >
              {r.title}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" title="Open the report's widget" aria-label="Open the report's widget" onClick={() => onOpen(report.id)}>
          <DotsThreeIcon className="size-5" weight="bold" />
        </Button>
      </div>
      <article className="ttx-m-report">
        <ReportContent runtime={runtime} report={report} />
      </article>
    </div>
  )
}
