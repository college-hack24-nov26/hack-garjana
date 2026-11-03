/**
 * Reduced-order load path for the Y-spoke wheel: tyre forces at the contact
 * patch, shared out to the spokes, turned into beam stresses. It's a hand
 * calculation, not finite elements, so read the numbers as comparative.
 *
 *   Radial   Fz is shared between the spokes. Half follows a rigid-rim cosine
 *            law (spokes above the axle pull, spokes below push), half is
 *            concentrated on the spokes nearest the patch (cos^3 weighting).
 *            Vertical equilibrium Σ R_i cos ψ_i = Fz holds exactly.
 *   Moment   The tyre forces' moment about the spoke-root plane,
 *            M = Fz·d + Fy·R_loaded, bends the spokes out of the wheel plane with
 *            a cosine distribution, so each spoke is fully reversed once per turn.
 *   Torque   Brake or drive torque T = Fx·R_loaded is shared equally and bends
 *            each spoke in the wheel plane.
 *   Beam     Each Y-spoke is one beam from hub to rim with both ends held against
 *            rotation, so the root moment is (end force)·L/2.
 *
 * ψ_i is spoke i's angle from straight down (the contact patch).
 */
import { FIXED, stressCoeffs } from '../wheel/drawing.ts';
import type { MemberKind, WheelLayout } from '../wheel/drawing.ts';
import { cyclesToFailure, goodmanAmplitude } from '../wheel/materials.ts';
import type { WheelMaterial } from '../wheel/materials.ts';

export const LOAD_MODEL = {
  /** Share of the radial load spread as if the rim were rigid. The rest goes to the spokes near the patch. */
  rimShare: 0.5,
  /** Exponent of the concentrated share, cos^m. */
  localExp: 3,
} as const;

export interface PatchLoads {
  /** Vertical road load on the tyre, N. */
  Fz: number;
  /** Lateral force, N, positive pointing inboard (outer wheel in a turn). */
  Fy: number;
  /** Longitudinal force, N, positive driving forward, negative braking. */
  Fx: number;
  /** Axle height above the road, m. Lever arm for Fx and Fy. */
  loadedRadius: number;
}

export interface ArmLoad {
  /** Axial force in the arm, N. Positive = compression. */
  n: number;
  /** Out-of-plane bending moment at the root, N·m (signed). */
  mo: number;
  /** In-plane bending moment at the root, N·m (signed). */
  mi: number;
}

/** cos ψ for spoke i when the wheel has turned through θ (spoke 0 points up at θ = 0). */
export const spokeCos = (i: number, N: number, theta: number) => -Math.cos((2 * Math.PI * i) / N - theta);

export const overturningMoment = (L: WheelLayout, p: PatchLoads) => p.Fz * L.dOffset + p.Fy * p.loadedRadius;
export const wheelTorque = (p: PatchLoads) => p.Fx * p.loadedRadius;

