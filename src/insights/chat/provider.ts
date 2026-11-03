/**
 * Which chat provider answers, and the one function that runs it safely.
 *
 * Today: the local rule-based engine. Later, a backend endpoint (for example
 * POST /api/assistant/chat on the AutoTwin backend, holding the model's API key)
 * can be registered here. Whatever answers:
 *   - its text goes through the same guardrails as the explanations;
 *   - any change it proposes is cleaned (known parameters, values in range) and
 *     re-checked by the validation engine before you see numbers for it;
 *   - if it fails or breaks a rule, the local answer is used instead.
 */
import type { ComponentId } from '../../workspace/designs.ts';
import type { InsightSource } from '../context.ts';
import { paramMeta } from '../designAccess.ts';
import { checkText } from '../explain/guardrails.ts';
import { localReply } from './engine.ts';
import type { Patch } from './optimizer.ts';
import type { ChatAction, ChatProvider, ChatReply, ChatRequest } from './types.ts';

export function localChatProvider(getSrc: () => InsightSource): ChatProvider {
  return {
    id: 'local-rules',
    label: 'Local assistant (rule-based, offline)',
    deterministic: true,
    reply: async (req) => localReply(req.question, getSrc(), req.ctx, req.plan),
  };
}

/** Drops parameters that don't exist and values outside the model's range. */
export function sanitisePatch(component: ComponentId, patch: Patch): Patch {
  const out: Patch = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    const meta = paramMeta(component, k);
    if (meta.options) {
      if (meta.options.some((o) => o.id === v)) out[k] = v;
    } else if (meta.spec && typeof v === 'number' && Number.isFinite(v) && v >= meta.spec.min - 1e-9 && v <= meta.spec.max + 1e-9) {
      out[k] = v;
    }
  }
  return out;
}

function sanitiseActions(component: ComponentId, actions: ChatAction[] = []): ChatAction[] {
  const out: ChatAction[] = [];
  for (const a of actions.slice(0, 8)) {
    if (a.kind === 'preview' || a.kind === 'plan-add' || a.kind === 'apply') {
      const patch = sanitisePatch(component, a.patch);
      if (Object.keys(patch).length || (a.kind === 'preview' && !Object.keys(a.patch ?? {}).length)) out.push({ ...a, patch });
    } else if (a.kind === 'ask' && typeof a.question === 'string' && a.question.length < 200) out.push(a);
    else if (a.kind === 'finalize' || a.kind === 'undo') out.push(a);
  }
  return out;
}

export interface GuardedReply {
  reply: ChatReply;
  providerId: string;
  fellBack: boolean;
  violations: string[];
}

export async function replyWithGuardrails(provider: ChatProvider, req: ChatRequest, local: ChatProvider, signal?: AbortSignal): Promise<GuardedReply> {
  const component = req.ctx.component;
  const fallback = async (violations: string[]): Promise<GuardedReply> => ({
    reply: await local.reply(req),
    providerId: provider.id,
    fellBack: provider.id !== local.id,
    violations,
  });
  let raw: ChatReply;
  try {
    raw = await provider.reply(req, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallback([`provider error: ${(e as Error)?.message ?? String(e)}`]);
  }
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 4000) return fallback(['reply missing or too long']);
  const violations = checkText(req.ctx, raw.text);
  if (violations.length) return fallback(violations);
  const table =
    raw.table && Array.isArray(raw.table.head) && Array.isArray(raw.table.rows)
      ? { head: raw.table.head.map(String).slice(0, 6), rows: raw.table.rows.slice(0, 20).map((r) => r.map(String).slice(0, 6)) }
      : undefined;
  return { reply: { text: raw.text, table, actions: sanitiseActions(component, raw.actions) }, providerId: provider.id, fellBack: false, violations: [] };
}
