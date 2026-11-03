/**
 * Alloy wheel simulation: one front-left wheel of a car driving a scripted or
 * manual manoeuvre. It's a simplified model meant to show how the wheel is
 * loaded, not a validated wheel solver, so don't use the numbers for design.
 *
 * Everything on the page (the 3D, live readings and charts) reads this one
 * WheelSim object. Nothing else turns the wheel.
 *
 *   Vehicle   longitudinal and lateral acceleration follow the commands with a
 *             first-order lag. Speed integrates the longitudinal acceleration.
 *   Load      Fz = Fz0 · (1 − χx·ax/g + χy·ay/g): weight moves forward under
 *             braking and onto this (left) wheel in a right-hand turn.
 *   Tyre      Fx = Fz·ax/g and Fy = Fz·ay/g (forces shared in proportion to
 *             load), capped by the friction circle μ·Fz. Vertical stiffness
 *             rises with pressure; the deflection sets the loaded radius.
 *   Wheel     rolls without slip on its effective radius, v = ω·R_e.
 *   Spokes    see loads.ts: reduced-order load path and beam stresses.
 *   Rim       thin-wall hoop stress from inflation, p·r/t, plus spin, ρω²r².
 *   Fatigue   each spoke sees one stress cycle per turn. Basquin + Goodman +
 *             Miner, on illustrative constants. It ranks conditions; it is not
 *             a life prediction.
 */
import { SimStore } from '../../../core/SimStore.ts';
import { DRAWING_DESIGN, FIXED, massProperties, sanitizeDesign, wheelLayout } from '../wheel/drawing.ts';
import type { MassProps, WheelDesign, WheelLayout } from '../wheel/drawing.ts';
import { fatigueStrength, findWheelMaterial } from '../wheel/materials.ts';
import type { WheelMaterial, WheelMaterialId } from '../wheel/materials.ts';
import { SPOTS, overturningMoment, revolutionCycle, spokeLoads, spotCoeffs, spotStress, wheelTorque } from './loads.ts';
import type { ArmLoad, CycleSample, PatchLoads, SpotCoeffs, SpotId } from './loads.ts';

export type Scenario = 'manual' | 'cruise' | 'brake-stop' | 'cornering' | 'handling-loop';

export interface WheelParams extends WheelDesign {
  /** Cruise speed the driver returns to, km/h. */
  targetSpeedKmh: number;
  /** Static load on this wheel, N. Demo fixture, same default as the backend profile. */
  staticLoadN: number;
  tyrePressureBar: number;
  /** Deceleration used whenever the script or driver brakes, in g. */
  brakeG: number;
  /** Lateral acceleration used in turns, in g. */
  lateralG: number;
  /** Acceleration used when the driver accelerates, in g. */
  accelG: number;
  roadMu: number;
  materialId: WheelMaterialId;
  /** Stress-concentration factor at the spoke junctions. */
  kt: number;
  scenario: Scenario;
  durationS: number;
  /** Simulated seconds shown per real second. */
  playback: number;
  /** When the scripted scenarios start their manoeuvre, s. */
  manoeuvreAtS: number;
}

export const DEFAULT_PARAMS: WheelParams = {
  ...DRAWING_DESIGN,
  targetSpeedKmh: 90,
  staticLoadN: 4500,
  tyrePressureBar: 2.5,
  brakeG: 0.8,
  lateralG: 0.6,
  accelG: 0.3,
  roadMu: 1.0,
  materialId: 'a356-t6',
  kt: 1.0,
  scenario: 'handling-loop',
  durationS: 36,
  playback: 0.25,
  manoeuvreAtS: 2,
};

