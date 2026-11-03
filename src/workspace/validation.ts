/**
 * Validation engine: the one place that decides PASS, NEEDS REVIEW or FAIL.
 *
 * Every rule compares one number from the estimators against one configured
 * limit. It's deterministic: the same design and limits always give the same
 * verdict. Design Lab, Dashboard, Experiment and AI Insights all call this, and
 * nothing downstream (findings, recommendations, explanation text, a future
 * language model) can change a verdict.
 *
 *   PASS          inside the limit, with margin to spare
 *   NEEDS REVIEW  inside the limit but closer than the estimate's own
 *                 uncertainty, or a condition that calls for an engineer's look
 *   FAIL          the limit is violated
 *
 * The numbers are reduced-order estimates checked against demo limits. A PASS
 * here is not a finite-element or test result.
 */
import { CALIPER_MATERIALS, PLUG_IDLE, PLUG_SWEEP_RPM, TIP_WINDOW_C, findMaterial } from './designs.ts';
import type { CaliperDesign, CaliperInputs, ComponentId, PlugDesign, PlugInputs, Slot } from './designs.ts';
import { caliperEstimate, pistonRowLengthMm, plugEstimate } from './estimators.ts';
import type { CaliperEstimate, PlugEstimate } from './estimators.ts';

export type Verdict = 'pass' | 'review' | 'fail';

export const VERDICT_LABEL: Record<Verdict, string> = { pass: 'PASS', review: 'NEEDS REVIEW', fail: 'FAIL' };
const RANK: Record<Verdict, number> = { pass: 0, review: 1, fail: 2 };
export const worse = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);
export const verdictRank = (v: Verdict) => RANK[v];

/** Brake-balance tolerance: how far B's clamp force may move from A's before it's flagged. */
export const CLAMP_BALANCE_TOLERANCE_PCT = 10;

export interface RuleResult {
  ruleId: string;
  /** What is checked, e.g. "Peak bridge stress". */
  label: string;
  /** The requirement in words, e.g. "≤ allowable von Mises stress". */
  requirement: string;
  value: number;
  limit: number;
  unit: string;
  digits: number;
  /** 'max': the value must stay at or below the limit. 'min': at or above it. */
  kind: 'max' | 'min';
  status: Verdict;
  /** Signed margin as a fraction of the limit. Positive = safe side, negative = violated by that much. */
  margin: number;
  /** Amount over the limit in the rule's unit (only when violated, otherwise 0). */
  excess: number;
  /** Where the value comes from. */
  basis: 'estimated' | 'geometric' | 'baseline';
  /** Where the limit comes from. */
  limitSource: string;
  /** Design parameters that drive this value. */
  parameters: string[];
  /** Why the rule exists, in one or two sentences. */
  why: string;
  /** Set when the status is NEEDS REVIEW, or when a violation is only flagged for review. */
  reviewReason?: string;
}

export interface DesignValidation {
  component: ComponentId;
  slot: Slot;
  revision: string;
  verdict: Verdict;
  results: RuleResult[];
  counts: Record<Verdict, number>;
}

interface RuleDef<C> {
  id: string;
  label: string;
  requirement: string;
  unit: string;
  digits: number;
  kind: 'max' | 'min';
  basis: RuleResult['basis'];
  parameters: string[];
  why: string;
  limitSource: (c: C) => string;
  applies?: (c: C) => boolean;
  value: (c: C) => number;
  limit: (c: C) => number;
  /** Passing values closer than this to the limit still need review. Relative to the limit unless `reviewAbs` is set. */
  reviewBand?: number;
  reviewAbs?: number;
  reviewNote?: string;
  /** What a violated limit means: a failure, or only a flag for review. */
  onViolation: 'fail' | 'review';
  violationNote?: string;
}

