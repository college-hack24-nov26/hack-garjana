/**
 * Experiment protocols: put design A and design B through exactly the same
 * test and record what comes out. Pure functions, no React, so they run the
 * same in the browser and in the Node checks.
 *
 * Brake tests run the same simplified brake dynamics as the Digital Twin
 * (BrakeSim), headless and as fast as the CPU allows. Only the caliper's piston
 * bore and piston count change between A and B. Everything else is a test
 * condition. Structural and thermal sweeps use the Design Lab estimators.
 */
import { BrakeSim } from '../modules/brakeCaliper/sim/brakeModel.ts';
import { TIP_WINDOW_C } from './designs.ts';
import type { CaliperDesign, CaliperInputs, ComponentId, PlugDesign, PlugInputs, Slot } from './designs.ts';
import { caliperEstimate, plugEstimate } from './estimators.ts';
import { validateCaliper } from './validation.ts';
import type { ExperimentRun, RunMetric, RunSeries } from './WorkspaceStore.ts';

export type ProtocolId = 'brake-stop' | 'brake-fade' | 'caliper-pressure' | 'plug-speed' | 'plug-load';

export interface Protocol {
  id: ProtocolId;
  component: ComponentId;
  name: string;
  what: string;
  source: 'model' | 'estimated';
}

export const PROTOCOLS: Protocol[] = [
  {
    id: 'brake-stop',
    component: 'brake-caliper',
    name: 'Single stop',
    what: 'Cruise at the test speed, apply the brake at the test pressure and hold it to a standstill.',
    source: 'model',
  },
  {
    id: 'brake-fade',
    component: 'brake-caliper',
    name: 'Repeated stops (heat build-up)',
    what: 'Brake to 35 % of the test speed, re-accelerate, repeat. Watches how hot the rotor gets.',
    source: 'model',
  },
  {
    id: 'caliper-pressure',
    component: 'brake-caliper',
    name: 'Line-pressure sweep (structural)',
    what: 'Bridge stress and mouth opening from 2 to 18 MPa, against the allowables.',
    source: 'estimated',
  },
  {
    id: 'plug-speed',
    component: 'spark-plug',
    name: 'Engine-speed sweep',
    what: 'Firing-end temperature from 800 to 7000 rpm at the test load, against the 450–850 °C window.',
    source: 'estimated',
  },
  {
    id: 'plug-load',
    component: 'spark-plug',
    name: 'Load sweep',
    what: 'Firing-end temperature from 10 to 100 % load at the test speed.',
    source: 'estimated',
  },
];

export interface BrakeConditions {
  speedKmh: number;
  pressureMPa: number;
  padMu: number;
  roadMu: number;
  quarterMassKg: number;
  /** Repeated-stops test length, s. */
  fadeDurationS: number;
}

export const BRAKE_CONDITIONS_DEFAULT: BrakeConditions = {
  speedKmh: 100,
  pressureMPa: 6,
  padMu: 0.4,
  roadMu: 1.0,
  quarterMassKg: 400,
  fadeDurationS: 90,
};

export interface PlugConditions {
  loadPct: number;
  rpm: number;
}

/* ------------------------------------------------------------------ */
/*  Brake: one stop                                                    */
/* ------------------------------------------------------------------ */

export interface StopResult {
  stopTimeS: number;
  stopDistanceM: number;
  peakDecelG: number;
  peakTorqueNm: number;
  peakRotorC: number;
  gripLimitedPct: number;
  stopped: boolean;
  speedTrace: { t: number; v: number }[];
  tempTrace: { t: number; v: number }[];
}

function brakeSimFor(d: CaliperDesign, c: BrakeConditions, extra: Partial<ConstructorParameters<typeof BrakeSim>[0]> = {}) {
  return new BrakeSim({
    targetSpeedKmh: c.speedKmh,
    pressureSetpointMPa: c.pressureMPa,
    pistonDiaMm: d.pistonBoreMm,
    pistonsPerSide: d.pistonsPerSide,
    padMu: c.padMu,
    roadMu: c.roadMu,
    quarterMass: c.quarterMassKg,
    scenario: 'manual',
    durationS: 60,
    ...extra,
  });
}

