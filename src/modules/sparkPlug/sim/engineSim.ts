/**
 * Engine sim for the Spark Plug page. Everything in the engine animation comes
 * from the crank angle stored here.
 *
 * It's purely kinematic (using AutoTwin's engine/kinematics.ts): the crank turns
 * at the set speed and the pistons, rods, strokes and fire all follow from that
 * one angle. There's no combustion, thermal or solver model. Plug tip
 * temperatures are typed in by the user (demo values by default) because this
 * build isn't connected to a solver.
 */
import { SimStore } from '../../../core/SimStore.ts';
import { REFERENCE_ENGINE, crankDegreesPerFrame, wrapCycle } from '../engine/kinematics.ts';
import type { EngineGeometry } from '../engine/kinematics.ts';

export interface PlugGeometry {
  /** How much insulator nose sticks out below the shell. This is what sets the heat range. */
  noseLength: number;
  noseDiameter: number;
  electrodeDiameter: number;
  electrodeProtrusion: number;
  threadDiameter: number;
  shellLength: number;
}

/** AutoTwin's reference plug (same numbers as REFERENCE_PLUG in their EngineScene). */
export const REFERENCE_PLUG: PlugGeometry = {
  noseLength: 0.0075,
  noseDiameter: 0.0062,
  electrodeDiameter: 0.0025,
  electrodeProtrusion: 0.002,
  threadDiameter: 0.014,
  shellLength: 0.022,
};

export interface EngineParams {
  /** Crankshaft speed, rpm. */
  rpm: number;
  /** Playback speed: engine seconds shown per real second. */
  timeScale: number;
  /** Plug tip temperatures in °C, used to colour the tips. null means no data, and the tip goes grey. */
  tipTempA: number | null;
  tipTempB: number | null;
  plug: PlugGeometry;
  /** Show the fire inside the cylinders. Purely visual, the motion doesn't change. */
  showCombustion: boolean;
}

export const DEFAULT_ENGINE_PARAMS: EngineParams = {
  rpm: 3000,
  timeScale: 0.02,
  tipTempA: 620,
  tipTempB: 700,
  plug: REFERENCE_PLUG,
  showCombustion: true,
};

/** The heat range AutoTwin uses for the plug's firing end. */
export const TIP_WINDOW = { selfCleaningC: 450, preIgnitionC: 850 };

export interface EngineState {
  /** Engine time in seconds (real engine time, not playback time). */
  t: number;
  /** Crank angle within the 720° four-stroke cycle. */
  crankDeg: number;
  /** Total crank rotation since reset, degrees. */
  totalDeg: number;
  /** How many crank degrees the last frame moved. Used to warn about aliasing. */
  lastStepDeg: number;
}

export interface EngineSample {
  t: number;
  rpm: number;
}

export class EngineSim extends SimStore {
  params: EngineParams;
  state!: EngineState;
  history: EngineSample[] = [];
  readonly geometry: EngineGeometry = REFERENCE_ENGINE;
  private nextSampleT = 0;

  constructor(params: Partial<EngineParams> = {}) {
    super();
    this.params = { ...DEFAULT_ENGINE_PARAMS, ...params };
    this.reset();
  }

  /** Firings since reset. An inline-4 fires every 180°. */
  get ignitions() {
    return Math.floor(this.state.totalDeg / 180);
  }
  get omega() {
    return (this.params.rpm * 2 * Math.PI) / 60;
  }

  reset() {
    this.state = { t: 0, crankDeg: 0, totalDeg: 0, lastStepDeg: 0 };
    this.history = [];
    this.nextSampleT = 0;
    this.running = false;
    this.record();
    this.emit();
  }
  play() {
    this.running = true;
    this.emit();
  }
  pause() {
    this.running = false;
    this.state.lastStepDeg = 0;
    this.emit();
  }
  setParams(patch: Partial<EngineParams>) {
    this.params = { ...this.params, ...patch, plug: { ...this.params.plug, ...patch.plug } };
    this.record(true);
    this.emit();
  }

  /** Step forward by one real-time frame, scaled by the playback speed. */
  advanceWall(wallDt: number) {
    if (!this.running) return;
    const dt = Math.min(wallDt, 0.25);
    const step = crankDegreesPerFrame(this.params.rpm, this.params.timeScale, dt);
    this.advanceSim(dt * this.params.timeScale);
    this.state.lastStepDeg = step;
  }

  /** Step engine time forward by `simDt` seconds. */
  advanceSim(simDt: number) {
    const deg = (this.params.rpm / 60) * 360 * simDt;
    const s = this.state;
    s.t += simDt;
    s.totalDeg += deg;
    s.crankDeg = wrapCycle(s.crankDeg + deg);
    s.lastStepDeg = deg;
    if (s.t >= this.nextSampleT) this.record();
    this.emit(true);
  }

  private record(force = false) {
    const last = this.history[this.history.length - 1];
    const sample = { t: this.state.t, rpm: this.params.rpm };
    if (force && last && last.t === sample.t) {
      last.rpm = sample.rpm; // speed changed while paused, so overwrite the last point instead of adding one
    } else {
      this.history.push(sample);
    }
    // Space samples further apart as the run goes on, so long sessions don't pile up points.
    this.nextSampleT = this.state.t + Math.max(0.002, this.state.t / 1500);
    if (this.history.length > 3000) this.history = this.history.filter((_, i) => i % 2 === 0);
  }
}
