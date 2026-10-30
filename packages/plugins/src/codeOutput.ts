import { z } from 'zod'
import { UPLOAD_ID } from '@ttx/core'
import type { Bbox } from './mapLayers.js'

/**
 * What a code cell's run gives (plans/plan-018.md): the kinds of output, how they are stored, and which other
 * objects can show them. No React and no Jupyter here: the browser runs code (apps/web/src/code/) and the
 * `code` plugin (code.ts) writes the result.
 */

/** The kinds of output, named as tool outputs are. */
export const OUTPUT_KINDS = ['geo.features', 'image.png', 'table', 'text', 'number', 'json'] as const
export type OutputKind = (typeof OUTPUT_KINDS)[number]

export const KIND_NAMES: Record<OutputKind, string> = {
  'geo.features': 'features',
  'image.png': 'an image',
  table: 'a table',
  text: 'text',
  number: 'a number',
  json: 'JSON',
}

/** Inline values (text, numbers, JSON, tables) larger than this are cut, so the board doc stays small. */
export const MAX_INLINE_BYTES = 64 * 1024
/** At most this many table rows are kept inline. */
export const MAX_TABLE_ROWS = 500
export const MAX_STDOUT = 8 * 1024
/** How long one run may take before the kernel is interrupted. */
export const RUN_TIMEOUT_MS = 60_000

export const tableValue = z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.unknown())) })
export type TableValue = z.infer<typeof tableValue>

/**
 * The last good output of a cell. Features and images are uploads (stored in R2 by the room, read by their id);
 * the rest is inline in `value`. `summary` is a short text for the agent and for captions.
 */
export const codeOutput = z.object({
  kind: z.enum(OUTPUT_KINDS),
  uploadId: z.string().regex(UPLOAD_ID).optional(),
  value: z.unknown().optional(),
  /** For features: their bounding box. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** The value was cut to fit (rows, characters). */
  truncated: z.boolean().optional(),
  summary: z.string(),
  at: z.number(),
  by: z.string(),
  /** The source that made it, so a later edit shows as "not run". */
  sourceHash: z.string(),
})
export type CodeOutput = z.infer<typeof codeOutput>

export const codeError = z.object({ ename: z.string(), evalue: z.string(), traceback: z.array(z.string()) })
export type CodeError = z.infer<typeof codeError>

/** The latest run, good or not. A failed run leaves `output` as it was. */
export const codeRun = z.object({
  status: z.enum(['ok', 'error']),
  at: z.number(),
  by: z.string(),
  ms: z.number(),
  sourceHash: z.string(),
  stdout: z.string().optional(),
  error: codeError.optional(),
})
export type CodeRun = z.infer<typeof codeRun>

/** What an execution gives, before it is written on the board: the output without who and when. */
export type ExecOutput = Omit<CodeOutput, 'at' | 'by' | 'sourceHash'>
export type ExecResult = { ok: true; output?: ExecOutput; stdout: string; ms: number } | { ok: false; error: CodeError; stdout: string; ms: number }

/** The object types that can show a cell's output, and the kinds each takes. */
export const ACCEPTS: Record<string, readonly OutputKind[]> = {
  map: ['geo.features'],
  input: ['geo.features'],
  image: ['image.png'],
  text: ['text', 'number'],
  sticky: ['text', 'number'],
}

export const accepts = (type: string, kind: OutputKind | undefined) => !!kind && !!ACCEPTS[type]?.includes(kind)

