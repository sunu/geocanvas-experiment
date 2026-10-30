import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Runtime } from '@ttx/core'
import type { ReportBoardObject } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import type { Board } from '../board/board'
import { isLoading } from '../canvas/loading'
import { ReportEditing } from './editing'
import { pageRule, paperSize } from './print'
import { Printing, ReportPages } from './ReportPages'

/**
 * Printing a report (agent-docs/tasks/reports.md §7, option 1): every page at its real size, out of sight on screen
 * and the only thing shown in print, then the browser's print dialog, where "Save as PDF" makes the file. Maps are
 * pictures drawn at print resolution (ReportPages' MapPicture), so the dialog opens only once every picture, image
 * and embedded widget is ready, or after a minute with what there is.
 */

/** Ask report mode to print its report: from the Options panel, which is outside report mode's state. */
export function startPrint() {
  document.querySelector('.ttx-reportmode')?.dispatchEvent(new CustomEvent(START_PRINT))
}
export const START_PRINT = 'ttx-report-print'

/** How often readiness is checked, and how long printing waits for maps and widgets at most. */
const CHECK_MS = 250
const LIMIT_MS = 60_000

export function ReportPrint({ report: r, runtime, onDone }: { report: ReportBoardObject; runtime: Runtime; onDone(): void }) {
  const root = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Preparing the pages…')
  const { w, h } = paperSize(r.paper, r.orientation)

  useEffect(() => {
    let stopped = false
    let readyChecks = 0
    const started = performance.now()
    const sources = r.blocks.flatMap((b) => (b.kind === 'item' ? [b.sourceId] : []))
    const finish = () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('afterprint', finish)
      onDone()
    }
    const print = async (note?: string) => {
      clearInterval(timer)
      const images = [...(root.current?.querySelectorAll('img') ?? [])]
      await Promise.all(images.map((i) => i.decode().catch(() => {})))
      if (stopped) return
      setStatus(note ?? 'Printing…')
      window.addEventListener('afterprint', finish)
      window.print()
    }
    const timer = setInterval(() => {
      const el = root.current
      if (!el || stopped) return
      const maps = el.querySelectorAll('.ttx-report__sheet .ttx-report__map').length
      const waiting = el.querySelectorAll('.ttx-report__sheet .ttx-report__map.is-loading').length
      const images = [...el.querySelectorAll<HTMLImageElement>('.ttx-report__sheet img')].filter((i) => !i.complete).length
      const widgets = sources.filter(isLoading).length
      setStatus(waiting ? `Drawing maps for print: ${maps - waiting} of ${maps}…` : widgets || images ? 'Loading the report’s data…' : 'Printing…')
      // Ready twice in a row: a widget can start loading just after it appears.
      readyChecks = waiting || images || widgets ? 0 : readyChecks + 1
      if (readyChecks >= 2) void print()
      else if (performance.now() - started > LIMIT_MS) void print(waiting ? `${waiting} of ${maps} maps were not ready in time and print as blank areas.` : undefined)
    }, CHECK_MS)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('afterprint', finish)
    }
    // Once per print: a change to the report meanwhile is printed as it is, since the pages re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {createPortal(
        <div ref={root} className="ttx-print" style={{ ['--ttx-print-w' as string]: w, ['--ttx-print-h' as string]: h }} aria-hidden>
          <style>{pageRule(r.paper, r.orientation)}</style>
          {/* Context passes through the portal: cut off report mode's editing, so the print is read-only (no controls,
              placeholders or page break labels). */}
          <ReportEditing.Provider value={null}>
            <Printing.Provider value={true}>
              <ReportPages report={r} board={runtime.board as Board} runtime={runtime} which="all" scale={1} full footer={(n, count) => `Page ${n} of ${count}`} />
            </Printing.Provider>
          </ReportEditing.Provider>
        </div>,
        document.body,
      )}
      {createPortal(
        <div className="ttx-ui fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-3 py-2 font-sans text-sm text-popover-foreground shadow-md" role="status">
          <span>{status}</span>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>,
        document.body,
      )}
    </>
  )
}
