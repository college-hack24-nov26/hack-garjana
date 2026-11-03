/**
 * Chat state for AI Insights: the conversation for each component, the draft
 * plan (changes to design B that are not applied yet) and the decisions you
 * finalized. Saved in this browser only, like the workspace.
 */
import { SimStore } from '../../core/SimStore.ts';
import type { ComponentId } from '../../workspace/designs.ts';
import type { Verdict } from '../../workspace/validation.ts';
import type { Patch } from './optimizer.ts';
import type { ChatMessage } from './types.ts';

export interface DecisionRecord {
  id: string;
  t: number;
  component: ComponentId;
  revisionB: string;
  /** Plain-language changes applied with the decision, e.g. "bridge thickness 18.0 mm → 23.0 mm". */
  changes: string[];
  verdictBefore: Verdict;
  verdictAfter: Verdict;
  counts: Record<Verdict, number>;
  /** The questions asked in the chat before deciding. */
  questions: string[];
}

interface Saved {
  version: 1;
  messages: Record<ComponentId, ChatMessage[]>;
  plans: Record<ComponentId, Patch>;
  decisions: DecisionRecord[];
}

const KEY = 'autotwin.chat.v1';
const MAX_MESSAGES = 80;
const MAX_DECISIONS = 30;

const empty = <T,>(make: () => T): Record<ComponentId, T> => ({ 'brake-caliper': make(), 'spark-plug': make() });

export class ChatStore extends SimStore {
  messages = empty<ChatMessage[]>(() => []);
  plans = empty<Patch>(() => ({}));
  decisions: DecisionRecord[] = [];
  /** True while a provider is answering. */
  busy = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(load = true) {
    super();
    if (load) this.load();
  }

  add(msg: Omit<ChatMessage, 'id' | 't'>) {
    const full: ChatMessage = { ...msg, id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, t: Date.now() };
    this.messages = { ...this.messages, [msg.component]: [...this.messages[msg.component], full].slice(-MAX_MESSAGES) };
    this.changed();
    return full;
  }
  clear(c: ComponentId) {
    this.messages = { ...this.messages, [c]: [] };
    this.changed();
  }
  setBusy(b: boolean) {
    this.busy = b;
    this.emit();
  }

  addToPlan(c: ComponentId, patch: Patch) {
    this.plans = { ...this.plans, [c]: { ...this.plans[c], ...patch } };
    this.changed();
  }
  removeFromPlan(c: ComponentId, key: string) {
    const next = { ...this.plans[c] };
    delete next[key];
    this.plans = { ...this.plans, [c]: next };
    this.changed();
  }
  clearPlan(c: ComponentId) {
    this.plans = { ...this.plans, [c]: {} };
    this.changed();
  }

  recordDecision(rec: Omit<DecisionRecord, 'id' | 't'>) {
    const full: DecisionRecord = { ...rec, id: `d-${Date.now().toString(36)}`, t: Date.now() };
    this.decisions = [full, ...this.decisions].slice(0, MAX_DECISIONS);
    this.changed();
    return full;
  }

  /** User questions asked so far for a component, newest last. */
  questions(c: ComponentId) {
    return this.messages[c].filter((m) => m.role === 'user').map((m) => m.text);
  }

  private changed() {
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  private save() {
    try {
      const s: Saved = { version: 1, messages: this.messages, plans: this.plans, decisions: this.decisions };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage blocked or full: the chat still works for this session */
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Saved>;
      if (s.version !== 1) return;
      if (s.messages) this.messages = { ...this.messages, ...s.messages };
      if (s.plans) this.plans = { ...this.plans, ...s.plans };
      if (Array.isArray(s.decisions)) this.decisions = s.decisions;
    } catch {
      /* ignore unreadable storage */
    }
  }
}