/** A short, stable hash of a source (FNV-1a), to tell whether the output is from the code as it is now. */
export function hashSource(source: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const ANSI = /\u001b\[[0-9;]*m/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

/** At most `max` characters, keeping the end (the error is at the end of a traceback or a log). */
export function tail(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`
}

/** An error as the agent gets it: the name, the message and the end of the traceback, at most 2 KB. */
export function errorText(error: CodeError): string {
  const trace = tail(error.traceback.map(stripAnsi).join('\n'), 2000)
  return `${error.ename}: ${error.evalue}${trace ? `\n${trace}` : ''}`
}

const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? '').length

/** A table cut to MAX_TABLE_ROWS and MAX_INLINE_BYTES. */
export function capTable(t: TableValue): { value: TableValue; truncated: boolean } {
  let rows = t.rows.slice(0, MAX_TABLE_ROWS)
  while (rows.length > 1 && size({ columns: t.columns, rows }) > MAX_INLINE_BYTES) rows = rows.slice(0, Math.floor(rows.length / 2))
  return { value: { columns: t.columns, rows }, truncated: rows.length < t.rows.length }
}

export function capText(s: string): { value: string; truncated: boolean } {
  return s.length > MAX_INLINE_BYTES / 2 ? { value: s.slice(0, MAX_INLINE_BYTES / 2), truncated: true } : { value: s, truncated: false }
}

/** The bbox of every coordinate in a GeoJSON object, or undefined for none. */
export function bboxOfGeoJson(geojson: unknown): Bbox | undefined {
  const b: Bbox = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      b[0] = Math.min(b[0], c[0])
      b[1] = Math.min(b[1], c[1])
      b[2] = Math.max(b[2], c[0])
      b[3] = Math.max(b[3], c[1])
    } else c.forEach(walk)
  }
  const visit = (g: unknown) => {
    if (!g || typeof g !== 'object') return
    const o = g as { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[]; coordinates?: unknown }
    if (o.features) o.features.forEach(visit)
    else if (o.geometry) visit(o.geometry)
    else if (o.geometries) o.geometries.forEach(visit)
    else walk(o.coordinates)
  }
  visit(geojson)
  return b[0] === Infinity ? undefined : b
}

const round = (n: number) => Math.round(n * 1e4) / 1e4

/** A short text of an output, for the agent's board summary, its op results and captions. */
export function summarize(kind: OutputKind, value: unknown, extra: { features?: number; bbox?: Bbox; truncated?: boolean } = {}): string {
  const cut = extra.truncated ? ' (cut)' : ''
  switch (kind) {
    case 'geo.features':
      return `${extra.features ?? 0} feature(s)${extra.bbox ? ` in [${extra.bbox.map(round).join(', ')}]` : ''}`
    case 'image.png':
      return 'an image'
    case 'table': {
      const t = value as TableValue
      return `table of ${t.rows.length} row(s)${cut}: ${t.columns.slice(0, 8).join(', ')}${t.columns.length > 8 ? ', …' : ''}`
    }
    case 'number':
      return String(value)
    default: {
      const s = typeof value === 'string' ? value : JSON.stringify(value)
      return (s.length > 200 ? `${s.slice(0, 200)}…` : s) + cut
    }
  }
}

/**
 * How a follower stands against its cell (plans/plan-018.md, "When the code changes"). Derived, never stored:
 * `shown` is when the output it shows was made (a layer's upload id is matched to the cell's, a linked object's
 * `link.args.renderedAt`).
 */
export type FollowerState =
  | { state: 'current' }
  | { state: 'deleted' }
  | { state: 'failed'; at: number }
  | { state: 'otherKind'; kind: OutputKind }
  | { state: 'edited' }
  | { state: 'old' }

export interface CellLike {
  source: string
  output?: CodeOutput
  run?: CodeRun
}

export function followerState(cell: CellLike | undefined, followerType: string, shows: { uploadId?: string; renderedAt?: number }): FollowerState {
  if (!cell) return { state: 'deleted' }
  const { output, run } = cell
  if (run?.status === 'error' && run.sourceHash === hashSource(cell.source)) return { state: 'failed', at: run.at }
  if (output && !accepts(followerType, output.kind)) return { state: 'otherKind', kind: output.kind }
  if (output && output.sourceHash !== hashSource(cell.source)) return { state: 'edited' }
  if (!output) return { state: 'current' }
  const same = shows.uploadId ? shows.uploadId === output.uploadId : shows.renderedAt === output.at
  return same ? { state: 'current' } : { state: 'old' }
}
