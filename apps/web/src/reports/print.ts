import type { Orientation, Paper } from '@ttx/plugins'

/**
 * Printing a report (agent-docs/tasks/reports.md §7, option 1): the browser's print dialog, with the paper's size in
 * `@page`. Pure helpers, tested in Node; the print view is ReportPrint.tsx.
 */

/** The paper's physical size, for `@page` and each printed sheet: CSS px would leave A4 half a pixel too tall. */
const PAPER: Record<Paper, { w: string; h: string }> = { a4: { w: '210mm', h: '297mm' }, letter: { w: '8.5in', h: '11in' } }

export function paperSize(paper: Paper, orientation: Orientation): { w: string; h: string } {
  const { w, h } = PAPER[paper]
  return orientation === 'landscape' ? { w: h, h: w } : { w, h }
}

/** The `@page` rule for a report: its paper, and no margin (the pages carry their own, and the browser's header and footer go). */
export function pageRule(paper: Paper, orientation: Orientation): string {
  const { w, h } = paperSize(paper, orientation)
  return `@page { size: ${w} ${h}; margin: 0; }`
}

/** Dots per inch a printed map picture aims at, and CSS px per inch. */
const PRINT_DPI = 300
const CSS_DPI = 96
/** The largest side of a picture, px: within every browser's canvas and WebGL limits. */
const MAX_SIDE = 4096

/**
 * The pixel ratio to draw a map's picture at for print: about 300 dpi at the width it is printed (`shown`, CSS px),
 * for a picture of the map's board size (`w` × `h`, CSS px), never more than 4096 px a side, never less than 2.
 */
export function printRatio(w: number, h: number, shown: number): number {
  const wanted = (PRINT_DPI / CSS_DPI) * (shown / w)
  const cap = MAX_SIDE / Math.max(w, h, 1)
  return Math.round(Math.max(2, Math.min(wanted, cap)) * 100) / 100
}
