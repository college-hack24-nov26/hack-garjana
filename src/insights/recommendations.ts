/**
 * Recommendations: for every check on candidate B that fails or needs review,
 * find the smallest single change that clears it.
 *
 * Each lever is searched in the parameter's own step size and range, and every
 * candidate change is re-run through the same estimators and validation rules.
 * So "predicted verdict after the change" is computed, not guessed. It's still
 * an estimate, though: confirm a change with a solver before relying on it.
 */
import { caliperEstimate } from '../workspace/estimators.ts';
import type { CaliperDesign, ComponentId } from '../workspace/designs.ts';
import { VERDICT_LABEL, verdictRank } from '../workspace/validation.ts';
import type { DesignValidation, RuleResult, ValidationSource, Verdict } from '../workspace/validation.ts';
import { formatParam, getDesign, paramMeta, paramValue, validateCandidate, withPatch } from './designAccess.ts';
import type { AnyDesign } from './designAccess.ts';
import type { PredictedRule, Recommendation } from './types.ts';

interface Lever {
  param: string;
  /** +1 increase, −1 decrease, 0 try both. Ignored for material choices. */
  dir: 1 | -1 | 0;
  why: string;
}

const THICKER_BRIDGE = 'Bending stiffness of the bridge goes with its thickness cubed, so a small increase cuts both stress and mouth opening.';
const MORE_RIBS = 'Ribs deepen the bridge section, which stiffens it far more per kilogram than a thicker plate.';
const THICKER_RIBS = 'Thicker ribs add section depth where it works hardest.';
const LONGER_BODY = 'A longer body makes the bridge wider, so it carries the same moment at lower stress.';
const SHALLOWER_SLOT = 'A shallower slot moves the pad force closer to the bridge, so the bending moment drops.';

const LEVERS: Record<string, Lever[]> = {
  'cal.stress': [
    { param: 'bridgeMm', dir: 1, why: THICKER_BRIDGE },
    { param: 'ribCount', dir: 1, why: MORE_RIBS },
    { param: 'ribMm', dir: 1, why: THICKER_RIBS },
    { param: 'bodyLengthMm', dir: 1, why: LONGER_BODY },
    { param: 'slotDepthFrac', dir: -1, why: SHALLOWER_SLOT },
  ],
  'cal.fos': [
    { param: 'materialId', dir: 0, why: 'A material with a higher yield strength raises the factor of safety without touching the geometry.' },
    { param: 'bridgeMm', dir: 1, why: THICKER_BRIDGE },
    { param: 'ribCount', dir: 1, why: MORE_RIBS },
  ],
  'cal.mouth': [
    { param: 'bridgeMm', dir: 1, why: THICKER_BRIDGE },
    { param: 'ribCount', dir: 1, why: MORE_RIBS },
    { param: 'ribMm', dir: 1, why: THICKER_RIBS },
    { param: 'materialId', dir: 0, why: "A stiffer material (higher Young's modulus) opens less under the same clamp load." },
    { param: 'slotDepthFrac', dir: -1, why: SHALLOWER_SLOT },
  ],
  'cal.leg-wall': [{ param: 'legWallMm', dir: 1, why: 'Bring the wall back to what the foundry can cast reliably.' }],
  'cal.bridge-wall': [{ param: 'bridgeMm', dir: 1, why: 'Bring the bridge back to what the foundry can cast reliably.' }],
  'cal.rib-wall': [{ param: 'ribMm', dir: 1, why: 'Bring the ribs back to what the foundry can cast reliably.' }],
  'cal.piston-fit': [
    { param: 'bodyLengthMm', dir: 1, why: 'A longer body leaves room for the bores and the metal between them.' },
    { param: 'pistonBoreMm', dir: -1, why: 'Smaller bores fit in the same body, but they also lower the clamp force.' },
  ],
  'cal.slot-depth': [
    { param: 'slotDepthFrac', dir: 1, why: 'A deeper slot gives the pads their full height back.' },
    { param: 'bodyHeightMm', dir: 1, why: 'A taller body makes the slot deeper at the same depth fraction.' },
  ],
  'cal.clamp-balance': [
    { param: 'pistonBoreMm', dir: 0, why: "Matching design A's piston area restores the original brake torque, balance and pedal feel." },
  ],
  'plug.tip-max': [
    { param: 'noseLengthMm', dir: -1, why: 'A shorter nose is a shorter path to the cooled shell: the usual way to make a plug colder.' },
    { param: 'electrodeId', dir: 0, why: 'A copper-cored electrode carries heat away from the tip much faster.' },
    { param: 'electrodeDiaMm', dir: 1, why: 'A thicker electrode carries more heat to the seat.' },
    { param: 'protrusionMm', dir: -1, why: 'Less protrusion keeps the firing end out of the hottest gas.' },
    { param: 'insulatorId', dir: 0, why: 'Higher-purity alumina conducts heat to the seat better.' },
  ],
  'plug.tip-min': [
    { param: 'noseLengthMm', dir: 1, why: 'A longer nose lengthens the heat path to the shell, so the tip runs hotter.' },
    { param: 'electrodeId', dir: 0, why: 'A solid nickel electrode carries less heat away, so the tip runs hotter.' },
    { param: 'protrusionMm', dir: 1, why: 'More protrusion puts the firing end further into the hot gas.' },
    { param: 'electrodeDiaMm', dir: -1, why: 'A thinner electrode carries less heat to the seat.' },
  ],
  'plug.insulator-wall': [
    { param: 'electrodeDiaMm', dir: -1, why: 'A thinner electrode leaves more ceramic around it.' },
    { param: 'noseDiaMm', dir: 1, why: 'A wider nose leaves more ceramic around the electrode.' },
  ],
};
LEVERS['plug.tip-range'] = LEVERS['plug.tip-max'];
LEVERS['plug.tip-idle'] = LEVERS['plug.tip-min'];

