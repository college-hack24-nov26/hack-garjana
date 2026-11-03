/**
 * Rule-based findings: plain statements about A vs B, worked out from the
 * validation results and the estimates. No language model, same answer every
 * time for the same designs.
 */
import { COMPONENT_LABEL, PLUG_SWEEP_RPM, TIP_WINDOW_C } from '../workspace/designs.ts';
import type { ComponentId } from '../workspace/designs.ts';
import { caliperEstimate, plugEstimate } from '../workspace/estimators.ts';
import { VERDICT_LABEL } from '../workspace/validation.ts';
import type { DesignValidation, RuleResult, ValidationSource } from '../workspace/validation.ts';
import type { ExperimentRun } from '../workspace/WorkspaceStore.ts';
import { formatParam, getDesign, paramMeta, paramValue, validateCandidate, withPatch } from './designAccess.ts';
import type { Attribution, DriverChange, Finding } from './types.ts';

const pct = (v: number, d = 1) => `${Math.abs(v).toFixed(d)} %`;
const num = (v: number, d: number) => v.toFixed(d);

/** How far a result sits from its limit, toward the unsafe side (1 = at the limit). */
export function utilisation(r: RuleResult) {
  if (r.limit === 0) return r.value === 0 ? 0 : Infinity;
  return r.kind === 'max' ? r.value / r.limit : r.limit / Math.max(r.value, 1e-12);
}

/**
 * For each rule on B that isn't a clean PASS: which of the parameters you
 * changed from A feed it, and what happens if each one alone goes back to A.
 */
export function attributeRules(src: ValidationSource, component: ComponentId, validationB: DesignValidation): Record<string, Attribution> {
  const A = getDesign(src, component, 'A');
  const B = getDesign(src, component, 'B');
  const out: Record<string, Attribution> = {};
  for (const r of validationB.results) {
    if (r.status === 'pass') continue;
    const changes: DriverChange[] = [];
    for (const key of r.parameters) {
      const a = paramValue(A, key);
      const b = paramValue(B, key);
      if (a === b) continue;
      const reverted = validateCandidate(src, component, withPatch(B, { [key]: a })).results.find((x) => x.ruleId === r.ruleId);
      if (!reverted) continue;
      changes.push({
        parameter: key,
        label: paramMeta(component, key).label,
        fromText: formatParam(component, key, a),
        toText: formatParam(component, key, b),
        revertedValue: reverted.value,
        revertedStatus: reverted.status,
        effect: reverted.margin - r.margin,
      });
    }
    changes.sort((x, y) => y.effect - x.effect);
    out[r.ruleId] = { ruleId: r.ruleId, changes, mainDriver: changes[0] && changes[0].effect > 0 ? changes[0].parameter : undefined };
  }
  return out;
}

function verdictFinding(v: Record<'A' | 'B', DesignValidation>): Finding {
  const a = v.A.verdict;
  const b = v.B.verdict;
  if (b === 'fail') {
    return {
      id: 'verdict',
      tone: 'bad',
      text: `Candidate B fails ${v.B.counts.fail} of ${v.B.results.length} checks${a === 'pass' ? ', where baseline A passes them all' : a === 'fail' ? '; baseline A fails too' : ''}.`,
    };
  }
  if (b === 'review') {
    return {
      id: 'verdict',
      tone: 'warn',
      text: `Candidate B is inside every limit, but ${v.B.counts.review} check${v.B.counts.review > 1 ? 's are' : ' is'} close enough to need review (baseline A: ${VERDICT_LABEL[a]}).`,
    };
  }
  return {
    id: 'verdict',
    tone: 'good',
    text: `Candidate B passes all ${v.B.results.length} checks with margin (baseline A: ${VERDICT_LABEL[a]}).`,
  };
}

function governingFinding(v: DesignValidation): Finding | null {
  const est = v.results.filter((r) => r.basis === 'estimated');
  if (!est.length) return null;
  const top = est.reduce((m, r) => (utilisation(r) > utilisation(m) ? r : m), est[0]);
  const u = utilisation(top) * 100;
  return {
    id: 'governing',
    tone: u > 100 ? 'bad' : u > 80 ? 'warn' : 'info',
    text: `Governing check on B: ${top.label.toLowerCase()} (${top.requirement}) at ${u.toFixed(0)} % of its limit.`,
  };
}

