/**
 * "Optimise B for me": chains the single-change recommendations into a plan.
 *
 * Each step picks the recommendation that most reduces the FAIL and NEEDS
 * REVIEW count, re-validating the whole design after every step. When B passes
 * cleanly, the caliper also takes the optional mass saving. It stops as soon as
 * no step improves things. "Optimal" means optimal within these estimates and
 * these limits, not a solver-verified optimum.
 */
import { caliperEstimate } from '../../workspace/estimators.ts';
import type { CaliperDesign, ComponentId } from '../../workspace/designs.ts';
import type { DesignValidation, ValidationSource, Verdict } from '../../workspace/validation.ts';
import { formatParam, getDesign, paramMeta, paramValue, validateCandidate, withPatch } from '../designAccess.ts';
import type { AnyDesign } from '../designAccess.ts';
import { recommendFixes, recommendOpportunity } from '../recommendations.ts';

export type Patch = Record<string, number | string>;

export interface PlanStep {
  title: string;
  parameter: string;
  fromText: string;
  toText: string;
  verdictAfter: Verdict;
}

export interface Plan {
  component: ComponentId;
  steps: PlanStep[];
  /** All changes relative to the current design B. */
  patch: Patch;
  verdictBefore: Verdict;
  verdictAfter: Verdict;
  countsAfter: Record<Verdict, number>;
  /** Mass before → after, caliper only. */
  massKg?: { before: number; after: number };
  /** Why it stopped where it did. */
  note: string;
}

/** The same source with design B swapped for another one. */
export function withB(src: ValidationSource, component: ComponentId, B: AnyDesign): ValidationSource {
  return component === 'brake-caliper'
    ? { ...src, caliper: { ...src.caliper, B: B as CaliperDesign } }
    : { ...src, plug: { ...src.plug, B: B as ValidationSource['plug']['B'] } };
}

const score = (v: DesignValidation) => v.counts.fail * 100 + v.counts.review * 10;

/** Every parameter that differs between two versions of a design. */
export function diffPatch(from: AnyDesign, to: AnyDesign): Patch {
  const out: Patch = {};
  for (const [k, v] of Object.entries(to as unknown as Record<string, number | string>)) {
    if (k === 'revision') continue;
    if (paramValue(from, k) !== v) out[k] = v;
  }
  return out;
}

export function optimiseCandidate(src: ValidationSource, component: ComponentId, opts: { maxSteps?: number; minimiseMass?: boolean } = {}): Plan {
  const start = getDesign(src, component, 'B');
  let B = start;
  let v = validateCandidate(src, component, B);
  const verdictBefore = v.verdict;
  const steps: PlanStep[] = [];

  for (let i = 0; i < (opts.maxSteps ?? 6) && v.verdict !== 'pass'; i++) {
    const s = withB(src, component, B);
    let best: { design: AnyDesign; v: DesignValidation; title: string; key: string } | null = null;
    let bestScore = score(v);
    for (const rec of recommendFixes(s, component, v)) {
      const design = withPatch(B, rec.patch);
      const nv = validateCandidate(s, component, design);
      if (score(nv) < bestScore) {
        bestScore = score(nv);
        best = { design, v: nv, title: rec.title, key: rec.parameter };
      }
    }
    if (!best) break;
    steps.push({
      title: best.title,
      parameter: best.key,
      fromText: formatParam(component, best.key, paramValue(B, best.key)),
      toText: formatParam(component, best.key, paramValue(best.design, best.key)),
      verdictAfter: best.v.verdict,
    });
    B = best.design;
    v = best.v;
  }

  if (component === 'brake-caliper' && v.verdict === 'pass' && opts.minimiseMass !== false) {
    const opp = recommendOpportunity(withB(src, component, B), component, v);
    if (opp) {
      const design = withPatch(B, opp.patch);
      steps.push({
        title: opp.title,
        parameter: opp.parameter,
        fromText: opp.fromText,
        toText: opp.toText,
        verdictAfter: opp.verdictAfter,
      });
      B = design;
      v = validateCandidate(withB(src, component, B), component, B);
    }
  }

  const open = v.results.filter((r) => r.status !== 'pass').map((r) => r.label.toLowerCase());
  const note =
    v.verdict === 'pass'
      ? 'Every check passes with margin.'
      : steps.length === 0
        ? `No change within the parameter ranges improves ${open.join(', ')} without making another check fail.`
        : `Still open: ${open.join(', ')}. No further single change helps without making another check fail.`;

  return {
    component,
    steps,
    patch: diffPatch(start, B),
    verdictBefore,
    verdictAfter: v.verdict,
    countsAfter: v.counts,
    massKg:
      component === 'brake-caliper'
        ? {
            before: caliperEstimate(start as CaliperDesign, src.caliperInputs).massKg,
            after: caliperEstimate(B as CaliperDesign, src.caliperInputs).massKg,
          }
        : undefined,
    note,
  };
}

/** Plain-language list of a patch, e.g. "bridge thickness 18.0 mm → 23.0 mm". */
export function describePatch(component: ComponentId, from: AnyDesign, patch: Patch): string[] {
  return Object.entries(patch).map(
    ([k, v]) => `${paramMeta(component, k).label.toLowerCase()} ${formatParam(component, k, paramValue(from, k))} → ${formatParam(component, k, v)}`,
  );
}
