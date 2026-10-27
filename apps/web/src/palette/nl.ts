import {
  warmUp,
  buildContext,
  ChainExtractor,
  propose,
  RemoteDecider,
  RemoteEmbedder,
  RemoteExtractor,
  RuleExtractor,
  type PipelineConfig,
  type Proposal,
} from '@geo-canvas/nl'
import type { CanvasRuntime, TargetRef } from '@geo-canvas/core'

/** Browser NL config: rules run here; Jev, the LLM fallback, and the embedder go through the gateway. */
const GATEWAY = '/nl'
export const nlConfig: Omit<PipelineConfig, 'onStep'> = {
  decider: new RemoteDecider(GATEWAY),
  extractor: new ChainExtractor([new RuleExtractor(), new RemoteExtractor(GATEWAY)]),
  embedder: new RemoteEmbedder(GATEWAY),
}

export function askNl(runtime: CanvasRuntime, target: TargetRef, utterance: string, onStep: (s: string) => void): Promise<Proposal> {
  return propose(buildContext(runtime, target, utterance), { ...nlConfig, onStep })
}

/** Prepare retrieval in the background. Errors are ignored (the gateway may be off). */
export function warmNl(runtime: CanvasRuntime, target: TargetRef) {
  void warmUp(buildContext(runtime, target, ''), nlConfig.embedder).catch(() => {})
}

/** Labeled sample for training small models later (plans/plan-003.md, section 8). */
export function logNl(entry: {
  proposal: Proposal
  accepted: boolean
  final?: { opId: string; target: TargetRef; args: unknown }
}) {
  const { proposal, ...rest } = entry
  const body = {
    utterance: proposal.utterance,
    proposal: { opId: proposal.opId, target: proposal.target, args: proposal.args, fields: proposal.fields, opConfidence: proposal.opConfidence, alternatives: proposal.alternatives },
    trace: proposal.trace.map((t) => ({ step: t.step, backend: t.backend, ms: t.ms })),
    edited: rest.final ? JSON.stringify(rest.final.args) !== JSON.stringify(proposal.args) || rest.final.opId !== proposal.opId : undefined,
    ...rest,
  }
  void fetch(`${GATEWAY}/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
}
