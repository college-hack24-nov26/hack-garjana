/**
 * Design Lab estimates for the alloy wheel: the same reduced-order load path the
 * twin uses (sim/loads.ts), run at fixed design conditions instead of in time.
 *
 *   Road cornering   steady turn at the design lateral g, outer front wheel
 *   Cornering rig    M = (μ·R + d)·Fv·S through the hub, no tyre
 *   Radial rig       Fr = K·Fv through the tyre onto a drum
 *
 * Results come back in the workspace's RuleResult shape so the Design Lab's
 * existing check list can show them. Plain TypeScript, testable in Node.
 */
import type { RuleResult, Verdict } from '../../../workspace/validation.ts';
import { DRAWING_DESIGN, FIXED, depthAt, massProperties, wheelLayout } from '../wheel/drawing.ts';
import type { WheelDesign, WheelLayout } from '../wheel/drawing.ts';
import { findWheelMaterial } from '../wheel/materials.ts';
import type { WheelMaterialId } from '../wheel/materials.ts';
import { SPOTS, revolutionCycle, spokeLoads, spotCoeffs, spotStress } from '../sim/loads.ts';
import type { PatchLoads, SpotCoeffs, SpotId } from '../sim/loads.ts';
import { LOAD_TRANSFER, MODEL } from '../sim/wheelModel.ts';

export type WheelSlot = 'A' | 'B';

export interface WheelVariant extends WheelDesign {
  revision: string;
  materialId: WheelMaterialId;
  /** Stress-concentration factor at the spoke junctions. */
  kt: number;
}

export const WHEEL_BASELINE: WheelVariant = {
  revision: 'AW-A rev 1.0 (drawing)',
  ...DRAWING_DESIGN,
  materialId: 'a356-t6',
  kt: 1,
};

/** Design conditions and limits. Every one is an assumption or a demo fixture, and the UI says so. */
export interface WheelLabInputs {
  ratedLoadN: number;
  corneringG: number;
  tyrePressureBar: number;
  minFoS: number;
  minSectionMm: number;
  rigMu: number;
  rigS: number;
  rigK: number;
  targetCornering: number;
  targetRadial: number;
}

export const WHEEL_LAB_DEFAULTS: WheelLabInputs = {
  ratedLoadN: 4500,
  corneringG: 0.6,
  tyrePressureBar: 2.5,
  minFoS: 1.5,
  minSectionMm: 6,
  rigMu: 0.7,
  rigS: 1.6,
  rigK: 2.25,
  targetCornering: 1e5,
  targetRadial: 5e5,
};

export interface WheelEstimate {
  massKg: number;
  spokesKg: number;
  inertiaKgM2: number;
  /** Peak spoke stress over one turn in the road cornering case, MPa. */
  roadPeakMPa: number;
  roadPeakSpot: SpotId;
  roadEqAmpMPa: number;
  /** Life if the road cornering case were held continuously, km. */
  roadLifeKm: number;
  rigMomentNm: number;
  rigCorneringCycles: number;
  rigRadialLoadN: number;
  rigRadialCycles: number;
  /** Thinnest structural section (leg width at the rim or spoke depth at the rim), mm. */
  minSectionMm: number;
  fos: number;
  layout: WheelLayout;
}

const tyreStiffness = (bar: number) => MODEL.tyreStiffnessBase + MODEL.tyreStiffnessPerBar * bar;
const CYCLE_CAP = 1e12;

function peakOverTurn(L: WheelLayout, p: PatchLoads, k: SpotCoeffs) {
  let peak = 0;
  let spot: SpotId = 'leg-rim';
  const loads = [] as ReturnType<typeof spokeLoads>;
  for (let i = 0; i < 72; i++) {
    spokeLoads(L, p, (i / 72) * 2 * Math.PI, loads);
    for (const s of SPOTS)
      for (const a of loads) {
        const v = spotStress(k[s.id], a);
        if (v > peak) {
          peak = v;
          spot = s.id;
        }
      }
  }
  return { peak, spot };
}