const MAX_FIXES = 6;

interface Trial {
  value: number | string;
  validation: DesignValidation;
  clears: boolean;
}

const statusOf = (v: DesignValidation, id: string) => v.results.find((r) => r.ruleId === id)?.status ?? 'pass';
const allPass = (v: DesignValidation, ids: string[]) => ids.every((id) => statusOf(v, id) === 'pass');
const noneFail = (v: DesignValidation, ids: string[]) => ids.every((id) => statusOf(v, id) !== 'fail');

/** A change that fixes one check by breaking another is not a fix: this spots that. */
function breaksSomethingElse(before: DesignValidation, after: DesignValidation, targets: string[]) {
  return after.results.some((r) => r.status === 'fail' && !targets.includes(r.ruleId) && statusOf(before, r.ruleId) !== 'fail');
}

/** Walks a numeric parameter in its own steps until the target rules pass (or at least stop failing). */
function searchNumeric(src: ValidationSource, component: ComponentId, B: AnyDesign, key: string, dir: 1 | -1, targets: string[]): Trial | null {
  const spec = paramMeta(component, key).spec;
  if (!spec) return null;
  const start = Number(paramValue(B, key));
  const before = validateCandidate(src, component, B);
  let partial: Trial | null = null;
  for (let i = 1; i <= 400; i++) {
    const raw = start + dir * i * spec.step;
    if (raw < spec.min - 1e-9 || raw > spec.max + 1e-9) break;
    const value = Number((Math.round(raw / spec.step) * spec.step).toFixed(Math.max(spec.digits, 2)));
    const validation = validateCandidate(src, component, withPatch(B, { [key]: value }));
    // Going further this way only makes the new failure worse, so stop here.
    if (breaksSomethingElse(before, validation, targets)) break;
    if (allPass(validation, targets)) return { value, validation, clears: true };
    if (!partial && noneFail(validation, targets)) partial = { value, validation, clears: false };
  }
  return partial;
}

/** Tries every other material for a choice parameter and keeps the best result. */
function searchChoice(src: ValidationSource, component: ComponentId, B: AnyDesign, key: string, targets: string[]): Trial | null {
  const options = paramMeta(component, key).options ?? [];
  const current = paramValue(B, key);
  const before = validateCandidate(src, component, B);
  let best: Trial | null = null;
  let bestScore = Infinity;
  for (const o of options) {
    if (o.id === current) continue;
    const design = withPatch(B, { [key]: o.id });
    const validation = validateCandidate(src, component, design);
    if (breaksSomethingElse(before, validation, targets)) continue;
    const clears = allPass(validation, targets);
    if (!clears && !noneFail(validation, targets)) continue;
    // Prefer clearing, then the best overall verdict, then (for the caliper) the lighter part.
    const mass = component === 'brake-caliper' ? caliperEstimate(design as CaliperDesign, src.caliperInputs).massKg : 0;
    const score = (clears ? 0 : 100) + verdictRank(validation.verdict) * 10 + mass / 100;
    if (score < bestScore) {
      bestScore = score;
      best = { value: o.id, validation, clears };
    }
  }
  return best;
}

