/**
 * Chat provider that asks a Groq-hosted model (through the AutoTwin backend)
 * to word the answer. The backend holds the API key; this file never sees it.
 *
 * Only the prose comes from the model. The table and the action buttons
 * (Show in 3D, Add to plan, Apply) are still computed by the local rule engine,
 * and replyWithGuardrails() checks the model's text before it is shown.
 */
import { API_BASE } from '../../api/client';
import type { InsightContext } from '../types';
import type { ChatProvider } from './types';

export interface GroqStatus {
  available: boolean;
  model: string | null;
}

export async function fetchGroqStatus(signal?: AbortSignal): Promise<GroqStatus> {
  const res = await fetch(`${API_BASE}/api/assistant/chat/status`, { signal });
  if (!res.ok) return { available: false, model: null };
  const data = (await res.json()) as Partial<GroqStatus>;
  return { available: !!data.available, model: data.model ?? null };
}

/** The parts of the insight context a model needs, without bulk it doesn't. */
export function compactContext(ctx: InsightContext) {
  const rules = (slot: 'A' | 'B') =>
    ctx.validation[slot].results.map((r) => ({
      check: r.label,
      requirement: r.requirement,
      value: Number(r.value.toFixed(r.digits)),
      limit: Number(r.limit.toFixed(r.digits)),
      unit: r.unit,
      status: r.status === 'review' ? 'NEEDS REVIEW' : r.status.toUpperCase(),
      marginPct: Number((r.margin * 100).toFixed(1)),
      drivenBy: r.parameters,
      note: r.reviewReason,
    }));
  return {
    component: ctx.componentLabel,
    fidelity: ctx.fidelity,
    loadCaseAndLimits: ctx.loadCase,
    revisions: ctx.revisions,
    verdicts: {
      A: { verdict: ctx.validation.A.verdict, counts: ctx.validation.A.counts },
      B: { verdict: ctx.validation.B.verdict, counts: ctx.validation.B.counts },
    },
    checksA: rules('A'),
    checksB: rules('B'),
    whatDrivesBFailures: Object.values(ctx.attributions).map((a) => ({
      check: a.ruleId,
      changedFromA: a.changes.map((c) => `${c.label}: ${c.fromText} → ${c.toText}`),
      mainDriver: a.mainDriver,
    })),
    findings: ctx.findings.map((f) => f.text),
    recommendations: ctx.recommendations.map((r) => ({ change: r.title, verdictAfter: r.verdictAfter, why: r.rationale })),
    facts: ctx.facts.map((f) => ({ quantity: f.label, A: Number(f.A.toFixed(f.digits)), B: Number(f.B.toFixed(f.digits)), unit: f.unit })),
    designs: ctx.designs,
  };
}

export function groqChatProvider(local: ChatProvider, model: string): ChatProvider {
  return {
    id: 'groq',
    label: `Groq · ${model}`,
    deterministic: false,
    reply: async (req, opts) => {
      // Numbers, tables and buttons always come from the rules.
      const computed = await local.reply(req);
      const res = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: 'POST',
        signal: opts?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: req.question,
          history: req.history.slice(-8).map((h) => ({ role: h.role, text: h.text.slice(0, 2000) })),
          context: compactContext(req.ctx),
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          detail = ((await res.json()) as { detail?: string }).detail ?? detail;
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }
      const data = (await res.json()) as { text?: string };
      return { text: String(data.text ?? ''), table: computed.table, actions: computed.actions };
    },
  };
}
