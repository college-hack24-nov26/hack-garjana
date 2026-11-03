/**
 * Where the crank pin, rod and wrist pin sit, for drawing the engine. Built on
 * AutoTwin's pistonDrop formula.
 *
 * The crank centre is at the origin, the cylinder points up +Y and the crank
 * turns about X. At θ = 0 (TDC) the crank pin points straight up at the piston.
 *
 * This replaces the maths that used to be inline in the original EngineScene.
 * There the rod got scaled to fit (54% of its length at 90°, 10% at BDC) and its
 * bottom end was mirrored in z from the crank pin. Here the rod is rigid, so the
 * wrist pin is always exactly l away from the crank pin.
 */
import { pistonDrop } from './kinematics.ts';
import type { EngineGeometry } from './kinematics.ts';

export interface Linkage {
  /** Crank pin centre (y, z). */
  pinY: number;
  pinZ: number;
  /** Wrist (gudgeon) pin height on the cylinder axis. */
  wristY: number;
  /** Rotation about X that turns a rod modelled along +Y so it runs from crank pin to wrist pin. */
  rodAngle: number;
}

export function crankLinkage(cycleDeg: number, g: EngineGeometry): Linkage {
  const r = g.stroke / 2;
  const theta = (cycleDeg * Math.PI) / 180;
  const pinY = r * Math.cos(theta);
  const pinZ = r * Math.sin(theta);
  // r + l - drop is the same as r cos θ + √(l² - r² sin² θ)
  const wristY = r + g.rodLength - pistonDrop(cycleDeg, g);
  return { pinY, pinZ, wristY, rodAngle: Math.atan2(-pinZ, wristY - pinY) };
}

/** Piston speed at a crank angle, m/s. Positive means moving down, away from TDC. */
export function pistonVelocity(cycleDeg: number, rpm: number, g: EngineGeometry): number {
  const r = g.stroke / 2;
  const l = g.rodLength;
  const theta = (cycleDeg * Math.PI) / 180;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const dDropDTheta = r * s + (r * r * s * c) / Math.sqrt(Math.max(l * l - r * r * s * s, 1e-12));
  return dDropDTheta * ((rpm * 2 * Math.PI) / 60);
}

/** Mean piston speed 2·S·N/60 (m/s). */
export const meanPistonSpeed = (rpm: number, g: EngineGeometry) => (2 * g.stroke * rpm) / 60;
