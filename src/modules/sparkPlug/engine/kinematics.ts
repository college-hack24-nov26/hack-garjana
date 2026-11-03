/** Kinematics for a four-stroke inline-4.
 *
 * The motion comes from real slider-crank geometry, not a canned loop. Piston
 * height follows from the crank radius and rod length, so if you change the
 * geometry the motion changes with it. Which stroke each cylinder is on comes
 * from its crank phase and the firing order.
 *
 * Keep in mind the engine itself is only context. In AutoTwin the plug tip
 * temperatures come from the solver, but the bore, stroke and rod length are
 * just a reference engine, not the customer's. */

export type Stroke = 'Power' | 'Exhaust' | 'Intake' | 'Compression';
export type DesignId = 'A' | 'B';

export interface EngineGeometry {
  /** Cylinder bore, metres. */
  bore: number;
  /** Full piston stroke, metres. Crank radius is half of this. */
  stroke: number;
  /** Connecting-rod centre-to-centre length, metres. */
  rodLength: number;
  /** Centre-to-centre cylinder spacing, metres. */
  cylinderPitch: number;
  cylinders: number;
}

/** A generic 2.0 L inline-4 used as the reference engine. */
export const REFERENCE_ENGINE: EngineGeometry = {
  bore: 0.086,
  stroke: 0.086,
  rodLength: 0.1435,
  cylinderPitch: 0.096,
  cylinders: 4,
};

/** Firing order 1-3-4-2, the usual one for an inline-4. */
export const FIRING_ORDER = [1, 3, 4, 2] as const;

/**
 * Where each cylinder sits in the 720° cycle, as a crank angle offset.
 *
 * Cylinder 1 fires at 0°, and each next cylinder in the firing order fires
 * 180° after the one before. The index is the cylinder number minus one.
 */
export const CYLINDER_PHASE: number[] = (() => {
  const phase = new Array<number>(4).fill(0);
  FIRING_ORDER.forEach((cylinder, position) => {
    phase[cylinder - 1] = position * 180;
  });
  return phase;
})();

/** Which plug design sits in each cylinder: A in 1 and 4, B in 2 and 3. */
export const CYLINDER_DESIGN: DesignId[] = ['A', 'B', 'B', 'A'];

/** Wrap any angle into [0, 720). */
export function wrapCycle(angleDeg: number): number {
  return ((angleDeg % 720) + 720) % 720;
}

/**
 * How far the piston is below top dead centre, in metres.
 *
 * Uses the exact slider-crank formula:
 *   x = r(1 - cos θ) + l - sqrt(l² - r² sin²θ)
 * 0 means the piston is all the way up.
 */
export function pistonDrop(crankDeg: number, geometry: EngineGeometry): number {
  const r = geometry.stroke / 2;
  const l = geometry.rodLength;
  const theta = (crankDeg * Math.PI) / 180;
  const sin = Math.sin(theta);
  const root = Math.sqrt(Math.max(l * l - r * r * sin * sin, 0));
  return r * (1 - Math.cos(theta)) + l - root;
}

/** Which stroke a cylinder is on, given where it is in the 720° cycle. */
export function strokeAt(cyclePositionDeg: number): Stroke {
  const p = wrapCycle(cyclePositionDeg);
  if (p < 180) return 'Power';
  if (p < 360) return 'Exhaust';
  if (p < 540) return 'Intake';
  return 'Compression';
}

/** Where one cylinder is in its cycle for a given crankshaft angle. */
export function cylinderCycleAngle(cylinderIndex: number, globalCrankDeg: number): number {
  return wrapCycle(globalCrankDeg - CYLINDER_PHASE[cylinderIndex]);
}

/**
 * Brightness of the flame kernel for one cylinder, 0 to 1.
 *
 * The spark fires a little before top dead centre. The kernel grows quickly,
 * peaks just after TDC and fades out during the power stroke. This is only for
 * the visuals, it's not a heat-release model.
 */
export function combustionIntensity(cyclePositionDeg: number): number {
  const p = wrapCycle(cyclePositionDeg);
  const advance = 18; // degrees before TDC
  // The window starts at 720 - advance and runs on into the power stroke.
  const since = p >= 720 - advance ? p - (720 - advance) : p + advance;
  if (since < 0 || since > 150) return 0;
  if (since < 14) return since / 14; // kernel growing
  return Math.max(0, Math.pow(1 - (since - 14) / 136, 1.7)); // fading out as the gas expands
}

/** Crank degrees per rendered frame, used to spot aliasing. */
export function crankDegreesPerFrame(
  rpm: number,
  timeScale: number,
  frameSeconds: number,
): number {
  return (rpm / 60) * 360 * timeScale * frameSeconds;
}

/** Sparks per second for one cylinder. A four-stroke fires every other turn, so N/120. */
export function ignitionHzPerCylinder(rpm: number): number {
  return rpm / 120;
}

export interface CylinderState {
  index: number;
  number: number;
  design: DesignId;
  cycleAngle: number;
  /** Fraction of full stroke below TDC, 0 at top and 1 at bottom. */
  dropFraction: number;
  stroke: Stroke;
  combustion: number;
}

/** Everything about each cylinder at one crankshaft angle. */
export function engineState(
  globalCrankDeg: number,
  geometry: EngineGeometry = REFERENCE_ENGINE,
): CylinderState[] {
  const maxDrop = pistonDrop(180, geometry);
  return Array.from({ length: geometry.cylinders }, (_, index) => {
    const cycleAngle = cylinderCycleAngle(index, globalCrankDeg);
    const drop = pistonDrop(cycleAngle, geometry);
    return {
      index,
      number: index + 1,
      design: CYLINDER_DESIGN[index] ?? 'A',
      cycleAngle,
      dropFraction: maxDrop > 0 ? drop / maxDrop : 0,
      stroke: strokeAt(cycleAngle),
      combustion: combustionIntensity(cycleAngle),
    };
  });
}

/** Turn a temperature into a colour on the plug tip heat ramp. */
export function tipColour(temperatureC: number): string {
  // Below the self-cleaning temperature the tip is "cold", and above the
  // pre-ignition limit it's "too hot". In between is where you want to be.
  const stops: Array<[number, [number, number, number]]> = [
    [20, [0.42, 0.46, 0.52]],
    [450, [0.85, 0.55, 0.18]],
    [650, [1.0, 0.68, 0.22]],
    [850, [1.0, 0.42, 0.18]],
    [1000, [1.0, 0.24, 0.2]],
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (temperatureC >= stops[i][0] && temperatureC <= stops[i + 1][0]) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper[0] - lower[0] || 1;
  const t = Math.min(1, Math.max(0, (temperatureC - lower[0]) / span));
  const c = lower[1].map((v, i) => v + (upper[1][i] - v) * t);
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}