const cycles = (damagePerRev: number) => (damagePerRev > 0 ? Math.min(CYCLE_CAP, 1 / damagePerRev) : CYCLE_CAP);

export function estimateWheel(v: WheelVariant, inp: WheelLabInputs): WheelEstimate {
  const L = wheelLayout(v);
  const mat = findWheelMaterial(v.materialId);
  const mass = massProperties(L, mat.densityKgM3);
  const k = spotCoeffs(L, v.kt);
  const kt = tyreStiffness(inp.tyrePressureBar);

  // Road: steady turn, this wheel on the outside.
  const Fz = inp.ratedLoadN * (1 + LOAD_TRANSFER.lat * inp.corneringG);
  const road: PatchLoads = { Fz, Fy: Fz * inp.corneringG, Fx: 0, loadedRadius: FIXED.tyreFreeRadius - Fz / kt };
  const roadPeak = peakOverTurn(L, road, k);
  const roadCycle = revolutionCycle(L, road, k, mat);
  const effR = FIXED.tyreFreeRadius - Fz / kt / 3;
  const perKm = (roadCycle.damagePerRev / (2 * Math.PI * effR)) * 1000;

  // Cornering-fatigue rig.
  const rStatic = FIXED.tyreFreeRadius - inp.ratedLoadN / kt;
  const M = (inp.rigMu * rStatic + FIXED.xMount) * inp.ratedLoadN * inp.rigS;
  const rigC = revolutionCycle(L, { Fz: 0, Fy: 0, Fx: 0, loadedRadius: rStatic, appliedMoment: M }, k, mat);

  // Radial-fatigue rig.
  const Fr = inp.rigK * inp.ratedLoadN;
  const rigR = revolutionCycle(L, { Fz: Fr, Fy: 0, Fx: 0, loadedRadius: FIXED.tyreFreeRadius - Fr / kt }, k, mat);

  const minSection = Math.min(L.legWidthEnd, depthAt(L, FIXED.rAttach)) * 1000;

  return {
    massKg: mass.massKg,
    spokesKg: mass.spokesKg,
    inertiaKgM2: mass.inertiaKgM2,
    roadPeakMPa: roadPeak.peak,
    roadPeakSpot: roadPeak.spot,
    roadEqAmpMPa: roadCycle.eqAmpMPa,
    roadLifeKm: perKm > 0 ? 1 / perKm : Infinity,
    rigMomentNm: M,
    rigCorneringCycles: cycles(rigC.damagePerRev),
    rigRadialLoadN: Fr,
    rigRadialCycles: cycles(rigR.damagePerRev),
    minSectionMm: minSection,
    fos: roadPeak.peak > 0 ? mat.yieldMPa / roadPeak.peak : Infinity,
    layout: L,
  };
}

/* ------------------------------------------------------------------ */
/*  Checks                                                             */
/* ------------------------------------------------------------------ */
interface Rule {
  id: string;
  label: string;
  requirement: string;
  unit: string;
  digits: number;
  kind: 'max' | 'min';
  value: number;
  limit: number;
  limitSource: string;
  parameters: string[];
  why: string;
  /** Passing but closer than this fraction of the limit → NEEDS REVIEW. */
  reviewBand: number;
  reviewNote: string;
  basis: RuleResult['basis'];
}

function judge(r: Rule): RuleResult {
  const gap = r.kind === 'max' ? r.limit - r.value : r.value - r.limit;
  const margin = gap / Math.max(Math.abs(r.limit), 1e-12);
  const status: Verdict = gap < 0 ? 'fail' : margin < r.reviewBand ? 'review' : 'pass';
  return {
    ruleId: r.id,
    label: r.label,
    requirement: r.requirement,
    value: r.value,
    limit: r.limit,
    unit: r.unit,
    digits: r.digits,
    kind: r.kind,
    status,
    margin,
    excess: gap < 0 ? -gap : 0,
    basis: r.basis,
    limitSource: r.limitSource,
    parameters: r.parameters,
    why: r.why,
    reviewReason: status === 'review' ? r.reviewNote : undefined,
  };
}

