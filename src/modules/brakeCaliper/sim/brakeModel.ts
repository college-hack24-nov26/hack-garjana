/**
 * Brake caliper simulation. It's a simplified model meant to show how a brake
 * behaves, not a validated brake solver, so don't use the numbers for design.
 *
 * Everything on the page (the 3D scene, live readings and charts) reads from
 * one BrakeSim object. Nothing else moves the wheel.
 *
 * What it covers, for one front wheel with no weight transfer:
 *   Hydraulics  line pressure follows the command with a lag (separate time
 *               constants for apply and release).
 *   Caliper     fixed, with opposed pistons. They first close the running
 *               clearance, then move a little further as the pads and caliper
 *               compress. On release they follow the pressure back (seal rollback).
 *   Torque      T = 2 · mu_pad · F_clamp · r_eff, where F_clamp = (p - p_contact) · A_side
 *   Grip limit  the tyre can't push harder than mu_road · m_q · g. Anything above
 *               that is dropped, like a perfect ABS, so the wheel never locks.
 *               The UI tells you when this kicks in.
 *   Wheel       rolls without slipping, v = omega · R.
 *               J_eq = m_q R² + J_rot, and J_eq dω/dt = T_drive - T_brake - T_resist
 *   Drive       "cruise" is a basic speed controller with accel limits (throttle
 *               is cut while braking). "coast" means no drive torque at all.
 *   Thermal     the rotor is treated as one lump of iron. It takes its share of
 *               the friction heat and loses heat by convection, more at speed.
 */

import { SimStore } from '../../../core/SimStore.ts';

export type DriveMode = 'cruise' | 'coast';
export type Scenario = 'manual' | 'single-stop' | 'repeated-stops';

export interface BrakeParams {
  /** Starting and target speed, km/h. */
  targetSpeedKmh: number;
  /** Line pressure we ask for when the brake is on, MPa. */
  pressureSetpointMPa: number;
  /** Tyre rolling radius, m. */
  wheelRadius: number;
  /** Share of the car's mass sitting on this wheel, kg. */
  quarterMass: number;
  /** Piston bore, mm. */
  pistonDiaMm: number;
  /** Pistons on each side of the caliper (it's opposed, so both sides match). */
  pistonsPerSide: number;
  /** Friction coefficient between pad and rotor. */
  padMu: number;
  /** Radius on the rotor where the pad force effectively acts, m. */
  rotorEffRadius: number;
  /** Tyre-to-road friction. Sets the grip limit. */
  roadMu: number;
  driveMode: DriveMode;
  ambientC: number;
  /** How long a run lasts in simulated time, s. */
  durationS: number;
  /** Playback speed: simulated seconds shown per real second. */
  playback: number;
  scenario: Scenario;
  /** When the scripted scenarios hit the brake, s. */
  brakeAtS: number;
}

export const DEFAULT_PARAMS: BrakeParams = {
  targetSpeedKmh: 80,
  pressureSetpointMPa: 4,
  wheelRadius: 0.33,
  quarterMass: 400,
  pistonDiaMm: 38,
  pistonsPerSide: 2,
  padMu: 0.4,
  rotorEffRadius: 0.135,
  roadMu: 1.0,
  driveMode: 'cruise',
  ambientC: 25,
  durationS: 30,
  playback: 0.25,
  scenario: 'manual',
  brakeAtS: 2,
};

/** Fixed model constants. The UI lists these too. */
export const MODEL = {
  g: 9.81,
  tauApply: 0.06, // s
  tauRelease: 0.12, // s
  runningClearanceMm: 0.15, // per side
  contactPressureMPa: 0.25, // pressure it takes to close the gap
  complianceMmPerMPa: 0.012, // how much the pads and caliper squash once they touch
  rotatingInertia: 1.6, // kg·m² (wheel + tyre + rotor + hub)
  driveAccelMax: 3.0, // m/s² cruise controller limit
  driveDecelMax: 1.0, // m/s² engine braking limit
  driveGain: 1.5, // 1/s
  rollingResist: 0.012, // coefficient
  aeroCdAQuarter: 0.17, // m² (CdA / 4)
  airDensity: 1.2,
  rotorMass: 9.5, // kg
  rotorCp: 460, // J/(kg·K) grey cast iron
  rotorHeatShare: 0.9,
  rotorCoolArea: 0.2, // m² effective
  dtMax: 0.001, // s integration step
  sampleEvery: 0.05, // s chart sampling
} as const;

export type BrakePhase =
  | 'stopped'
  | 'cruising'
  | 'accelerating'
  | 'coasting'
  | 'braking'
  | 'holding'
  | 'releasing';

export interface BrakeState {
  t: number;
  /** Wheel and rotor speed, rad/s. They're bolted together, so it's one value. */
  omega: number;
  /** Wheel and rotor angle in rad, kept within [0, 2π). */
  theta: number;
  /** True while the brake is on, from either the button or a scenario. */
  brakeCmd: boolean;
  /** Line pressure, MPa. */
  pressure: number;
  /** How far the pistons have moved out from rest, mm. */
  pistonTravelMm: number;
  /** 0 = fully retracted, 1 = pads touching rotor. */
  contactFraction: number;
  /** Clamp force per side, N. */
  clampForce: number;
  /** Brake torque actually reaching the wheel, N·m. */
  brakeTorque: number;
  /** Positive = slowing down, m/s². */
  decel: number;
  rotorTempC: number;
  /** Total energy the brake has turned into heat, J. */
  energyJ: number;
  gripLimited: boolean;
  phase: BrakePhase;
  finished: boolean;
}