export function simulateStop(d: CaliperDesign, c: BrakeConditions): StopResult {
  const sim = brakeSimFor(d, c);
  sim.play();
  sim.advanceSim(0.5); // settle at cruise
  const t0 = sim.state.t;
  sim.setManualBrake(true);
  const R = sim.params.wheelRadius;
  const dt = 0.01;
  let dist = 0;
  let peakDecel = 0;
  let peakTorque = 0;
  let peakTemp = sim.state.rotorTempC;
  let gripSteps = 0;
  let steps = 0;
  const speedTrace = [{ t: 0, v: sim.speedKmh }];
  const tempTrace = [{ t: 0, v: sim.state.rotorTempC }];
  let vPrev = sim.state.omega * R;
  let nextSample = 0.05;
  while (sim.state.omega > 0 && sim.state.t - t0 < 40) {
    sim.advanceSim(dt);
    const v = sim.state.omega * R;
    dist += 0.5 * (v + vPrev) * dt;
    vPrev = v;
    peakDecel = Math.max(peakDecel, sim.state.decel);
    peakTorque = Math.max(peakTorque, sim.state.brakeTorque);
    peakTemp = Math.max(peakTemp, sim.state.rotorTempC);
    if (sim.state.gripLimited) gripSteps++;
    steps++;
    const t = sim.state.t - t0;
    if (t >= nextSample - 1e-9) {
      speedTrace.push({ t, v: sim.speedKmh });
      tempTrace.push({ t, v: sim.state.rotorTempC });
      nextSample += 0.05;
    }
  }
  const stopped = sim.state.omega === 0;
  // The rotor keeps soaking heat for a moment after the stop; hold one more second.
  for (let i = 0; i < 100; i++) {
    sim.advanceSim(dt);
    peakTemp = Math.max(peakTemp, sim.state.rotorTempC);
  }
  return {
    stopTimeS: sim.state.t - t0 - 1,
    stopDistanceM: dist,
    peakDecelG: peakDecel / 9.81,
    peakTorqueNm: peakTorque,
    peakRotorC: peakTemp,
    gripLimitedPct: steps ? (100 * gripSteps) / steps : 0,
    stopped,
    speedTrace,
    tempTrace,
  };
}

/* ------------------------------------------------------------------ */
/*  Brake: repeated stops                                              */
/* ------------------------------------------------------------------ */

export interface FadeResult {
  peakRotorC: number;
  finalRotorC: number;
  applications: number;
  energyMJ: number;
  tempTrace: { t: number; v: number }[];
}

export function simulateFade(d: CaliperDesign, c: BrakeConditions): FadeResult {
  const sim = brakeSimFor(d, c, { scenario: 'repeated-stops', durationS: c.fadeDurationS, brakeAtS: 2 });
  sim.play();
  const tempTrace: { t: number; v: number }[] = [{ t: 0, v: sim.state.rotorTempC }];
  let peak = sim.state.rotorTempC;
  let applications = 0;
  let wasBraking = false;
  while (!sim.state.finished) {
    sim.advanceSim(0.05);
    peak = Math.max(peak, sim.state.rotorTempC);
    const braking = sim.state.brakeCmd;
    if (braking && !wasBraking) applications++;
    wasBraking = braking;
    if (tempTrace.length === 0 || sim.state.t - tempTrace[tempTrace.length - 1].t >= 0.5 - 1e-9) {
      tempTrace.push({ t: sim.state.t, v: sim.state.rotorTempC });
    }
  }
  return { peakRotorC: peak, finalRotorC: sim.state.rotorTempC, applications, energyMJ: sim.state.energyJ / 1e6, tempTrace };
}

/* ------------------------------------------------------------------ */
/*  Build the run records                                              */
/* ------------------------------------------------------------------ */

type RunDraft = Omit<ExperimentRun, 'id' | 'createdAt'>;

/** No FAIL from the validation engine (NEEDS REVIEW still counts as feasible). */
function caliperFeasible(designs: Record<Slot, CaliperDesign>, inputs: CaliperInputs) {
  return {
    A: validateCaliper('A', designs.A, inputs).verdict !== 'fail',
    B: validateCaliper('B', designs.B, inputs, designs.A).verdict !== 'fail',
  };
}

/** Pairs two traces sampled on (roughly) the same time grid into chart points. */
function pairTraces(a: { t: number; v: number }[], b: { t: number; v: number }[]) {
  const n = Math.max(a.length, b.length);
  const at = (tr: { t: number; v: number }[], i: number) => tr[Math.min(i, tr.length - 1)].v;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i < a.length ? a[i] : b[i]).t;
    pts.push({ x: t, A: at(a, i), B: at(b, i) });
  }
  return pts;
}

const metric = (key: string, label: string, unit: string, digits: number, A: number, B: number, lowerIsBetter: boolean | null): RunMetric => ({
  key,
  label,
  unit,
  digits,
  A,
  B,
  lowerIsBetter,
});