/** Fixed model constants. The UI lists these too. */
export const MODEL = {
  g: 9.81,
  cgHeight: 0.55, // m
  wheelbase: 2.8, // m
  track: 1.6, // m
  tauVehicle: 0.3, // s, lag from command to acceleration
  cruiseGain: 0.8, // 1/s
  cruiseDecelMaxG: 0.1,
  tyreStiffnessBase: 100e3, // N/m at 0 bar (carcass)
  tyreStiffnessPerBar: 90e3, // N/m per bar
  loopPeriodS: 12,
  dtMax: 0.002, // s
  sampleEvery: 0.05, // s chart sampling
  cycleEvery: 0.02, // s between fatigue-cycle refreshes
  minLoadFrac: 0.05,
} as const;

/** Load-transfer gains for a front wheel, from CG height, wheelbase and track. */
export const LOAD_TRANSFER = {
  long: (2 * MODEL.cgHeight) / MODEL.wheelbase,
  lat: (2 * MODEL.cgHeight) / MODEL.track,
};

export type WheelPhase = 'stopped' | 'holding' | 'cruising' | 'accelerating' | 'braking' | 'corner-outer' | 'corner-inner';

/** The scripted handling loop, one period. */
export const LOOP_SCRIPT: { from: number; to: number; brake?: boolean; turn?: 1 | -1; label: string }[] = [
  { from: 0, to: 2.5, label: 'straight' },
  { from: 2.5, to: 5.5, turn: 1, label: 'right turn: this wheel outside' },
  { from: 5.5, to: 7, brake: true, label: 'brake' },
  { from: 7, to: 8.5, label: 'straight' },
  { from: 8.5, to: 11, turn: -1, label: 'left turn: this wheel inside' },
  { from: 11, to: 12, label: 'straight' },
];

export interface WheelState {
  t: number;
  /** Vehicle speed, m/s. */
  v: number;
  omega: number;
  /** Wheel angle, rad, in [0, 2π). Spoke 1 points up at 0. */
  theta: number;
  /** Longitudinal acceleration, m/s² (negative = braking). */
  ax: number;
  /** Lateral acceleration, m/s² (positive = right turn, this wheel outside). */
  ay: number;
  Fz: number;
  Fx: number;
  Fy: number;
  gripLimited: boolean;
  deflection: number;
  loadedRadius: number;
  effRadius: number;
  torque: number;
  moment: number;
  arms: ArmLoad[];
  /** Highest stress at each spot over all spokes right now, MPa. */
  spots: Record<SpotId, number>;
  peakMPa: number;
  peakSpot: SpotId;
  peakArm: number;
  hoopMPa: number;
  spinMPa: number;
  revolutions: number;
  distanceM: number;
  damage: number;
  damagePerRev: number;
  critSpot: SpotId;
  ampMPa: number;
  meanMPa: number;
  eqAmpMPa: number;
  phase: WheelPhase;
  finished: boolean;
}

export interface WheelSample {
  t: number;
  kmh: number;
  targetKmh: number;
  rpm: number;
  FzkN: number;
  Fz0kN: number;
  peakMPa: number;
  limitMPa: number;
}

export class WheelSim extends SimStore {
  params: WheelParams;
  state!: WheelState;
  history: WheelSample[] = [];
  cycle: CycleSample[] = [];
  layout!: WheelLayout;
  mass!: MassProps;
  material!: WheelMaterial;
  coeffs!: SpotCoeffs;
  /** Bumped whenever the geometry changes, so the 3D rebuilds. */
  geometryVersion = 0;
  manual = { brake: false, accel: false, turn: 0 as -1 | 0 | 1 };

  private nextSampleT = 0;
  private nextCycleT = 0;
  private revsAtCycle = 0;
  private stopHoldUntil = -1;
  private stopDone = false;

  constructor(params: Partial<WheelParams> = {}) {
    super();
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.rebuild();
    this.reset();
  }

