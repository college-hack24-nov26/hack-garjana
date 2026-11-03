/**
 * The A/B estimate table for whichever component is selected. Design Lab,
 * AI Insights and Reports all read it from here, so every page shows
 * the same numbers.
 */
import {
  CALIPER_MATERIALS,
  CALIPER_PARAMS,
  ELECTRODE_MATERIALS,
  INSULATOR_MATERIALS,
  PLUG_PARAMS,
  findMaterial,
} from './designs.ts';
import type { ComponentId } from './designs.ts';
import { caliperEstimate, plugEstimate } from './estimators.ts';
import type { CaliperEstimate, PlugEstimate } from './estimators.ts';
import { validateBoth } from './validation.ts';
import type { DesignValidation, ValidationSource, Verdict } from './validation.ts';
import type { Slot } from './designs.ts';

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  digits: number;
  A: number;
  B: number;
  /** True when smaller is better, false when bigger is better, null when neither. */
  lowerIsBetter: boolean | null;
}

export interface DesignEstimates {
  component: ComponentId;
  rows: MetricRow[];
  /** Deterministic verdicts from the validation engine. */
  validation: Record<Slot, DesignValidation>;
  verdict: Record<Slot, Verdict>;
  revisions: { A: string; B: string };
  caliper?: { A: CaliperEstimate; B: CaliperEstimate };
  plug?: { A: PlugEstimate; B: PlugEstimate };
}

type Source = ValidationSource & { component: ComponentId };

export function estimatesFor(ws: Source, component: ComponentId = ws.component): DesignEstimates {
  const validation = validateBoth(ws, component);
  const verdict = { A: validation.A.verdict, B: validation.B.verdict };
  if (component === 'brake-caliper') {
    const A = caliperEstimate(ws.caliper.A, ws.caliperInputs);
    const B = caliperEstimate(ws.caliper.B, ws.caliperInputs);
    return {
      component,
      caliper: { A, B },
      revisions: { A: ws.caliper.A.revision, B: ws.caliper.B.revision },
      validation,
      verdict,
      rows: [
        { key: 'mass', label: 'Mass', unit: 'kg', digits: 3, A: A.massKg, B: B.massKg, lowerIsBetter: true },
        { key: 'stress', label: 'Peak bridge stress', unit: 'MPa', digits: 2, A: A.peakStressMPa, B: B.peakStressMPa, lowerIsBetter: true },
        { key: 'mouth', label: 'Mouth opening', unit: 'mm', digits: 4, A: A.mouthOpeningMm, B: B.mouthOpeningMm, lowerIsBetter: true },
        { key: 'fos', label: 'Factor of safety (yield)', unit: '–', digits: 2, A: A.factorOfSafety, B: B.factorOfSafety, lowerIsBetter: false },
        { key: 'clamp', label: 'Clamp force per side', unit: 'kN', digits: 2, A: A.clampForceN / 1000, B: B.clampForceN / 1000, lowerIsBetter: null },
      ],
    };
  }
  const A = plugEstimate(ws.plug.A, ws.plugInputs);
  const B = plugEstimate(ws.plug.B, ws.plugInputs);
  return {
    component,
    plug: { A, B },
    revisions: { A: ws.plug.A.revision, B: ws.plug.B.revision },
    validation,
    verdict,
    rows: [
      { key: 'tip', label: 'Firing-end temperature', unit: '°C', digits: 0, A: A.tipTempC, B: B.tipTempC, lowerIsBetter: null },
      { key: 'heat', label: 'Heat to shell seat', unit: 'W', digits: 1, A: A.heatToSeatW, B: B.heatToSeatW, lowerIsBetter: null },
      { key: 'mL', label: 'Fin parameter m·L', unit: '–', digits: 2, A: A.mL, B: B.mL, lowerIsBetter: null },
      { key: 'h', label: 'Gas-side h (operating point)', unit: 'W/m²K', digits: 0, A: A.hEff, B: B.hEff, lowerIsBetter: null },
    ],
  };
}

/** Parameter-by-parameter differences between A and B, for the diff tables. */
export function parameterDiffs(ws: Source, component: ComponentId = ws.component) {
  if (component === 'brake-caliper') {
    const { A, B } = ws.caliper;
    return CALIPER_PARAMS.map((p) => ({ label: p.label, unit: p.unit, digits: p.digits, A: A[p.key], B: B[p.key] }));
  }
  const { A, B } = ws.plug;
  return PLUG_PARAMS.map((p) => ({ label: p.label, unit: p.unit, digits: p.digits, A: A[p.key], B: B[p.key] }));
}

/** Material choices for A and B, as names. */
export function materialDiffs(ws: Source, component: ComponentId = ws.component) {
  if (component === 'brake-caliper') {
    const name = (id: string) => findMaterial(CALIPER_MATERIALS, id).name;
    return [{ label: 'Material', A: name(ws.caliper.A.materialId), B: name(ws.caliper.B.materialId) }];
  }
  const ins = (id: string) => findMaterial(INSULATOR_MATERIALS, id).name;
  const el = (id: string) => findMaterial(ELECTRODE_MATERIALS, id).name;
  return [
    { label: 'Insulator', A: ins(ws.plug.A.insulatorId), B: ins(ws.plug.B.insulatorId) },
    { label: 'Centre electrode', A: el(ws.plug.A.electrodeId), B: el(ws.plug.B.electrodeId) },
  ];
}

/** Relative change from A to B in percent, or null when A is zero. */
export const pctChange = (a: number, b: number) => (Math.abs(a) < 1e-12 ? null : ((b - a) / Math.abs(a)) * 100);