function latestRunFinding(runs: ExperimentRun[], component: ComponentId): Finding | null {
  const run = runs.find((r) => r.component === component);
  if (!run) return null;
  const m = run.metrics.find((x) => x.lowerIsBetter !== null);
  if (!m) return null;
  const d = m.B - m.A;
  if (Math.abs(d) < 0.5 * Math.pow(10, -m.digits)) {
    return { id: 'run', tone: 'info', text: `Latest experiment (${run.title}): ${m.label.toLowerCase()} is the same for A and B.` };
  }
  const better = m.lowerIsBetter ? d < 0 : d > 0;
  return {
    id: 'run',
    tone: better ? 'good' : 'warn',
    text: `Latest experiment (${run.title}, ${run.source === 'model' ? 'simplified model' : 'estimate'}): ${m.label.toLowerCase()} A ${num(m.A, m.digits)} vs B ${num(m.B, m.digits)} ${m.unit}, so B is ${better ? 'better' : 'worse'} here.`,
  };
}

export function buildFindings(
  src: ValidationSource,
  component: ComponentId,
  validation: Record<'A' | 'B', DesignValidation>,
  runs: ExperimentRun[] = [],
): Finding[] {
  const out: Finding[] = [verdictFinding(validation)];
  const gov = governingFinding(validation.B);
  if (gov) out.push(gov);

  if (component === 'brake-caliper') {
    const a = caliperEstimate(src.caliper.A, src.caliperInputs);
    const b = caliperEstimate(src.caliper.B, src.caliperInputs);
    const dm = b.massKg - a.massKg;
    if (Math.abs(dm) >= 0.0005) {
      out.push({
        id: 'mass',
        tone: dm < 0 && validation.B.verdict !== 'fail' ? 'good' : 'info',
        text: `B is ${num(Math.abs(dm), 3)} kg (${pct((dm / a.massKg) * 100)}) ${dm < 0 ? 'lighter' : 'heavier'} than A.`,
      });
    }
    const ds = (b.peakStressMPa / a.peakStressMPa - 1) * 100;
    const dmo = (b.mouthOpeningMm / a.mouthOpeningMm - 1) * 100;
    if (Math.abs(ds) >= 0.5 || Math.abs(dmo) >= 0.5) {
      out.push({
        id: 'structural-shift',
        tone: ds > 10 || dmo > 10 ? 'warn' : 'info',
        text: `Against A, B's bridge stress is ${ds >= 0 ? 'up' : 'down'} ${pct(ds)} and its mouth opening ${dmo >= 0 ? 'up' : 'down'} ${pct(dmo)}.`,
      });
    }
    const df = (b.clampForceN / a.clampForceN - 1) * 100;
    if (Math.abs(df) >= 0.5) {
      out.push({
        id: 'clamp',
        tone: Math.abs(df) > 10 ? 'warn' : 'info',
        text: `B's clamp force is ${pct(df)} ${df > 0 ? 'higher' : 'lower'} than A's at the same line pressure, so it brakes ${df > 0 ? 'harder' : 'softer'} for the same pedal.`,
      });
    }
  } else {
    const inp = src.plugInputs;
    const a = plugEstimate(src.plug.A, inp);
    const b = plugEstimate(src.plug.B, inp);
    const dt = b.tipTempC - a.tipTempC;
    if (Math.abs(dt) >= 1) {
      out.push({
        id: 'heat-range',
        tone: 'info',
        text: `At ${inp.rpm} rpm and ${inp.loadPct} % load, B runs ${num(Math.abs(dt), 0)} °C ${dt > 0 ? 'hotter' : 'cooler'} than A: a ${dt > 0 ? 'hotter' : 'colder'} heat range.`,
      });
    }
    const share = (d: typeof src.plug.A) => {
      let inside = 0;
      let n = 0;
      for (let rpm = PLUG_SWEEP_RPM.min; rpm <= PLUG_SWEEP_RPM.max; rpm += PLUG_SWEEP_RPM.step) {
        const t = plugEstimate(d, inp, rpm, 100).tipTempC;
        if (t >= TIP_WINDOW_C.min && t <= TIP_WINDOW_C.max) inside++;
        n++;
      }
      return (100 * inside) / n;
    };
    const sa = share(src.plug.A);
    const sb = share(src.plug.B);
    out.push({
      id: 'window-share',
      tone: sb >= sa ? 'info' : 'warn',
      text: `Across ${PLUG_SWEEP_RPM.min}–${PLUG_SWEEP_RPM.max} rpm at full load, A stays inside ${TIP_WINDOW_C.min}–${TIP_WINDOW_C.max} °C for ${sa.toFixed(0)} % of the sweep and B for ${sb.toFixed(0)} %.`,
    });
  }

  const run = latestRunFinding(runs, component);
  if (run) out.push(run);
  return out;
}

export const componentLabel = (c: ComponentId) => COMPONENT_LABEL[c];