export interface Sample {
  t: number;
  rpm: number;
  targetRpm: number;
  pressure: number;
  pressureCmd: number;
  torque: number;
  decel: number;
  tempC: number;
}

export const kmhToRpm = (kmh: number, r: number) => (kmh / 3.6 / r) * (60 / (2 * Math.PI));
export const rpmToKmh = (rpm: number, r: number) => ((rpm * 2 * Math.PI) / 60) * r * 3.6;

export class BrakeSim extends SimStore {
  params: BrakeParams;
  state!: BrakeState;
  history: Sample[] = [];
  manualBrake = false;

  private scenarioBraking = false;
  private scenarioHoldUntil = -1;
  private stopReached = false;
  private nextSampleT = 0;

  constructor(params: Partial<BrakeParams> = {}) {
    super();
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.reset();
  }

  // ---------- derived quantities ----------
  get pistonAreaPerSide() {
    const d = this.params.pistonDiaMm / 1000;
    return this.params.pistonsPerSide * Math.PI * d * d * 0.25;
  }
  get inertia() {
    const { quarterMass, wheelRadius } = this.params;
    return quarterMass * wheelRadius * wheelRadius + MODEL.rotatingInertia;
  }
  get targetOmega() {
    return this.params.targetSpeedKmh / 3.6 / this.params.wheelRadius;
  }
  get rpm() {
    return (this.state.omega * 60) / (2 * Math.PI);
  }
  get speedKmh() {
    return this.state.omega * this.params.wheelRadius * 3.6;
  }
  get pressureCmd() {
    return this.state.brakeCmd ? this.params.pressureSetpointMPa : 0;
  }