export function runBrakeStop(designs: Record<Slot, CaliperDesign>, c: BrakeConditions, inputs: CaliperInputs): RunDraft {
  const A = simulateStop(designs.A, c);
  const B = simulateStop(designs.B, c);
  const series: RunSeries[] = [
    { title: 'Vehicle speed during the stop', xLabel: 'time from brake application, s', yUnit: 'km/h', points: pairTraces(A.speedTrace, B.speedTrace) },
    { title: 'Rotor temperature', xLabel: 'time from brake application, s', yUnit: '°C', points: pairTraces(A.tempTrace, B.tempTrace) },
  ];
  return {
    component: 'brake-caliper',
    kind: 'brake-stop',
    title: `Single stop from ${c.speedKmh} km/h at ${c.pressureMPa} MPa`,
    revisions: { A: designs.A.revision, B: designs.B.revision },
    source: 'model',
    conditions: `${c.speedKmh} km/h · ${c.pressureMPa} MPa · pad μ ${c.padMu} · road μ ${c.roadMu} · ${c.quarterMassKg} kg per wheel`,
    metrics: [
      metric('stopDist', 'Stopping distance', 'm', 1, A.stopDistanceM, B.stopDistanceM, true),
      metric('stopTime', 'Stopping time', 's', 2, A.stopTimeS, B.stopTimeS, true),
      metric('decel', 'Peak deceleration', 'g', 2, A.peakDecelG, B.peakDecelG, false),
      metric('torque', 'Peak brake torque', 'N·m', 0, A.peakTorqueNm, B.peakTorqueNm, null),
      metric('rotor', 'Peak rotor temperature', '°C', 1, A.peakRotorC, B.peakRotorC, true),
      metric('grip', 'Time at the tyre grip limit', '%', 0, A.gripLimitedPct, B.gripLimitedPct, null),
    ],
    series,
    feasible: caliperFeasible(designs, inputs),
  };
}

export function runBrakeFade(designs: Record<Slot, CaliperDesign>, c: BrakeConditions, inputs: CaliperInputs): RunDraft {
  const A = simulateFade(designs.A, c);
  const B = simulateFade(designs.B, c);
  return {
    component: 'brake-caliper',
    kind: 'brake-fade',
    title: `Repeated stops, ${c.fadeDurationS} s from ${c.speedKmh} km/h`,
    revisions: { A: designs.A.revision, B: designs.B.revision },
    source: 'model',
    conditions: `${c.speedKmh} km/h → 35 % and back · ${c.pressureMPa} MPa · ${c.fadeDurationS} s · pad μ ${c.padMu}`,
    metrics: [
      metric('peak', 'Peak rotor temperature', '°C', 1, A.peakRotorC, B.peakRotorC, true),
      metric('final', 'Rotor temperature at the end', '°C', 1, A.finalRotorC, B.finalRotorC, true),
      metric('apps', 'Brake applications', '–', 0, A.applications, B.applications, null),
      metric('energy', 'Energy turned into heat', 'MJ', 2, A.energyMJ, B.energyMJ, null),
    ],
    series: [{ title: 'Rotor temperature', xLabel: 'time, s', yUnit: '°C', points: pairTraces(A.tempTrace, B.tempTrace) }],
    feasible: caliperFeasible(designs, inputs),
  };
}

export function runCaliperPressureSweep(designs: Record<Slot, CaliperDesign>, inputs: CaliperInputs): RunDraft {
  const pressures: number[] = [];
  for (let p = 2; p <= 18 + 1e-9; p += 0.5) pressures.push(p);
  const at = (slot: Slot, p: number) => caliperEstimate(designs[slot], { ...inputs, linePressureMPa: p });
  const stress = pressures.map((p) => ({ x: p, A: at('A', p).peakStressMPa, B: at('B', p).peakStressMPa }));
  const mouth = pressures.map((p) => ({ x: p, A: at('A', p).mouthOpeningMm, B: at('B', p).mouthOpeningMm }));
  // Both quantities are linear in pressure in this model, so the limit pressure follows directly.
  const ref = { A: caliperEstimate(designs.A, inputs), B: caliperEstimate(designs.B, inputs) };
  const pStress = (s: Slot) => inputs.linePressureMPa * (inputs.allowableStressMPa / ref[s].peakStressMPa);
  const pMouth = (s: Slot) => inputs.linePressureMPa * (inputs.allowableMouthMm / ref[s].mouthOpeningMm);
  return {
    component: 'brake-caliper',
    kind: 'caliper-pressure',
    title: 'Line-pressure sweep, 2–18 MPa',
    revisions: { A: designs.A.revision, B: designs.B.revision },
    source: 'estimated',
    conditions: `allowable stress ${inputs.allowableStressMPa} MPa · allowable mouth opening ${inputs.allowableMouthMm} mm`,
    metrics: [
      metric('pStress', 'Pressure at allowable stress', 'MPa', 1, pStress('A'), pStress('B'), false),
      metric('pMouth', 'Pressure at allowable mouth opening', 'MPa', 1, pMouth('A'), pMouth('B'), false),
      metric('stressDesign', `Stress at ${inputs.linePressureMPa} MPa`, 'MPa', 1, ref.A.peakStressMPa, ref.B.peakStressMPa, true),
      metric('mass', 'Mass', 'kg', 3, ref.A.massKg, ref.B.massKg, true),
    ],
    series: [
      { title: 'Peak bridge stress', xLabel: 'line pressure, MPa', yUnit: 'MPa', points: stress, band: { min: 0, max: inputs.allowableStressMPa, label: 'within allowable' } },
      { title: 'Mouth opening', xLabel: 'line pressure, MPa', yUnit: 'mm', points: mouth, band: { min: 0, max: inputs.allowableMouthMm, label: 'within allowable' } },
    ],
    feasible: caliperFeasible(designs, inputs),
  };
}

