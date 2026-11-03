/**
 * Timing for the fire inside each cylinder.
 *
 * Everything here only depends on where a cylinder is in its 720° cycle, so the
 * fire runs off the same crank angle as the pistons. It stops when you pause and
 * plays back the same way after a reset.
 *
 * The timing follows a normal spark-ignition engine: spark a bit before TDC, the
 * flame crosses the chamber over a few tens of degrees, and the burned gas keeps
 * glowing through the power stroke until the exhaust valve opens. It's there to
 * look right, though. It isn't a heat-release or flame-propagation model.
 */
import { wrapCycle } from './kinematics.ts';

/** Spark timing in degrees before TDC. Same as the AutoTwin flame kernel. */
export const SPARK_ADVANCE_DEG = 18;
/** How many crank degrees the flame takes to cross the whole chamber. */
export const FLAME_SWEEP_DEG = 48;
/** The glow is brightest this long after the spark (about 12° ATDC, around peak pressure). */
export const GLOW_PEAK_DEG = 30;
/** The glow is gone this long after the spark (about 182° ATDC, once the exhaust valve has opened and the gas has rushed out). */
export const GLOW_END_DEG = 200;

/** Crank degrees since this cylinder's spark, in [0, 720). */
export function degSinceSpark(cycleDeg: number): number {
  return wrapCycle(cycleDeg + SPARK_ADVANCE_DEG);
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** How much of the chamber the flame has reached: 0 at the spark, 1 once it's all burning. */
export function flameFront(cycleDeg: number): number {
  const since = degSinceSpark(cycleDeg);
  if (since > GLOW_END_DEG) return 0;
  return smooth(since / FLAME_SWEEP_DEG);
}

/** How bright the burning gas is, 0 to 1. Stays at 0 from the exhaust stroke until the next spark. */
export function fireLuminosity(cycleDeg: number): number {
  const since = degSinceSpark(cycleDeg);
  if (since >= GLOW_END_DEG) return 0;
  if (since < GLOW_PEAK_DEG) return 0.15 + 0.85 * smooth(since / GLOW_PEAK_DEG);
  return Math.pow(1 - (since - GLOW_PEAK_DEG) / (GLOW_END_DEG - GLOW_PEAK_DEG), 1.3);
}

/** The spark itself: a quick flash across the plug gap. */
export function sparkFlash(cycleDeg: number): number {
  const since = degSinceSpark(cycleDeg);
  return since < 14 ? 1 - since / 14 : 0;
}

/** Counts a cylinder's firings, ticking over exactly at each spark. Gives every firing its own flame pattern. */
export function combustionEvent(cylinderPhaseDeg: number, totalCrankDeg: number): number {
  return Math.floor((totalCrankDeg - cylinderPhaseDeg + SPARK_ADVANCE_DEG) / 720);
}