  // ---------- control ----------
  reset() {
    const omega0 = this.targetOmega;
    this.state = {
      t: 0,
      omega: omega0,
      theta: 0,
      brakeCmd: false,
      pressure: 0,
      pistonTravelMm: 0,
      contactFraction: 0,
      clampForce: 0,
      brakeTorque: 0,
      decel: 0,
      rotorTempC: this.params.ambientC,
      energyJ: 0,
      gripLimited: false,
      phase: omega0 > 0 ? 'cruising' : 'stopped',
      finished: false,
    };
    this.history = [];
    this.nextSampleT = 0;
    this.scenarioBraking = false;
    this.scenarioHoldUntil = -1;
    this.stopReached = false;
    this.manualBrake = false;
    this.running = false;
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
  setManualBrake(on: boolean) {
    this.manualBrake = on;
    this.emit();
  }
  setParams(patch: Partial<BrakeParams>) {
    const wasStopped = this.state.t === 0 && !this.running;
    this.params = { ...this.params, ...patch };
    // Until a run starts, keep the wheel speed matched to the target speed.
    if (wasStopped && patch.targetSpeedKmh !== undefined) {
      this.state.omega = this.targetOmega;
      this.state.phase = this.state.omega > 0 ? 'cruising' : 'stopped';
      this.history = [];
      this.nextSampleT = 0;
      this.record();
    }
    this.emit();
  }

  /** Step forward by a real-time interval, scaled by the playback speed. */
  advanceWall(wallDt: number) {
    if (!this.running) return;
    // Cap long frames (tab switch, hiccup) so the sim doesn't jump ahead.
    const simDt = Math.min(wallDt, 0.25) * this.params.playback;
    this.advanceSim(simDt);
  }

  /** Step simulated time forward by `simDt` seconds, in small fixed substeps. */
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

  // ---------- physics ----------
  private updateScenario(v: number) {
    const p = this.params;
    const s = this.state;
    const vT = p.targetSpeedKmh / 3.6;
    if (p.scenario === 'single-stop') {
      if (!this.stopReached && s.t >= p.brakeAtS) {
        this.scenarioBraking = true;
        if (v < 0.01) {
          this.stopReached = true;
          this.scenarioHoldUntil = s.t + 1.0; // hold 1 s at standstill, then release
        }
      }
      if (this.stopReached && s.t >= this.scenarioHoldUntil) this.scenarioBraking = false;
    } else if (p.scenario === 'repeated-stops') {
      if (vT <= 0) {
        this.scenarioBraking = false;
        return;
      }
      if (!this.scenarioBraking) {
        if (s.t >= p.brakeAtS && s.t >= this.scenarioHoldUntil && v >= 0.97 * vT) {
          this.scenarioBraking = true;
        }
      } else if (v <= 0.35 * vT) {
        this.scenarioBraking = false;
        this.scenarioHoldUntil = s.t + 1.0; // wait a second before braking again
      }
    } else {
      this.scenarioBraking = false;
    }
  }

  private step(dt: number) {
    const p = this.params;
    const s = this.state;
    const R = p.wheelRadius;
    const v = s.omega * R;

    this.updateScenario(v);
    s.brakeCmd = this.manualBrake || this.scenarioBraking;

    // 1. Hydraulics: pressure follows the command with a lag.
    const pCmd = s.brakeCmd ? p.pressureSetpointMPa : 0;
    const tau = pCmd > s.pressure ? MODEL.tauApply : MODEL.tauRelease;
    s.pressure += (pCmd - s.pressure) * (1 - Math.exp(-dt / tau));
    if (s.pressure < 1e-5) s.pressure = 0;

    // 2. Piston travel (treated as instant for a given pressure).
    const pc = MODEL.contactPressureMPa;
    s.contactFraction = Math.min(1, s.pressure / pc);
    s.pistonTravelMm =
      MODEL.runningClearanceMm * s.contactFraction +
      MODEL.complianceMmPerMPa * Math.max(0, s.pressure - pc);

    // 3. Clamp force, and the most torque the brake could make.
    s.clampForce = Math.max(0, s.pressure - pc) * 1e6 * this.pistonAreaPerSide;
    const torqueCap = 2 * p.padMu * s.clampForce * p.rotorEffRadius;
    const torqueGrip = p.roadMu * p.quarterMass * MODEL.g * R;
    s.gripLimited = torqueCap > torqueGrip && s.omega > 0;
    let tBrake = Math.min(torqueCap, torqueGrip);

    // 4. Drive torque and the losses (rolling resistance, drag).
    const J = this.inertia;
    const braking = s.clampForce > 0;
    let tDrive = 0;
    let tResist = 0;
    if (s.omega > 0) {
      const aRes =
        MODEL.rollingResist * MODEL.g +
        (0.5 * MODEL.airDensity * MODEL.aeroCdAQuarter * v * v) / p.quarterMass;
      tResist = aRes * p.quarterMass * R;
    }
    if (p.driveMode === 'cruise' && !braking && !s.brakeCmd) {
      const vT = p.targetSpeedKmh / 3.6;
      const aCmd = Math.max(
        -MODEL.driveDecelMax,
        Math.min(MODEL.driveAccelMax, MODEL.driveGain * (vT - v)),
      );
      // aCmd is in m/s², so divide by R for angular accel. Adding tResist cancels the losses up front.
      tDrive = (aCmd / R) * J + tResist;
      if (vT === 0 && s.omega <= 0) tDrive = 0;
    }

    // 5. Wheel. Friction can stop it, but must never spin it backwards.
    const omegaPrev = s.omega;
    const alphaFree = (tDrive - tResist) / J;
    let omegaNext = s.omega + (alphaFree - tBrake / J) * dt;
    if (omegaNext < 0) {
      // The wheel stopped partway through this step, so only the torque needed to stop it counts.
      tBrake = Math.max(0, Math.min(tBrake, (s.omega / dt + alphaFree) * J));
      omegaNext = 0;
    }
    if (s.omega === 0 && omegaNext <= 0) tBrake = 0;
    s.omega = omegaNext;
    s.brakeTorque = s.omega > 0 || omegaPrev > 0 ? tBrake : 0;
    s.decel = (-(s.omega - omegaPrev) / dt) * R;
    s.theta = (s.theta + 0.5 * (omegaPrev + s.omega) * dt) % (2 * Math.PI);

    // 6. Rotor temperature (one lump of iron).
    const omegaMean = 0.5 * (omegaPrev + s.omega);
    const pFriction = s.brakeTorque * omegaMean; // W
    const vMean = omegaMean * R;
    const h = 15 + 5.5 * Math.pow(vMean, 0.8); // W/(m²·K)
    const qOut = h * MODEL.rotorCoolArea * (s.rotorTempC - p.ambientC);
    const C = MODEL.rotorMass * MODEL.rotorCp;
    s.rotorTempC += ((MODEL.rotorHeatShare * pFriction - qOut) / C) * dt;
    s.energyJ += pFriction * dt;

    s.t += dt;

    // 7. Label for what the brake is doing right now.
    const vT = p.targetSpeedKmh / 3.6;
    const vNow = s.omega * R;
    if (s.brakeCmd && s.omega <= 0) s.phase = 'holding';
    else if (s.brakeCmd) s.phase = 'braking';
    else if (s.pressure > 0.02) s.phase = 'releasing';
    else if (s.omega <= 0) s.phase = 'stopped';
    else if (p.driveMode === 'coast') s.phase = 'coasting';
    else if (vNow < vT - 0.3) s.phase = 'accelerating';
    else s.phase = 'cruising';

    if (s.t >= this.nextSampleT - 1e-9) this.record();
  }

  private record() {
    const s = this.state;
    this.history.push({
      t: s.t,
      rpm: this.rpm,
      targetRpm: kmhToRpm(this.params.targetSpeedKmh, this.params.wheelRadius),
      pressure: s.pressure,
      pressureCmd: this.pressureCmd,
      torque: s.brakeTorque,
      decel: s.decel,
      tempC: s.rotorTempC,
    });
    this.nextSampleT = s.t + MODEL.sampleEvery;
  }
}