function evaluate<C>(rule: RuleDef<C>, c: C): RuleResult {
  const value = rule.value(c);
  const limit = rule.limit(c);
  const gap = rule.kind === 'max' ? limit - value : value - limit; // positive = safe side
  const margin = gap / Math.max(Math.abs(limit), 1e-12);
  let status: Verdict = 'pass';
  let reviewReason: string | undefined;
  if (!Number.isFinite(value)) {
    status = 'review';
    reviewReason = 'The estimate could not produce a number for this design, so the check did not run. A check that did not run is not a pass.';
  } else if (gap < 0) {
    status = rule.onViolation;
    if (rule.onViolation === 'review') reviewReason = rule.violationNote;
  } else if (rule.reviewAbs !== undefined ? gap < rule.reviewAbs : margin < (rule.reviewBand ?? 0)) {
    status = 'review';
    reviewReason = rule.reviewNote;
  }
  return {
    ruleId: rule.id,
    label: rule.label,
    requirement: rule.requirement,
    value,
    limit,
    unit: rule.unit,
    digits: rule.digits,
    kind: rule.kind,
    status,
    margin,
    excess: gap < 0 ? -gap : 0,
    basis: rule.basis,
    limitSource: rule.limitSource(c),
    parameters: rule.parameters,
    why: rule.why,
    reviewReason,
  };
}

function summarise(component: ComponentId, slot: Slot, revision: string, results: RuleResult[]): DesignValidation {
  const counts: Record<Verdict, number> = { pass: 0, review: 0, fail: 0 };
  let verdict: Verdict = 'pass';
  for (const r of results) {
    counts[r.status]++;
    verdict = worse(verdict, r.status);
  }
  return { component, slot, revision, verdict, results, counts };
}

/* ------------------------------------------------------------------ */
/*  Brake caliper rules                                                */
/* ------------------------------------------------------------------ */

export interface CaliperRuleContext {
  design: CaliperDesign;
  inputs: CaliperInputs;
  est: CaliperEstimate;
  /** Design A, when validating the candidate against it. */
  baseline?: { design: CaliperDesign; est: CaliperEstimate };
}