export function spokeLoads(L: WheelLayout, p: PatchLoads, theta: number, out: ArmLoad[] = []): ArmLoad[] {
  const N = L.N;
  const a = LOAD_MODEL.rimShare;
  const m = LOAD_MODEL.localExp;
  let W = 0;
  for (let i = 0; i < N; i++) {
    const c = spokeCos(i, N, theta);
    if (c > 0) W += Math.pow(c, m) * c;
  }
  const M = overturningMoment(L, p);
  const T = wheelTorque(p);
  const span = FIXED.rAttach - FIXED.rHub;
  const Q = T / (N * FIXED.rAttach);
  for (let i = 0; i < N; i++) {
    const c = spokeCos(i, N, theta);
    const w = c > 0 ? Math.pow(c, m) : 0;
    const radial = p.Fz * (a * (2 / N) * c + (1 - a) * (W > 0 ? w / W : 0));
    const P = ((2 * M) / (N * FIXED.rAttach)) * c;
    const o = out[i] ?? (out[i] = { n: 0, mo: 0, mi: 0 });
    o.n = radial;
    o.mo = (P * span) / 2;
    o.mi = (Q * span) / 2;
  }
  out.length = N;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Where the stress is read                                           */
/* ------------------------------------------------------------------ */
export type SpotId = 'arm-root' | 'leg-fork' | 'leg-rim';

export const SPOTS: { id: SpotId; label: string; kind: MemberKind; r: (L: WheelLayout) => number }[] = [
  { id: 'arm-root', label: 'Arm root at hub', kind: 'arm', r: () => FIXED.rHub },
  { id: 'leg-fork', label: 'Leg at fork blend', kind: 'leg', r: (L) => L.rCrotch },
  { id: 'leg-rim', label: 'Leg–rim junction', kind: 'leg', r: () => FIXED.rAttach },
];

export const spotLabel = (id: SpotId) => SPOTS.find((s) => s.id === id)!.label;

export type SpotCoeffs = Record<SpotId, { cA: number; cO: number; cI: number }>;

export function spotCoeffs(L: WheelLayout, kt: number): SpotCoeffs {
  const out = {} as SpotCoeffs;
  for (const s of SPOTS) out[s.id] = stressCoeffs(L, s.kind, s.r(L), kt);
  return out;
}

/** Worst-corner stress magnitude, MPa. */
export const spotStress = (k: { cA: number; cO: number; cI: number }, a: ArmLoad) =>
  (Math.abs(a.n) * k.cA + Math.abs(a.mo) * k.cO + Math.abs(a.mi) * k.cI) / 1e6;

/** Signed stress at one corner of the section (so = ±1 out of plane, si = ±1 in plane), MPa. */
const cornerStress = (k: { cA: number; cO: number; cI: number }, a: ArmLoad, so: number, si: number) =>
  (-a.n * k.cA + so * a.mo * k.cO + si * a.mi * k.cI) / 1e6;

/* ------------------------------------------------------------------ */
/*  One revolution at the current loads: the fatigue cycle             */
/* ------------------------------------------------------------------ */
export interface CycleSample {
  deg: number;
  /** Signed stress at the critical corner of the critical spot, MPa. */
  crit: number;
  /** Signed stress at the arm root (worst corner for that spot), MPa. */
  root: number;
}

export interface CycleResult {
  spot: SpotId;
  ampMPa: number;
  meanMPa: number;
  /** Goodman-equivalent fully reversed amplitude, MPa. */
  eqAmpMPa: number;
  /** Miner damage per wheel revolution at the critical spot. Each spoke sees one cycle per turn. */
  damagePerRev: number;
  samples: CycleSample[];
}

const CORNERS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Follow spoke 0 once round the wheel at fixed loads and find the stress cycle
 * at each spot and corner. The one that does the most damage is the critical one.
 */
export function revolutionCycle(
  L: WheelLayout,
  p: PatchLoads,
  coeffs: SpotCoeffs,
  mat: WheelMaterial,
  samples = 72,
): CycleResult {
  const hist: Record<SpotId, number[][]> = { 'arm-root': [[], [], [], []], 'leg-fork': [[], [], [], []], 'leg-rim': [[], [], [], []] };
  const loads: ArmLoad[] = [];
  for (let k = 0; k < samples; k++) {
    const theta = (2 * Math.PI * k) / samples;
    spokeLoads(L, p, theta, loads);
    const a = loads[0];
    for (const s of SPOTS) CORNERS.forEach(([so, si], c) => hist[s.id][c].push(cornerStress(coeffs[s.id], a, so, si)));
  }

  let best: { spot: SpotId; corner: number; amp: number; mean: number; eq: number; dmg: number } | null = null;
  let rootCorner = 0;
  let rootDmg = -1;
  for (const s of SPOTS) {
    hist[s.id].forEach((series, c) => {
      const hi = Math.max(...series);
      const lo = Math.min(...series);
      const amp = (hi - lo) / 2;
      const mean = (hi + lo) / 2;
      const eq = goodmanAmplitude(mat, amp, mean);
      const dmg = 1 / cyclesToFailure(mat, eq);
      const score = dmg > 0 ? dmg : eq * 1e-30; // rank by amplitude when damage underflows
      if (!best || score > (best.dmg > 0 ? best.dmg : best.eq * 1e-30)) best = { spot: s.id, corner: c, amp, mean, eq, dmg };
      if (s.id === 'arm-root' && score > rootDmg) {
        rootDmg = score;
        rootCorner = c;
      }
    });
  }
  const b = best!;
  return {
    spot: b.spot,
    ampMPa: b.amp,
    meanMPa: b.mean,
    eqAmpMPa: b.eq,
    damagePerRev: b.dmg,
    samples: Array.from({ length: samples + 1 }, (_, k) => ({
      deg: (360 * k) / samples,
      crit: hist[b.spot][b.corner][k % samples],
      root: hist['arm-root'][rootCorner][k % samples],
    })),
  };
}