/** Fatigue lives are compared as log10(cycles) so the margin means something across decades. */
const log = (n: number) => Math.log10(Math.max(1, n));

export function wheelChecks(v: WheelVariant, e: WheelEstimate, inp: WheelLabInputs): RuleResult[] {
  const mat = findWheelMaterial(v.materialId);
  const spokeParams = ['legWidthMm', 'armWidthMm', 'spokeDepthRimMm', 'spokeCount', 'kt', 'materialId'];
  return [
    judge({
      id: 'wheel-road-stress',
      label: `Peak spoke stress, ${inp.corneringG} g turn`,
      requirement: `≤ yield / ${inp.minFoS}`,
      unit: 'MPa',
      digits: 0,
      kind: 'max',
      value: e.roadPeakMPa,
      limit: mat.yieldMPa / inp.minFoS,
      limitSource: `${mat.short} yield ${mat.yieldMPa} MPa (handbook, illustrative) over the minimum factor of safety`,
      parameters: spokeParams,
      why: 'Outer front wheel in a steady turn: the highest regular load a road wheel sees.',
      reviewBand: 0.1,
      reviewNote: 'Within 10 % of the limit, inside the uncertainty of a beam estimate.',
      basis: 'estimated',
    }),
    judge({
      id: 'wheel-rig-cornering',
      label: 'Cornering-fatigue rig life',
      requirement: `≥ ${fmtCyclesPlain(inp.targetCornering)} cycles`,
      unit: 'log₁₀ cycles',
      digits: 2,
      kind: 'min',
      value: log(e.rigCorneringCycles),
      limit: log(inp.targetCornering),
      limitSource: 'Target cycles: an assumption, set it from your wheel standard',
      parameters: spokeParams,
      why: 'Rotating bending moment M = (μR + d)·Fv·S; the classic spoke and hub fatigue test.',
      reviewBand: 0.05,
      reviewNote: 'Less than about 0.3 decades of life to spare; fatigue scatter is larger than that.',
      basis: 'estimated',
    }),
    judge({
      id: 'wheel-rig-radial',
      label: 'Radial-fatigue rig life',
      requirement: `≥ ${fmtCyclesPlain(inp.targetRadial)} cycles`,
      unit: 'log₁₀ cycles',
      digits: 2,
      kind: 'min',
      value: log(e.rigRadialCycles),
      limit: log(inp.targetRadial),
      limitSource: 'Target cycles: an assumption, set it from your wheel standard',
      parameters: spokeParams,
      why: 'Tyred wheel rolled on a drum at Fr = K·Fv; loads the spokes over the patch and the rim.',
      reviewBand: 0.05,
      reviewNote: 'Less than about 0.3 decades of life to spare; fatigue scatter is larger than that.',
      basis: 'estimated',
    }),
    judge({
      id: 'wheel-min-section',
      label: 'Thinnest spoke section',
      requirement: `≥ ${inp.minSectionMm} mm castable`,
      unit: 'mm',
      digits: 1,
      kind: 'min',
      value: e.minSectionMm,
      limit: inp.minSectionMm,
      limitSource: 'Casting minimum section: an assumption',
      parameters: ['legWidthMm', 'spokeDepthRimMm'],
      why: 'Thin sections do not fill reliably in a low-pressure casting.',
      reviewBand: 0.15,
      reviewNote: 'Close to the castable minimum; check with the foundry.',
      basis: 'geometric',
    }),
  ];
}

export const overallVerdict = (rs: RuleResult[]): Verdict =>
  rs.some((r) => r.status === 'fail') ? 'fail' : rs.some((r) => r.status === 'review') ? 'review' : 'pass';

export function fmtCyclesPlain(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}
