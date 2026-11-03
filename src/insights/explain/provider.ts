/**
 * Which explanation provider AI Insights uses, and the one function that runs
 * it safely.
 *
 * Today there is only the local template provider. To add a language model
 * later (for example a free-tier Gemini model):
 *
 *   1. On the AutoTwin backend, add POST /api/insights/explain. It receives the
 *      InsightContext JSON from this app, asks the model to explain it using
 *      only the facts given, and returns an Explanation. The API key lives in
 *      the backend's environment, never here: anything shipped to the browser
 *      is public.
 *   2. Here, add a provider whose explain() POSTs the context to that endpoint,
 *      and register it in PROVIDERS.
 *   3. Nothing else changes. Verdicts still come from validation.ts, and every
 *      response still goes through guardExplanation(); if it fails, times out or
 *      breaks a guardrail, the user gets the local text instead.
 */
import type { Explanation, ExplanationProvider, InsightContext } from '../types.ts';
import { guardExplanation, requiredCaveats } from './guardrails.ts';
import { explainLocally, localRulesProvider } from './localProvider.ts';

const PROVIDERS: Record<string, ExplanationProvider> = {
  [localRulesProvider.id]: localRulesProvider,
};

/** The provider in use. Only the local one exists in this build. */
export function activeProvider(): ExplanationProvider {
  return PROVIDERS['local-rules'];
}

export interface GuardedExplanation {
  explanation: Explanation;
  /** The provider that was asked. */
  providerId: string;
  /** True when the provider's answer was replaced by the local text. */
  fellBack: boolean;
  /** Guardrail rules the provider's answer broke, if any. */
  violations: string[];
  error?: string;
}

/** The app's own caveats are always shown, whatever a provider returns. */
function withRequiredCaveats(ctx: InsightContext, exp: Explanation): Explanation {
  const caveats = [...requiredCaveats(ctx)];
  for (const c of exp.caveats) if (!caveats.includes(c)) caveats.push(c);
  return { ...exp, caveats };
}

export async function explainWithGuardrails(
  provider: ExplanationProvider,
  ctx: InsightContext,
  signal?: AbortSignal,
): Promise<GuardedExplanation> {
  const local = () => withRequiredCaveats(ctx, explainLocally(ctx));
  let raw: Explanation;
  try {
    raw = await provider.explain(ctx, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { explanation: local(), providerId: provider.id, fellBack: true, violations: [], error: (e as Error)?.message ?? String(e) };
  }
  const { explanation, violations } = guardExplanation(ctx, raw);
  if (violations.length) return { explanation: local(), providerId: provider.id, fellBack: true, violations };
  return { explanation: withRequiredCaveats(ctx, explanation), providerId: provider.id, fellBack: false, violations: [] };
}