export const CALIPER_RULES: RuleDef<CaliperRuleContext>[] = [
  {
    id: 'cal.stress',
    label: 'Peak bridge stress',
    requirement: '≤ allowable von Mises stress',
    unit: 'MPa',
    digits: 1,
    kind: 'max',
    basis: 'estimated',
    parameters: ['bridgeMm', 'ribCount', 'ribMm', 'bodyLengthMm', 'slotDepthFrac', 'bodyHeightMm', 'pistonBoreMm', 'pistonsPerSide'],
    why: 'The clamp force pushes the two caliper halves apart and bends the bridge. Too much stress and the bridge yields or cracks.',
    limitSource: () => 'Allowable von Mises stress (demo limit)',
    value: (c) => c.est.peakStressMPa,
    limit: (c) => c.inputs.allowableStressMPa,
    reviewBand: 0.2,
    reviewNote: 'Within 20 % of the allowable. The beam estimate reads stress low (it cannot see the concentrations at the bores), so this needs a solver check.',
    onViolation: 'fail',
  },
  {
    id: 'cal.fos',
    label: 'Factor of safety on yield',
    requirement: '≥ minimum factor of safety',
    unit: '–',
    digits: 2,
    kind: 'min',
    basis: 'estimated',
    parameters: ['materialId', 'bridgeMm', 'ribCount', 'ribMm', 'bodyLengthMm', 'slotDepthFrac', 'pistonBoreMm', 'pistonsPerSide'],
    why: "The allowable stress is one fixed number. This checks the margin against the selected material's own yield strength, so a weaker material can't pass on a generous allowable.",
    limitSource: (c) => `Minimum factor of safety (demo limit), yield ${findMaterial(CALIPER_MATERIALS, c.design.materialId).yieldMPa} MPa`,
    value: (c) => c.est.factorOfSafety,
    limit: (c) => c.inputs.minFoS,
    reviewBand: 0.15,
    reviewNote: 'Within 15 % of the minimum. The estimate reads stress low, so the real margin is likely smaller.',
    onViolation: 'fail',
  },
  {
    id: 'cal.mouth',
    label: 'Mouth opening',
    requirement: '≤ allowable mouth opening',
    unit: 'mm',
    digits: 3,
    kind: 'max',
    basis: 'estimated',
    parameters: ['materialId', 'bridgeMm', 'ribCount', 'ribMm', 'discSlotMm', 'legWallMm', 'slotDepthFrac', 'bodyHeightMm', 'pistonBoreMm', 'pistonsPerSide'],
    why: 'When the caliper mouth spreads under the clamp load, the pistons have to travel further: a longer, softer pedal and uneven pad wear.',
    limitSource: () => 'Allowable mouth opening (demo limit)',
    value: (c) => c.est.mouthOpeningMm,
    limit: (c) => c.inputs.allowableMouthMm,
    reviewBand: 0.2,
    reviewNote: 'Within 20 % of the limit. Treating the legs as rigid makes the opening read low, so this needs a solver check.',
    onViolation: 'fail',
  },
  {
    id: 'cal.leg-wall',
    label: 'Leg wall thickness',
    requirement: '≥ minimum manufacturable wall',
    unit: 'mm',
    digits: 1,
    kind: 'min',
    basis: 'geometric',
    parameters: ['legWallMm'],
    why: 'Walls thinner than the foundry can reliably cast come out porous or incomplete.',
    limitSource: () => 'Minimum manufacturable wall (demo limit)',
    value: (c) => c.design.legWallMm,
    limit: (c) => c.inputs.minWallMm,
    reviewBand: 0.1,
    reviewNote: 'Within 10 % of the minimum: casting tolerance can take it under.',
    onViolation: 'fail',
  },
  {
    id: 'cal.bridge-wall',
    label: 'Bridge thickness',
    requirement: '≥ minimum manufacturable wall',
    unit: 'mm',
    digits: 1,
    kind: 'min',
    basis: 'geometric',
    parameters: ['bridgeMm'],
    why: 'Walls thinner than the foundry can reliably cast come out porous or incomplete.',
    limitSource: () => 'Minimum manufacturable wall (demo limit)',
    value: (c) => c.design.bridgeMm,
    limit: (c) => c.inputs.minWallMm,
    reviewBand: 0.1,
    reviewNote: 'Within 10 % of the minimum: casting tolerance can take it under.',
    onViolation: 'fail',
  },
  {
    id: 'cal.rib-wall',
    label: 'Rib thickness',
    requirement: '≥ minimum manufacturable wall',
    unit: 'mm',
    digits: 1,
    kind: 'min',
    basis: 'geometric',
    parameters: ['ribMm'],
    why: 'Ribs are walls too: below the minimum they cast badly.',
    limitSource: () => 'Minimum manufacturable wall (demo limit)',
    applies: (c) => c.design.ribCount > 0,
    value: (c) => c.design.ribMm,
    limit: (c) => c.inputs.minWallMm,
    reviewBand: 0.1,
    reviewNote: 'Within 10 % of the minimum: casting tolerance can take it under.',
    onViolation: 'fail',
  },
  {
    id: 'cal.piston-fit',
    label: 'Body length for the pistons',
    requirement: '≥ length the piston row needs',
    unit: 'mm',
    digits: 0,
    kind: 'min',
    basis: 'geometric',
    parameters: ['bodyLengthMm', 'pistonBoreMm', 'pistonsPerSide'],
    why: 'Each bore needs solid metal around it. A piston row longer than the body cannot be machined.',
    limitSource: () => 'Bores plus a 6 mm ligament between and outside them',
    value: (c) => c.design.bodyLengthMm,
    limit: (c) => pistonRowLengthMm(c.design),
    reviewBand: 0.03,
    reviewNote: 'Less than 3 % spare length around the piston row.',
    onViolation: 'fail',
  },
  {
    id: 'cal.slot-depth',
    label: 'Disc slot depth for the pads',
    requirement: '≥ pad radial height',
    unit: 'mm',
    digits: 1,
    kind: 'min',
    basis: 'geometric',
    parameters: ['bodyHeightMm', 'slotDepthFrac'],
    why: 'The pads sit inside the disc slot. A slot shallower than the pads cannot hold them over their full height.',
    limitSource: () => 'Pad radial height (demo limit)',
    value: (c) => c.design.bodyHeightMm * c.design.slotDepthFrac,
    limit: (c) => c.inputs.padHeightMm,
    reviewBand: 0.05,
    reviewNote: 'Less than 5 % deeper than the pads.',
    onViolation: 'fail',
  },
  {
    id: 'cal.clamp-balance',
    label: 'Clamp force vs baseline',
    requirement: `within ±${CLAMP_BALANCE_TOLERANCE_PCT} % of design A`,
    unit: '%',
    digits: 1,
    kind: 'max',
    basis: 'baseline',
    parameters: ['pistonBoreMm', 'pistonsPerSide'],
    why: 'Piston area sets brake torque for a given line pressure. A large change shifts front/rear brake balance and pedal feel, so the rest of the brake system has to be re-checked.',
    limitSource: () => 'Brake-balance tolerance (demo limit)',
    applies: (c) => !!c.baseline,
    value: (c) => Math.abs(c.est.clampForceN / c.baseline!.est.clampForceN - 1) * 100,
    limit: () => CLAMP_BALANCE_TOLERANCE_PCT,
    onViolation: 'review',
    violationNote: 'The caliper itself can still be fine; the brake balance and pedal feel need re-checking.',
  },
];

