import { defineTool } from '@ttx/core'
import {
  bboxOfGeoJson,
  capTable,
  capText,
  codeExecuteSpec,
  OUTPUT_KINDS,
  RUN_TIMEOUT_MS,
  summarizeOutput,
  tableValue,
  type ExecOutput,
  type ExecResult,
  type OutputKind,
} from '@ttx/plugins'
import { personActor } from '../board/person'
import { roomFromHash } from '../board/room'
import { uploadFile } from '../uploads/upload'
import { hubSession, hubState } from './hub'

/**
 * The browser tool that runs a code cell (plans/plan-021.md) on this person's JupyterHub, for the `code` ops'
 * prepare. It writes nothing on the board: features and pictures are uploaded to the room (so every browser can
 * read them by id), and the rest comes back inline, cut to fit. The code's own errors are a result, not a failure.
 */

/** Results an agent tested a moment ago, so its code.add does not run the same code again. */
const MEMO_MS = 5 * 60_000
const memo = new Map<string, { at: number; result: ExecResult }>()

let person: string | undefined

async function upload(body: BlobPart, name: string, type: string): Promise<string> {
  const room = roomFromHash(location.hash)
  if (!room) throw new Error('Not on a board')
  person ??= personActor().id
  return uploadFile(new File([body], name, { type }), room, person)
}

const base64Bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** The board's output for what the preamble gave: uploaded, cut and summarized. */
async function toOutput(raw: { kind: string; value: unknown }): Promise<ExecOutput> {
  const kind = (OUTPUT_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as OutputKind) : 'text'
  switch (kind) {
    case 'geo.features': {
      const fc = raw.value as { features?: unknown[] }
      const bbox = bboxOfGeoJson(fc)
      const uploadId = await upload(JSON.stringify(fc), 'output.geojson', 'application/geo+json')
      return { kind, uploadId, ...(bbox && { bbox }), summary: summarizeOutput(kind, fc, { features: fc.features?.length ?? 0, ...(bbox && { bbox }) }) }
    }
    case 'image.png':
      return { kind, uploadId: await upload(base64Bytes(String(raw.value)), 'output.png', 'image/png'), summary: summarizeOutput(kind, null) }
    case 'table': {
      const { value, truncated } = capTable(tableValue.parse(raw.value))
      return { kind, value, ...(truncated && { truncated }), summary: summarizeOutput(kind, value, { truncated }) }
    }
    case 'number':
      return { kind, value: raw.value, summary: summarizeOutput(kind, raw.value) }
    default: {
      const { value, truncated } = capText(kind === 'json' ? JSON.stringify(raw.value) : String(raw.value))
      const v = kind === 'json' && !truncated ? raw.value : value
      return { kind: truncated ? 'text' : kind, value: v, ...(truncated && { truncated }), summary: summarizeOutput(kind, v, { truncated }) }
    }
  }
}

export const codeExecuteTool = defineTool({
  ...codeExecuteSpec,
  async run({ source, fresh }): Promise<ExecResult> {
    const session = hubSession()
    if (!session) throw new Error(hubState().error ?? 'Running code needs a JupyterHub login in this browser: connect one in Settings (the gear in the user menu).')
    const kept = memo.get(source)
    if (!fresh && kept && Date.now() - kept.at < MEMO_MS) return kept.result
    const raw = await session.run(source, { timeoutMs: RUN_TIMEOUT_MS })
    let result: ExecResult
    if (raw.error) result = { ok: false, error: raw.error, stdout: raw.stdout, ms: raw.ms }
    else {
      try {
        result = { ok: true, ...(raw.output && { output: await toOutput(raw.output) }), stdout: raw.stdout, ms: raw.ms }
      } catch (err) {
        // E.g. features larger than an upload may be.
        result = { ok: false, error: { ename: 'OutputError', evalue: (err as Error).message, traceback: [] }, stdout: raw.stdout, ms: raw.ms }
      }
    }
    if (result.ok) memo.set(source, { at: Date.now(), result })
    return result
  },
})
