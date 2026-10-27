import type { TargetRef } from '@geo-canvas/core'

// ---------- Decision questions (same shape as the Jev primitives) ----------

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }

export type Answer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'noul'; noul: number }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> }

/**
 * Answers narrow typed questions about one `state` text.
 * Batch-shaped: Jev answers many questions in one request. A small-model backend
 * can answer them one by one, each as a (state, question) pair.
 */
export interface Decider {
  readonly name: string
  ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>>
}

/** Vector retrieval (bi-encoder shape). */
export interface Embedder {
  readonly name: string
  embed(texts: string[]): Promise<number[][]>
}

// ---------- Fields and extraction ----------

export type ExtractKind = 'number' | 'years' | 'km' | 'factor' | 'percent' | 'entity' | 'text' | 'none'

/** One op arg, as the NL pipeline sees it. Comes from the zod JSON Schema plus `nl` hints. */
export interface FieldSpec {
  name: string
  type: 'number' | 'integer' | 'string' | 'boolean' | 'enum' | 'object' | 'array' | 'unknown'
  title: string
  description?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  default?: unknown
  required: boolean
  /** How to fill the field from text. From meta { nl: { extract } }, else from the type. */
  extract: ExtractKind
  /** Entity resolver id for extract 'entity', e.g. 'disasters.event'. */
  entity?: string
  examples?: string[]
  /** Plain-language names for enum values, e.g. { arc: 'pie or donut chart' }. */
  labels?: Record<string, string>
}

export interface ExtractResult {
  value?: unknown
  /** The words in the utterance that gave the value. */
  span?: string
  confidence: number
}

/**
 * Finds values for fields in a text (QA / token-classification shape).
 * Batch-shaped for the same reason as Decider.
 */
export interface Extractor {
  readonly name: string
  extract(text: string, fields: FieldSpec[]): Promise<Record<string, ExtractResult>>
}

/** Finds candidate entities for a text, e.g. disaster events that match "the 2019 Khulna cyclone". */
export interface EntityCandidate {
  id: string
  label: string
}
export type EntitySearch = (entity: string, query: string, limit: number) => Promise<EntityCandidate[]>

// ---------- Context and result ----------

export interface OpCandidate {
  /** Unique key: '<opId>@<scopeIndex>'. */
  key: string
  opId: string
  title: string
  description: string
  examples: string[]
  scopeKind: 'selection' | 'group' | 'canvas'
  scopeLabel: string
  target: TargetRef
  fields: FieldSpec[]
  /** Args the form would start with (op defaults for this target). */
  defaults: Record<string, unknown>
}

export interface NlContext {
  utterance: string
  /** Short text about the selection and its groups, for the decider state. */
  selectionSummary: string
  candidates: OpCandidate[]
  searchEntities?: EntitySearch
}

export interface FieldDecision {
  value: unknown
  confidence: number
  source: 'decider' | 'extractor' | 'entity' | 'default'
  span?: string
}

export interface TraceEntry {
  step: string
  backend: string
  ms: number
  input?: unknown
  output?: unknown
}

export interface Proposal {
  utterance: string
  /** 'none' when no command matches. */
  opId: string | 'none'
  target: TargetRef
  args: Record<string, unknown>
  opConfidence: number
  /** Best other commands, for "did you mean". */
  alternatives: { opId: string; key: string; title: string; p: number }[]
  fields: Record<string, FieldDecision>
  trace: TraceEntry[]
}