export function validateCaliper(
  slot: Slot,
  design: CaliperDesign,
  inputs: CaliperInputs,
  baseline?: CaliperDesign,
): DesignValidation {
  const ctx: CaliperRuleContext = {
    design,
    inputs,
    est: caliperEstimate(design, inputs),
    baseline: baseline ? { design: baseline, est: caliperEstimate(baseline, inputs) } : undefined,
  };
  const results = CALIPER_RULES.filter((r) => !r.applies || r.applies(ctx)).map((r) => evaluate(r, ctx));
  return summarise('brake-caliper', slot, design.revision, results);
}

/* ------------------------------------------------------------------ */
/*  Spark plug rules                                                   */
/* ------------------------------------------------------------------ */

export interface PlugRuleContext {
  design: PlugDesign;
  inputs: PlugInputs;
  /** At the configured operating point. */
  est: PlugEstimate;
  /** Hottest tip across the full-load speed sweep, °C. */
  sweepMaxC: number;
  /** Tip at idle, °C. */
  idleC: number;
}

const THERMAL_PARAMS = ['noseLengthMm', 'protrusionMm', 'electrodeId', 'electrodeDiaMm', 'noseDiaMm', 'insulatorId'];

export const PLUG_RULES: RuleDef<PlugRuleContext>[] = [
  {
    id: 'plug.tip-min',
    label: 'Tip temperature, operating point',
    requirement: `≥ ${TIP_WINDOW_C.min} °C (self-cleaning)`,
    unit: '°C',
    digits: 0,
    kind: 'min',
    basis: 'estimated',
    parameters: THERMAL_PARAMS,
    why: `Below about ${TIP_WINDOW_C.min} °C, carbon and fuel deposits don't burn off the insulator nose. It fouls and the plug misfires.`,
    limitSource: (c) => `Self-cleaning temperature, at ${c.inputs.rpm} rpm and ${c.inputs.loadPct} % load`,
    value: (c) => c.est.tipTempC,
    limit: () => TIP_WINDOW_C.min,
    reviewAbs: 30,
    reviewNote: 'Within 30 °C of the limit, which is inside the fin estimate’s uncertainty.',
    onViolation: 'fail',
  },
  {
    id: 'plug.tip-max',
    label: 'Tip temperature, operating point',
    requirement: `≤ ${TIP_WINDOW_C.max} °C (pre-ignition)`,
    unit: '°C',
    digits: 0,
    kind: 'max',
    basis: 'estimated',
    parameters: THERMAL_PARAMS,
    why: `Above about ${TIP_WINDOW_C.max} °C the firing end can light the mixture before the spark does (pre-ignition), which can melt a piston.`,
    limitSource: (c) => `Pre-ignition limit, at ${c.inputs.rpm} rpm and ${c.inputs.loadPct} % load`,
    value: (c) => c.est.tipTempC,
    limit: () => TIP_WINDOW_C.max,
    reviewAbs: 30,
    reviewNote: 'Within 30 °C of the limit, which is inside the fin estimate’s uncertainty.',
    onViolation: 'fail',
  },
  {
    id: 'plug.tip-range',
    label: `Hottest tip, full load ${PLUG_SWEEP_RPM.min}–${PLUG_SWEEP_RPM.max} rpm`,
    requirement: `≤ ${TIP_WINDOW_C.max} °C (pre-ignition)`,
    unit: '°C',
    digits: 0,
    kind: 'max',
    basis: 'estimated',
    parameters: THERMAL_PARAMS,
    why: 'The plug has to stay below pre-ignition at the hottest condition the engine can reach, not only at the chosen operating point.',
    limitSource: () => 'Pre-ignition limit, worst case of the full-load speed sweep',
    value: (c) => c.sweepMaxC,
    limit: () => TIP_WINDOW_C.max,
    reviewAbs: 30,
    reviewNote: 'Within 30 °C of the limit at top speed, which is inside the fin estimate’s uncertainty.',
    onViolation: 'fail',
  },
  {
    id: 'plug.tip-idle',
    label: `Tip at idle (${PLUG_IDLE.rpm} rpm, ${PLUG_IDLE.loadPct} % load)`,
    requirement: `≥ ${TIP_WINDOW_C.min} °C (self-cleaning)`,
    unit: '°C',
    digits: 0,
    kind: 'min',
    basis: 'estimated',
    parameters: THERMAL_PARAMS,
    why: 'Long idling below the self-cleaning temperature builds deposits. Most plugs do this, so it is flagged for review rather than failed: the plug cleans itself once driven.',
    limitSource: () => 'Self-cleaning temperature, at idle',
    value: (c) => c.idleC,
    limit: () => TIP_WINDOW_C.min,
    onViolation: 'review',
    violationNote: 'Runs below self-cleaning at idle. Acceptable for most duty cycles, but check it against long-idle use.',
  },
  {
    id: 'plug.insulator-wall',
    label: 'Insulator wall around the electrode',
    requirement: '≥ minimum insulator wall',
    unit: 'mm',
    digits: 2,
    kind: 'min',
    basis: 'geometric',
    parameters: ['noseDiaMm', 'electrodeDiaMm'],
    why: 'The ceramic around the centre electrode has to hold off the ignition voltage (tens of kV) and survive thermal shock. Too thin and it can puncture or crack.',
    limitSource: () => 'Minimum insulator wall (demo limit)',
    value: (c) => (c.design.noseDiaMm - c.design.electrodeDiaMm) / 2,
    limit: (c) => c.inputs.minInsulatorWallMm,
    reviewBand: 0.1,
    reviewNote: 'Within 10 % of the minimum wall.',
    onViolation: 'fail',
  },
];

