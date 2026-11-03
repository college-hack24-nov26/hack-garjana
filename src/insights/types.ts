/**
 * Contracts for AI Insights. Three layers, each with its own job:
 *
 *   1. Validation (workspace/validation.ts): deterministic PASS / NEEDS REVIEW / FAIL.
 *   2. Rule-based insights (findings.ts, recommendations.ts): what changed, what
 *      drives each failure, and which design change would clear it.
 *   3. Explanation (explain/): turns 1 + 2 into readable text. Today that's a
 *      local template provider; later it can be a language model behind the
 *      AutoTwin backend. It only explains: it never sets a verdict.
 *
 * Everything in InsightContext is plain JSON (no functions, no class instances),
 * so the same object can be sent to a backend explanation endpoint unchanged.
 */
import type { ComponentId, Slot } from '../workspace/designs.ts';
import type { DesignValidation, Verdict } from '../workspace/validation.ts';

export type FindingTone = 'good' | 'info' | 'warn' | 'bad';

export interface Finding {
  id: string;
  tone: FindingTone;
  text: string;
}

/** One design parameter that differs between A and B and feeds a rule. */
export interface DriverChange {
  parameter: string;
  label: string;
  fromText: string;
  toText: string;
  /** The rule's value if only this parameter were put back to design A's value. */
  revertedValue: number;
  revertedStatus: Verdict;
  /** How far reverting moves the value toward the safe side, as a fraction of the limit. */
  effect: number;
}

/** Why a rule on design B is not a clean PASS, in terms of what was changed from A. */
export interface Attribution {
  ruleId: string;
  changes: DriverChange[];
  /** The parameter whose change matters most, if any changed parameter feeds the rule. */
  mainDriver?: string;
}

export interface PredictedRule {
  ruleId: string;
  label: string;
  unit: string;
  digits: number;
  before: { value: number; status: Verdict };
  after: { value: number; status: Verdict };
}

export interface Recommendation {
  id: string;
  /** 'fix' clears a FAIL or NEEDS REVIEW; 'opportunity' is optional (e.g. saving mass while still passing). */
  kind: 'fix' | 'opportunity';
  ruleIds: string[];
  parameter: string;
  parameterLabel: string;
  fromText: string;
  toText: string;
  title: string;
  rationale: string;
  /** The change to apply to design B. */
  patch: Record<string, number | string>;
  /** True when every targeted rule ends up PASS. */
  clears: boolean;
  /** Design B's overall verdict after the change, from the same validation engine. */
  verdictAfter: Verdict;
  predicted: PredictedRule[];
  sideEffects: string[];
}

/** A computed number the explanation may quote. Explanations should only use numbers from here. */
export interface GroundedFact {
  key: string;
  label: string;
  unit: string;
  digits: number;
  A: number;
  B: number;
  source: 'estimate' | 'input' | 'material' | 'geometry';
}

export interface InsightContext {
  component: ComponentId;
  componentLabel: string;
  revisions: Record<Slot, string>;
  validation: Record<Slot, DesignValidation>;
  attributions: Record<string, Attribution>;
  findings: Finding[];
  recommendations: Recommendation[];
  facts: GroundedFact[];
  /** Both designs' parameters, as plain values (so a backend model can talk about them). */
  designs: Record<Slot, Record<string, number | string>>;
  /** The load case and limits in force. */
  inputs: Record<string, number>;
  /** The load case and limits in one line, e.g. "10 MPa line pressure · allowable 165 MPa · …". */
  loadCase: string;
  /** What the numbers are (fidelity statement). */
  fidelity: string;
}

/**
 * Explanation text for one InsightContext. Same fields as the AutoTwin
 * backend's explanation contract (generator, headline, paragraphs, caveats,
 * method statement), plus per-rule and per-recommendation text.
 */
export interface Explanation {
  generator: string;
  generatorLabel: string;
  /** True for template text, false for a language model. */
  deterministic: boolean;
  headline: string;
  paragraphs: string[];
  /** Keyed by rule id. */
  rules: Record<string, string>;
  /** Keyed by recommendation id. */
  recommendations: Record<string, string>;
  caveats: string[];
  methodStatement: string;
  generatedAt: number;
}

export interface ExplanationProvider {
  readonly id: string;
  readonly label: string;
  readonly deterministic: boolean;
  /** Must resolve with an Explanation for this context. It will be checked by guardExplanation() before use. */
  explain(ctx: InsightContext, opts?: { signal?: AbortSignal }): Promise<Explanation>;
}
