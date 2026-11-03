/**
 * Wheel materials. Typical handbook values, rounded, so the estimates have
 * something sensible to work with. They are not supplier or certified data,
 * and the fatigue constants are illustrative fits, not test results.
 */
export type WheelMaterialId = 'a356-t6' | '6061-t6' | 'alloy-steel';

export interface WheelMaterial {
  id: WheelMaterialId;
  name: string;
  short: string;
  densityKgM3: number;
  eGPa: number;
  yieldMPa: number;
  utsMPa: number;
  /** Basquin fatigue strength coefficient σ'f, MPa: σa = σ'f · (2N)^b. */
  fatigueCoeffMPa: number;
  /** Basquin exponent b (negative). */
  fatigueExp: number;
  note: string;
}

export const WHEEL_MATERIALS: WheelMaterial[] = [
  {
    id: 'a356-t6',
    name: 'A356.0-T6 cast aluminium',
    short: 'A356-T6 cast',
    densityKgM3: 2685,
    eGPa: 72.4,
    yieldMPa: 186,
    utsMPa: 262,
    fatigueCoeffMPa: 400,
    fatigueExp: -0.1,
    note: 'The usual low-pressure-cast wheel alloy. Casting porosity, which drives real wheel fatigue, is not modelled.',
  },
  {
    id: '6061-t6',
    name: '6061-T6 forged aluminium',
    short: '6061-T6 forged',
    densityKgM3: 2700,
    eGPa: 68.9,
    yieldMPa: 276,
    utsMPa: 310,
    fatigueCoeffMPa: 420,
    fatigueExp: -0.075,
    note: 'Forged wheels use this; same geometry, higher strength.',
  },
  {
    id: 'alloy-steel',
    name: 'Alloy steel (drawing title block)',
    short: 'Alloy steel',
    densityKgM3: 7700,
    eGPa: 210,
    yieldMPa: 620,
    utsMPa: 724,
    fatigueCoeffMPa: 1069,
    fatigueExp: -0.087,
    note:
      "The drawing's title block names \"Alloy Steel\" (a CAD-library material). Shown for comparison; production alloy wheels are aluminium.",
  },
];

export const findWheelMaterial = (id: string) => WHEEL_MATERIALS.find((m) => m.id === id) ?? WHEEL_MATERIALS[0];

/** Fully reversed stress amplitude that lasts `cycles` cycles, MPa (Basquin). */
export const fatigueStrength = (m: WheelMaterial, cycles: number) => m.fatigueCoeffMPa * Math.pow(2 * cycles, m.fatigueExp);

/** Cycles to failure at an equivalent fully reversed amplitude, Basquin. Infinity at zero amplitude. */
export const cyclesToFailure = (m: WheelMaterial, ampMPa: number) =>
  ampMPa <= 0 ? Infinity : 0.5 * Math.pow(ampMPa / m.fatigueCoeffMPa, 1 / m.fatigueExp);

/** Goodman mean-stress correction. Compressive mean is not credited (conservative, common practice). */
export function goodmanAmplitude(m: WheelMaterial, ampMPa: number, meanMPa: number) {
  if (meanMPa <= 0) return ampMPa;
  if (meanMPa >= m.utsMPa) return Infinity;
  return ampMPa / (1 - meanMPa / m.utsMPa);
}