export function plugContext(design: PlugDesign, inputs: PlugInputs): PlugRuleContext {
  let sweepMaxC = -Infinity;
  for (let rpm = PLUG_SWEEP_RPM.min; rpm <= PLUG_SWEEP_RPM.max; rpm += PLUG_SWEEP_RPM.step) {
    sweepMaxC = Math.max(sweepMaxC, plugEstimate(design, inputs, rpm, 100).tipTempC);
  }
  return {
    design,
    inputs,
    est: plugEstimate(design, inputs),
    sweepMaxC,
    idleC: plugEstimate(design, inputs, PLUG_IDLE.rpm, PLUG_IDLE.loadPct).tipTempC,
  };
}

export function validatePlug(slot: Slot, design: PlugDesign, inputs: PlugInputs): DesignValidation {
  const ctx = plugContext(design, inputs);
  const results = PLUG_RULES.filter((r) => !r.applies || r.applies(ctx)).map((r) => evaluate(r, ctx));
  return summarise('spark-plug', slot, design.revision, results);
}

/* ------------------------------------------------------------------ */

/** Minimal view of the workspace the engine needs (keeps it usable from Node checks). */
export interface ValidationSource {
  caliper: Record<Slot, CaliperDesign>;
  caliperInputs: CaliperInputs;
  plug: Record<Slot, PlugDesign>;
  plugInputs: PlugInputs;
}

/** Validates A and B for one component. B is also checked against A where a rule compares them. */
export function validateBoth(src: ValidationSource, component: ComponentId): Record<Slot, DesignValidation> {
  if (component === 'brake-caliper') {
    return {
      A: validateCaliper('A', src.caliper.A, src.caliperInputs),
      B: validateCaliper('B', src.caliper.B, src.caliperInputs, src.caliper.A),
    };
  }
  return { A: validatePlug('A', src.plug.A, src.plugInputs), B: validatePlug('B', src.plug.B, src.plugInputs) };
}

/** "182.0 MPa vs 165 MPa" style detail for compact lists. */
export const resultDetail = (r: RuleResult) =>
  `${r.value.toFixed(r.digits)} vs ${r.limit.toFixed(r.digits)}${r.unit === '–' ? '' : ' ' + r.unit}`;