  // ---------- derived ----------
  get rpm() {
    return (this.state.omega * 60) / (2 * Math.PI);
  }
  get speedKmh() {
    return this.state.v * 3.6;
  }
  get tyreStiffness() {
    return MODEL.tyreStiffnessBase + MODEL.tyreStiffnessPerBar * this.params.tyrePressureBar;
  }
  /** Fatigue strength at 10⁷ cycles for the chosen material, MPa (colour-scale and chart reference). */
  get fatigueLimitMPa() {
    return fatigueStrength(this.material, 1e7);
  }
  /** Life left at today's condition if it never changed, km. Infinity when the damage rate is ~0. */
  get lifeKm() {
    const perKm = (this.state.damagePerRev / (2 * Math.PI * this.state.effRadius)) * 1000;
    return perKm > 0 ? 1 / perKm : Infinity;
  }
  get patch(): PatchLoads {
    const s = this.state;
    return { Fz: s.Fz, Fy: s.Fy, Fx: s.Fx, loadedRadius: s.loadedRadius };
  }

  // ---------- control ----------
  private rebuild() {
    const design = sanitizeDesign(this.params);
    Object.assign(this.params, design);
    this.layout = wheelLayout(design);
    this.material = findWheelMaterial(this.params.materialId);
    this.mass = massProperties(this.layout, this.material.densityKgM3);
    this.coeffs = spotCoeffs(this.layout, this.params.kt);
    this.geometryVersion++;
  }

  reset() {
    const v0 = this.params.targetSpeedKmh / 3.6;
    const Fz = this.params.staticLoadN;
    const delta = Fz / this.tyreStiffness;
    this.state = {
      t: 0,
      v: v0,
      omega: v0 / (FIXED.tyreFreeRadius - delta / 3),
      theta: 0,
      ax: 0,
      ay: 0,
      Fz,
      Fx: 0,
      Fy: 0,
      gripLimited: false,
      deflection: delta,
      loadedRadius: FIXED.tyreFreeRadius - delta,
      effRadius: FIXED.tyreFreeRadius - delta / 3,
      torque: 0,
      moment: 0,
      arms: [],
      spots: { 'arm-root': 0, 'leg-fork': 0, 'leg-rim': 0 },
      peakMPa: 0,
      peakSpot: 'leg-rim',
      peakArm: 0,
      hoopMPa: 0,
      spinMPa: 0,
      revolutions: 0,
      distanceM: 0,
      damage: 0,
      damagePerRev: 0,
      critSpot: 'leg-rim',
      ampMPa: 0,
      meanMPa: 0,
      eqAmpMPa: 0,
      phase: v0 > 0 ? 'cruising' : 'stopped',
      finished: false,
    };
    this.history = [];
    this.nextSampleT = 0;
    this.nextCycleT = 0;
    this.revsAtCycle = 0;
    this.stopHoldUntil = -1;
    this.stopDone = false;
    this.manual = { brake: false, accel: false, turn: 0 };
    this.running = false;
    this.updateLoads(0);
    this.refreshCycle();
    this.record();
    this.emit();
  }

  play() {
    if (this.state.finished) this.reset();
    this.running = true;
    this.emit();
  }
  pause() {
    this.running = false;
    this.emit();
  }
  setManual(patch: Partial<WheelSim['manual']>) {
    this.manual = { ...this.manual, ...patch };
    this.emit();
  }

  setParams(patch: Partial<WheelParams>) {
    const idle = this.state.t === 0 && !this.running;
    this.params = { ...this.params, ...patch };
    const geometryKeys: (keyof WheelParams)[] = [
      'spokeCount', 'forkRadiusMm', 'legSpreadMm', 'legWidthMm', 'armWidthMm', 'spokeDepthRimMm', 'blendRadiusMm', 'materialId', 'kt',
    ];
    if (geometryKeys.some((k) => k in patch)) this.rebuild();
    if (idle && (patch.targetSpeedKmh !== undefined || patch.staticLoadN !== undefined || patch.tyrePressureBar !== undefined)) {
      this.reset();
      return;
    }
    // Re-evaluate at the current state so the readouts follow the change straight away.
    this.updateLoads(0);
    this.refreshCycle();
    if (this.history.length) {
      const last = this.history[this.history.length - 1];
      last.limitMPa = this.fatigueLimitMPa;
    }
    this.emit();
  }

