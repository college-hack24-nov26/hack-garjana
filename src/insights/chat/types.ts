/**
 * Chat contracts. A reply is text plus optional actions; every action that
 * changes the design carries a patch, and the app re-checks that patch through
 * the validation engine before showing or applying it. So a future model-based
 * provider can suggest, but the numbers and verdicts always come from here.
 */
import type { ComponentId } from '../../workspace/designs.ts';
import type { InsightContext } from '../types.ts';
import type { Patch } from './optimizer.ts';

export type ChatAction =
  | { kind: 'preview'; label: string; title: string; patch: Patch; why?: string }
  | { kind: 'plan-add'; label: string; title: string; patch: Patch }
  | { kind: 'apply'; label: string; title: string; patch: Patch }
  | { kind: 'ask'; label: string; question: string }
  | { kind: 'finalize'; label: string }
  | { kind: 'undo'; label: string };

export interface ChatTable {
  head: string[];
  rows: string[][];
}

export interface ChatReply {
  text: string;
  table?: ChatTable;
  actions?: ChatAction[];
}

export interface ChatMessage extends ChatReply {
  id: string;
  role: 'user' | 'assistant';
  t: number;
  component: ComponentId;
  /** Which provider wrote an assistant message. */
  source?: string;
}

export interface ChatRequest {
  question: string;
  ctx: InsightContext;
  /** Recent turns, oldest first, so a provider can follow the conversation. */
  history: { role: 'user' | 'assistant'; text: string }[];
  /** The draft plan: changes to design B not applied yet. */
  plan: Patch;
}

export interface ChatProvider {
  readonly id: string;
  readonly label: string;
  readonly deterministic: boolean;
  reply(req: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatReply>;
}