/** Share of a sweep that sits inside the heat-range window, in percent. */
function windowShare(temps: number[]) {
  return (100 * temps.filter((t) => t >= TIP_WINDOW_C.min && t <= TIP_WINDOW_C.max).length) / temps.length;
}

export function runPlugSpeedSweep(designs: Record<Slot, PlugDesign>, inputs: PlugInputs, c: PlugConditions): RunDraft {
  const rpms: number[] = [];
  for (let r = 800; r <= 7000; r += 100) rpms.push(r);
  const pts = rpms.map((rpm) => ({
    x: rpm,
    A: plugEstimate(designs.A, inputs, rpm, c.loadPct).tipTempC,
    B: plugEstimate(designs.B, inputs, rpm, c.loadPct).tipTempC,
  }));
  const tA = pts.map((p) => p.A);
  const tB = pts.map((p) => p.B);
  const hot = (t: number[]) => t.every((v) => v <= TIP_WINDOW_C.max);
  return {
    component: 'spark-plug',
    kind: 'plug-speed',
    title: `Engine-speed sweep at ${c.loadPct} % load`,
    revisions: { A: designs.A.revision, B: designs.B.revision },
    source: 'estimated',
    conditions: `800–7000 rpm · ${c.loadPct} % load · gas ${inputs.gasTempC} °C · seat ${inputs.seatTempC} °C`,
    metrics: [
      metric('inWindow', 'Share of the sweep inside 450–850 °C', '%', 0, windowShare(tA), windowShare(tB), false),
      metric('min', 'Coolest tip (lowest speed)', '°C', 0, Math.min(...tA), Math.min(...tB), null),
      metric('max', 'Hottest tip (highest speed)', '°C', 0, Math.max(...tA), Math.max(...tB), null),
    ],
    series: [
      { title: 'Firing-end temperature vs engine speed', xLabel: 'engine speed, rpm', yUnit: '°C', points: pts, band: { min: TIP_WINDOW_C.min, max: TIP_WINDOW_C.max, label: 'heat-range window' } },
    ],
    feasible: { A: hot(tA), B: hot(tB) },
  };
}

export function runPlugLoadSweep(designs: Record<Slot, PlugDesign>, inputs: PlugInputs, c: PlugConditions): RunDraft {
  const loads: number[] = [];
  for (let l = 10; l <= 100; l += 5) loads.push(l);
  const pts = loads.map((l) => ({
    x: l,
    A: plugEstimate(designs.A, inputs, c.rpm, l).tipTempC,
    B: plugEstimate(designs.B, inputs, c.rpm, l).tipTempC,
  }));
  const tA = pts.map((p) => p.A);
  const tB = pts.map((p) => p.B);
  return {
    component: 'spark-plug',
    kind: 'plug-load',
    title: `Load sweep at ${c.rpm} rpm`,
    revisions: { A: designs.A.revision, B: designs.B.revision },
    source: 'estimated',
    conditions: `10–100 % load · ${c.rpm} rpm · gas ${inputs.gasTempC} °C · seat ${inputs.seatTempC} °C`,
    metrics: [
      metric('inWindow', 'Share of the sweep inside 450–850 °C', '%', 0, windowShare(tA), windowShare(tB), false),
      metric('min', 'Coolest tip (lightest load)', '°C', 0, Math.min(...tA), Math.min(...tB), null),
      metric('max', 'Hottest tip (full load)', '°C', 0, Math.max(...tA), Math.max(...tB), null),
    ],
    series: [
      { title: 'Firing-end temperature vs load', xLabel: 'engine load, %', yUnit: '°C', points: pts, band: { min: TIP_WINDOW_C.min, max: TIP_WINDOW_C.max, label: 'heat-range window' } },
    ],
    feasible: { A: tA.every((v) => v <= TIP_WINDOW_C.max), B: tB.every((v) => v <= TIP_WINDOW_C.max) },
  };
}