  /** Step forward by a real-time interval, scaled by the playback speed. */
  advanceWall(wallDt: number) {
    if (!this.running) return;
    this.advanceSim(Math.min(wallDt, 0.25) * this.params.playback);
  }

  advanceSim(simDt: number) {
    let remaining = simDt;
    while (remaining > 1e-9 && !this.state.finished) {
      const dt = Math.min(MODEL.dtMax, remaining, this.params.durationS - this.state.t);
      if (dt <= 0) break;
      this.step(dt);
      remaining -= dt;
      if (this.state.t >= this.params.durationS - 1e-9) {
        this.state.finished = true;
        this.running = false;
      }
    }
    this.emit(true);
  }

  // ---------- driver ----------
  /** What the driver (or script) is asking for right now. */
  commands(): { brake: boolean; accel: boolean; turn: -1 | 0 | 1 } {
    const p = this.params;
    const s = this.state;
    switch (p.scenario) {
      case 'manual':
        return { ...this.manual };
      case 'cruise':
        return { brake: false, accel: false, turn: 0 };
      case 'brake-stop': {
        if (!this.stopDone && s.t >= p.manoeuvreAtS) {
          if (s.v <= 0.01) {
            if (this.stopHoldUntil < 0) this.stopHoldUntil = s.t + 1.5;
            if (s.t >= this.stopHoldUntil) this.stopDone = true;
          }
          return { brake: !this.stopDone, accel: false, turn: 0 };
        }
        return { brake: false, accel: false, turn: 0 };
      }
      case 'cornering':
        return { brake: false, accel: false, turn: s.t >= p.manoeuvreAtS ? 1 : 0 };
      case 'handling-loop': {
        if (s.t < p.manoeuvreAtS) return { brake: false, accel: false, turn: 0 };
        const tl = (s.t - p.manoeuvreAtS) % MODEL.loopPeriodS;
        const seg = LOOP_SCRIPT.find((x) => tl >= x.from && tl < x.to) ?? LOOP_SCRIPT[0];
        return { brake: !!seg.brake, accel: false, turn: seg.turn ?? 0 };
      }
    }
  }

  // ---------- physics ----------
  private step(dt: number) {
    const p = this.params;
    const s = this.state;
    const g = MODEL.g;
    const cmd = this.commands();

    // 1. Driver: acceleration commands.
    const vT = p.targetSpeedKmh / 3.6;
    let axCmd: number;
    if (cmd.brake) axCmd = -p.brakeG * g;
    else if (cmd.accel) axCmd = p.accelG * g;
    else axCmd = Math.max(-MODEL.cruiseDecelMaxG * g, Math.min(p.accelG * g, MODEL.cruiseGain * (vT - s.v)));
    if (s.v <= 0 && axCmd < 0) axCmd = 0;
    // No lateral acceleration without speed: fade turns in below 8 m/s.
    const ayCmd = cmd.turn * p.lateralG * g * Math.min(1, s.v / 8);
    const k = 1 - Math.exp(-dt / MODEL.tauVehicle);
    s.ax += (axCmd - s.ax) * k;
    s.ay += (ayCmd - s.ay) * k;

    // 2. Tyre forces with the friction circle. Saturation also limits the car.
    let Fz = this.wheelLoad(s.ax, s.ay);
    const need = Math.hypot(s.ax, s.ay) / g;
    s.gripLimited = need * Fz > p.roadMu * Fz + 1e-9 && need > 0;
    if (s.gripLimited) {
      const scale = p.roadMu / need;
      s.ax *= scale;
      s.ay *= scale;
      Fz = this.wheelLoad(s.ax, s.ay);
    }
    s.Fz = Fz;
    s.Fx = (Fz * s.ax) / g;
    s.Fy = (Fz * s.ay) / g;

    // 3. Vehicle speed.
    s.v += s.ax * dt;
    if (s.v <= 0) {
      s.v = 0;
      if (s.ax < 0) s.ax = 0;
    }

    // 4. Wheel: rolls without slip on the effective radius.
    this.updateLoads(dt);
    s.t += dt;

    // 5. Fatigue: refresh the per-revolution cycle every few ms and integrate damage.
    if (s.t >= this.nextCycleT - 1e-9) this.refreshCycle();

    // 6. What the car is doing.
    if (s.v <= 0.01) s.phase = cmd.brake ? 'holding' : 'stopped';
    else if (s.ax < -0.5) s.phase = 'braking';
    else if (Math.abs(s.ay) > 0.5) s.phase = s.ay > 0 ? 'corner-outer' : 'corner-inner';
    else if (s.ax > 0.3) s.phase = 'accelerating';
    else s.phase = 'cruising';

    if (s.t >= this.nextSampleT - 1e-9) this.record();
  }