function predictedFor(before: DesignValidation, after: DesignValidation, ids: string[]): PredictedRule[] {
  return ids.map((id) => {
    const b = before.results.find((r) => r.ruleId === id) as RuleResult;
    const a = after.results.find((r) => r.ruleId === id) ?? b;
    return { ruleId: id, label: b.label, unit: b.unit, digits: b.digits, before: { value: b.value, status: b.status }, after: { value: a.value, status: a.status } };
  });
}

function sideEffects(src: ValidationSource, component: ComponentId, before: DesignValidation, after: DesignValidation, targets: string[], B: AnyDesign, patched: AnyDesign) {
  const out: string[] = [];
  for (const r of after.results) {
    if (targets.includes(r.ruleId)) continue;
    const prev = before.results.find((x) => x.ruleId === r.ruleId);
    const prevStatus: Verdict = prev?.status ?? 'pass';
    if (prevStatus !== r.status) out.push(`${r.label}: ${VERDICT_LABEL[prevStatus]} → ${VERDICT_LABEL[r.status]}`);
  }
  if (component === 'brake-caliper') {
    const m0 = caliperEstimate(B as CaliperDesign, src.caliperInputs).massKg;
    const m1 = caliperEstimate(patched as CaliperDesign, src.caliperInputs).massKg;
    if (Math.abs(m1 - m0) >= 0.0005) {
      out.push(`Mass ${m0.toFixed(3)} → ${m1.toFixed(3)} kg (${m1 > m0 ? '+' : '−'}${Math.abs(((m1 - m0) / m0) * 100).toFixed(1)} %)`);
    }
  }
  return out;
}

function makeRec(
  src: ValidationSource,
  component: ComponentId,
  current: DesignValidation,
  B: AnyDesign,
  key: string,
  trial: Trial,
  targets: string[],
  why: string,
  kind: Recommendation['kind'] = 'fix',
): Recommendation {
  const meta = paramMeta(component, key);
  const from = paramValue(B, key);
  const patched = withPatch(B, { [key]: trial.value });
  const fromText = formatParam(component, key, from);
  const toText = formatParam(component, key, trial.value);
  const title = meta.options
    ? `Switch ${meta.label.toLowerCase()} to ${toText}`
    : `${Number(trial.value) > Number(from) ? 'Increase' : 'Reduce'} ${meta.label.toLowerCase()} ${fromText} → ${toText}`;
  return {
    id: `${key}->${String(trial.value)}`,
    kind,
    ruleIds: targets,
    parameter: key,
    parameterLabel: meta.label,
    fromText,
    toText,
    title,
    rationale: why,
    patch: { [key]: trial.value },
    clears: trial.clears,
    verdictAfter: trial.validation.verdict,
    predicted: predictedFor(current, trial.validation, targets),
    sideEffects: sideEffects(src, component, current, trial.validation, targets, B, patched),
  };
}

