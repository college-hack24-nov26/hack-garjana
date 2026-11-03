/**
 * Reduced-order estimates for the Design Lab. They answer instantly, so the
 * numbers can follow a slider, but they are simple hand-calculation models,
 * not finite-element results. Nothing here has been calibrated against a
 * solver in this build. Use them to see which way a change pushes the design,
 * not for the actual values.
 *
 * This file is physics only. Whether a number is acceptable is decided in
 * validation.ts, against the configured limits.
 *
 * Units inside the caliper model: mm, N, MPa (so N·mm for moments, mm⁴ for I).
 */
import { CALIPER_MATERIALS, ELECTRODE_MATERIALS, INSULATOR_MATERIALS, findMaterial } from './designs.ts';
import type { CaliperDesign, CaliperInputs, PlugDesign, PlugInputs } from './designs.ts';

/* ------------------------------------------------------------------ */
/*  Brake caliper: rigid legs on a bridge beam                         */
/* ------------------------------------------------------------------ */

export interface CaliperEstimate {
  massKg: number;
  /** Clamp force pushing each half outward, N. */
  clampForceN: number;
  /** Bending moment the bridge carries, N·m. */
  bridgeMomentNm: number;
  /** Second moment of area of the bridge section (plate + ribs), mm⁴. */
  bridgeIMm4: number;
  peakStressMPa: number;
  mouthOpeningMm: number;
  /** Selected material's yield strength over the peak stress. */
  factorOfSafety: number;
}

/** Length the piston row needs: each bore plus a 6 mm ligament between and outside the bores. */
export const pistonRowLengthMm = (d: CaliperDesign) => d.pistonsPerSide * d.pistonBoreMm + (d.pistonsPerSide + 1) * 6;

/**
 * Model:
 *  - Each half is pushed outward by F = p · n · πd²/4, acting at the pad centre,
 *    halfway down the disc slot (lever arm e = slot depth / 2 from the bridge).
 *  - The legs are treated as rigid. The bridge is a beam of span L (disc slot +
 *    one leg wall, centre to centre) carrying the end moment M = F·e.
 *  - Bridge section = full-length plate plus ribs standing on it (composite I).
 *  - Peak stress = M·c / I on the bridge. Mouth opening = 2 · θ · slot depth,
 *    with end rotation θ = M·L / (2·E·I).
 *
 * Known biases: rigid legs make the opening read low; a beam can't see the
 * stress concentration at the piston bores and mounting holes, so peak stress
 * reads low too.
 */
export function caliperEstimate(d: CaliperDesign, inp: CaliperInputs): CaliperEstimate {
  const mat = findMaterial(CALIPER_MATERIALS, d.materialId);
  const boreArea = (Math.PI * d.pistonBoreMm ** 2) / 4;
  const F = inp.linePressureMPa * d.pistonsPerSide * boreArea;
  const slotDepth = d.bodyHeightMm * d.slotDepthFrac;
  const M = F * (slotDepth / 2);

  // Composite bridge section: plate (b × h) with ribs (n · t × hr) on top of it.
  const b = d.bodyLengthMm;
  const h = d.bridgeMm;
  const ribH = d.ribCount > 0 ? 0.8 * h : 0;
  const ribW = d.ribCount * d.ribMm;
  const aPlate = b * h;
  const aRib = ribW * ribH;
  const yBar = (aPlate * (h / 2) + aRib * (h + ribH / 2)) / (aPlate + aRib);
  const I =
    (b * h ** 3) / 12 +
    aPlate * (h / 2 - yBar) ** 2 +
    (ribW * ribH ** 3) / 12 +
    aRib * (h + ribH / 2 - yBar) ** 2;
  const c = Math.max(yBar, h + ribH - yBar);
  const stress = (M * c) / I;

  const span = d.discSlotMm + d.legWallMm;
  const theta = (M * span) / (2 * mat.eMPa * I);
  const mouth = 2 * theta * slotDepth;

  // Volume: two legs minus the piston bores, the bridge plate, the ribs.
  const outer = d.discSlotMm + 2 * d.legWallMm;
  const legs = 2 * d.bodyLengthMm * d.bodyHeightMm * d.legWallMm;
  const bores = 2 * d.pistonsPerSide * boreArea * 0.6 * d.legWallMm;
  const bridge = d.bodyLengthMm * h * outer;
  const ribs = aRib * outer;
  const massKg = (legs - bores + bridge + ribs) * 1e-9 * mat.densityKgM3;

  return {
    massKg,
    clampForceN: F,
    bridgeMomentNm: M / 1000,
    bridgeIMm4: I,
    peakStressMPa: stress,
    mouthOpeningMm: mouth,
    factorOfSafety: mat.yieldMPa / stress,
  };
}

/* ------------------------------------------------------------------ */
/*  Spark plug: the insulator nose as a fin                            */
/* ------------------------------------------------------------------ */

export interface PlugEstimate {
  tipTempC: number;
  /** Heat the firing end passes into the shell seat, W. */
  heatToSeatW: number;
  /** Gas-side heat transfer coefficient at this operating point, W/(m²·K). */
  hEff: number;
  /** Fin parameter m·L. Bigger means the tip is better insulated from the seat. */
  mL: number;
}

/** Gas-side heat transfer scaled from the 3000 rpm, full-load reference. */
export function plugHeatTransfer(inp: PlugInputs, rpm = inp.rpm, loadPct = inp.loadPct) {
  return inp.hRef * Math.pow(rpm / 3000, 0.8) * (0.3 + 0.7 * (loadPct / 100));
}

/**
 * Model: the insulator nose and the centre electrode inside it form one fin,
 * heated by the gas over its surface and cooled only at the shell seat:
 *
 *   T_tip = T_gas − (T_gas − T_seat) / cosh(m·L),   m = √(h·P / Σ k·A)
 *
 * L is the nose length plus half the protrusion. h scales with engine speed
 * (exponent 0.8, as in the usual in-cylinder correlations) and with load.
 * Thermal contact resistance, radiation and the ground electrode are ignored.
 */
export function plugEstimate(d: PlugDesign, inp: PlugInputs, rpm = inp.rpm, loadPct = inp.loadPct): PlugEstimate {
  const kIns = findMaterial(INSULATOR_MATERIALS, d.insulatorId).kWmK;
  const kEl = findMaterial(ELECTRODE_MATERIALS, d.electrodeId).kWmK;
  const D = d.noseDiaMm / 1000;
  const de = Math.min(d.electrodeDiaMm, d.noseDiaMm * 0.8) / 1000;
  const aIns = (Math.PI / 4) * (D * D - de * de);
  const aEl = (Math.PI / 4) * de * de;
  const kA = kIns * aIns + kEl * aEl;
  const P = Math.PI * D;
  const h = plugHeatTransfer(inp, rpm, loadPct);
  const m = Math.sqrt((h * P) / kA);
  const L = (d.noseLengthMm + 0.5 * d.protrusionMm) / 1000;
  const mL = m * L;
  const dT = inp.gasTempC - inp.seatTempC;
  return {
    tipTempC: inp.gasTempC - dT / Math.cosh(mL),
    heatToSeatW: Math.sqrt(h * P * kA) * dT * Math.tanh(mL),
    hEff: h,
    mL,
  };
}

/** Tip temperature across an engine-speed sweep at a fixed load. */
export function plugSpeedSweep(d: PlugDesign, inp: PlugInputs, loadPct: number, rpms: number[]) {
  return rpms.map((rpm) => ({ rpm, tipTempC: plugEstimate(d, inp, rpm, loadPct).tipTempC }));
}