  private wheelLoad(ax: number, ay: number) {
    const Fz0 = this.params.staticLoadN;
    const f = 1 - (LOAD_TRANSFER.long * ax) / MODEL.g + (LOAD_TRANSFER.lat * ay) / MODEL.g;
    return Fz0 * Math.max(MODEL.minLoadFrac, f);
  }

  /** Tyre deflection, radii, rotation over dt, spoke loads and spot stresses at the current state. */
  private updateLoads(dt: number) {
    const s = this.state;
    const p = this.params;
    s.deflection = s.Fz / this.tyreStiffness;
    s.loadedRadius = FIXED.tyreFreeRadius - s.deflection;
    s.effRadius = FIXED.tyreFreeRadius - s.deflection / 3;
    const omegaPrev = s.omega;
    s.omega = s.v / s.effRadius;
    const dTheta = 0.5 * (omegaPrev + s.omega) * dt;
    s.theta = (s.theta + dTheta) % (2 * Math.PI);
    s.revolutions += dTheta / (2 * Math.PI);
    s.distanceM += s.v * dt;

    const patch = this.patch;
    s.torque = wheelTorque(patch);
    s.moment = overturningMoment(this.layout, patch);
    spokeLoads(this.layout, patch, s.theta, s.arms);

    s.peakMPa = 0;
    for (const spot of SPOTS) {
      let hi = 0;
      s.arms.forEach((a, i) => {
        const v = spotStress(this.coeffs[spot.id], a);
        if (v > hi) hi = v;
        if (v > s.peakMPa) {
          s.peakMPa = v;
          s.peakSpot = spot.id;
          s.peakArm = i;
        }
      });
      s.spots[spot.id] = hi;
    }

    const pPa = p.tyrePressureBar * 1e5;
    s.hoopMPa = (pPa * FIXED.rSeat) / FIXED.wall / 1e6;
    s.spinMPa = (this.material.densityKgM3 * s.omega * s.omega * FIXED.rSeat * FIXED.rSeat) / 1e6;
  }

  private refreshCycle() {
    const s = this.state;
    // Damage done since the last refresh, at the rate that was in force over it.
    s.damage += s.damagePerRev * Math.max(0, s.revolutions - this.revsAtCycle);
    this.revsAtCycle = s.revolutions;
    const c = revolutionCycle(this.layout, this.patch, this.coeffs, this.material);
    s.damagePerRev = c.damagePerRev;
    s.critSpot = c.spot;
    s.ampMPa = c.ampMPa;
    s.meanMPa = c.meanMPa;
    s.eqAmpMPa = c.eqAmpMPa;
    this.cycle = c.samples;
    this.nextCycleT = s.t + MODEL.cycleEvery;
  }

  private record() {
    const s = this.state;
    this.history.push({
      t: s.t,
      kmh: this.speedKmh,
      targetKmh: this.params.targetSpeedKmh,
      rpm: this.rpm,
      FzkN: s.Fz / 1000,
      Fz0kN: this.params.staticLoadN / 1000,
      peakMPa: s.peakMPa,
      limitMPa: this.fatigueLimitMPa,
    });
    this.nextSampleT = s.t + MODEL.sampleEvery;
  }
}