/** Fixes for design B's FAIL and NEEDS REVIEW checks, best first. */
export function recommendFixes(src: ValidationSource, component: ComponentId, current: DesignValidation): Recommendation[] {
  const B = getDesign(src, component, 'B');
  const open = current.results.filter((r) => r.status !== 'pass');
  if (!open.length) return [];

  // One best trial per (rule, lever).
  const raw: { key: string; dir: number; trial: Trial; targets: string[]; why: string }[] = [];
  for (const r of open) {
    for (const lever of LEVERS[r.ruleId] ?? []) {
      const meta = paramMeta(component, lever.param);
      let trial: Trial | null = null;
      if (meta.options) trial = searchChoice(src, component, B, lever.param, [r.ruleId]);
      else if (lever.dir === 0) {
        const up = searchNumeric(src, component, B, lever.param, 1, [r.ruleId]);
        const down = searchNumeric(src, component, B, lever.param, -1, [r.ruleId]);
        const dist = (t: Trial | null) => (t ? Math.abs(Number(t.value) - Number(paramValue(B, lever.param))) + (t.clears ? 0 : 1e6) : Infinity);
        trial = dist(up) <= dist(down) ? up : down;
      } else trial = searchNumeric(src, component, B, lever.param, lever.dir, [r.ruleId]);
      if (!trial) continue;
      const dir = meta.options ? 0 : Math.sign(Number(trial.value) - Number(paramValue(B, lever.param)));
      raw.push({ key: lever.param, dir, trial, targets: [r.ruleId], why: lever.why });
    }
  }

  // Merge levers that move the same parameter the same way: the bigger change usually covers both rules.
  const merged = new Map<string, (typeof raw)[number]>();
  for (const item of raw) {
    const k = `${item.key}:${item.dir}:${item.dir === 0 ? String(item.trial.value) : ''}`;
    const prev = merged.get(k);
    if (!prev) {
      merged.set(k, { ...item });
      continue;
    }
    const targets = [...new Set([...prev.targets, ...item.targets])];
    const bigger = Math.abs(Number(item.trial.value) - Number(paramValue(B, item.key))) > Math.abs(Number(prev.trial.value) - Number(paramValue(B, prev.key))) ? item : prev;
    const validation = validateCandidate(src, component, withPatch(B, { [bigger.key]: bigger.trial.value }));
    merged.set(k, { ...bigger, targets, trial: { value: bigger.trial.value, validation, clears: allPass(validation, targets) } });
  }

  const recs = [...merged.values()].map((m) => makeRec(src, component, current, B, m.key, m.trial, m.targets, m.why));
  const size = (r: Recommendation) => {
    const spec = paramMeta(component, r.parameter).spec;
    if (!spec) return 0.5; // a material change counts as a moderate change
    return Math.abs(Number(r.patch[r.parameter]) - Number(paramValue(B, r.parameter))) / (spec.max - spec.min);
  };
  recs.sort(
    (x, y) =>
      verdictRank(x.verdictAfter) - verdictRank(y.verdictAfter) ||
      y.ruleIds.length - x.ruleIds.length ||
      Number(y.clears) - Number(x.clears) ||
      size(x) - size(y),
  );
  return recs.slice(0, MAX_FIXES);
}

/**
 * When the caliper candidate already passes cleanly: the largest mass saving
 * from thinning one wall while every check still passes. Optional, never required.
 */
export function recommendOpportunity(src: ValidationSource, component: ComponentId, current: DesignValidation): Recommendation | null {
  if (component !== 'brake-caliper' || current.verdict !== 'pass') return null;
  const B = getDesign(src, component, 'B') as CaliperDesign;
  const m0 = caliperEstimate(B, src.caliperInputs).massKg;
  let best: { key: string; trial: Trial; saving: number } | null = null;
  // Only walls the beam model actually judges. The legs are treated as rigid, so
  // the model can't tell whether a thinner leg would bend or crack: no leg-wall savings.
  for (const key of ['bridgeMm', 'ribMm']) {
    if (key === 'ribMm' && B.ribCount === 0) continue;
    const spec = paramMeta(component, key).spec!;
    let last: Trial | null = null;
    for (let i = 1; i <= 400; i++) {
      const raw = Number(paramValue(B, key)) - i * spec.step;
      if (raw < spec.min - 1e-9) break;
      const value = Number((Math.round(raw / spec.step) * spec.step).toFixed(Math.max(spec.digits, 2)));
      const validation = validateCandidate(src, component, withPatch(B, { [key]: value }));
      if (validation.verdict !== 'pass') break;
      last = { value, validation, clears: true };
    }
    if (!last) continue;
    const saving = m0 - caliperEstimate(withPatch(B, { [key]: last.value }), src.caliperInputs).massKg;
    if (saving > 0.02 && (!best || saving > best.saving)) best = { key, trial: last, saving };
  }
  if (!best) return null;
  const rec = makeRec(
    src,
    component,
    current,
    B,
    best.key,
    best.trial,
    [],
    `Optional: B passes every check with margin, so this wall can come down to the thinnest value that still passes, saving about ${best.saving.toFixed(3)} kg.`,
    'opportunity',
  );
  return { ...rec, title: `Optional: ${rec.title.charAt(0).toLowerCase()}${rec.title.slice(1)} to save ${best.saving.toFixed(3)} kg` };
}
