/**
 * Analytics: how each result responds to each design parameter, for design A
 * and design B. Pure functions (no React), so the browser and the Node checks
 * compute exactly the same curves.
 *
 * Every number comes from the same reduced-order estimators and validation
 * limits as the Design Lab, so a curve here passes through the Design Lab's
 * value at the design point. Nothing is a solver result.
 */
import {
  CALIPER_PARAMS,
  PLUG_IDLE,
  PLUG_PARAMS,
  PLUG_SWEEP_RPM,
  TIP_WINDOW_C,
} from './designs.ts';
import type { CaliperDesign, CaliperInputs, ComponentId, ParamSpec, PlugDesign, PlugInputs, Slot } from './designs.ts';
import { caliperEstimate, plugEstimate } from './estimators.ts';
import {
  BRAKE_CONDITIONS_DEFAULT,
  runBrakeFade,
  runBrakeStop,
  runCaliperPressureSweep,
  runPlugLoadSweep,
  runPlugSpeedSweep,
} from './experiments.ts';
import type { RunSeries } from './WorkspaceStore.ts';

export interface AnalyticsSource {
  caliper: Record<Slot, CaliperDesign>;
  caliperInputs: CaliperInputs;
  plug: Record<Slot, PlugDesign>;
  plugInputs: PlugInputs;
}

/** A limit to shade on a chart: inside [min, max] is acceptable. Open ends are filled in from the data. */
export interface Limit {
  min?: number;
  max?: number;
  label: string;
}

export interface OutputDef {
  key: string;
  label: string;
  unit: string;
  digits: number;
  lowerIsBetter: boolean | null;
  limit?: Limit;
}

interface OutputImpl<D, I> extends OutputDef {
  value: (d: D, inp: I) => number;
}

/* ------------------------------------------------------------------ */
/*  Outputs per component                                              */
/* ------------------------------------------------------------------ */

function caliperOutputs(inp: CaliperInputs): OutputImpl<CaliperDesign, CaliperInputs>[] {
  return [
    {
      key: 'stress', label: 'Peak bridge stress', unit: 'MPa', digits: 1, lowerIsBetter: true,
      limit: { max: inp.allowableStressMPa, label: `≤ ${inp.allowableStressMPa} MPa allowable` },
      value: (d, i) => caliperEstimate(d, i).peakStressMPa,
    },
    {
      key: 'mouth', label: 'Mouth opening', unit: 'mm', digits: 3, lowerIsBetter: true,
      limit: { max: inp.allowableMouthMm, label: `≤ ${inp.allowableMouthMm} mm allowable` },
      value: (d, i) => caliperEstimate(d, i).mouthOpeningMm,
    },
    {
      key: 'fos', label: 'Factor of safety on yield', unit: '–', digits: 2, lowerIsBetter: false,
      limit: { min: inp.minFoS, label: `≥ ${inp.minFoS} required` },
      value: (d, i) => caliperEstimate(d, i).factorOfSafety,
    },
    { key: 'mass', label: 'Mass', unit: 'kg', digits: 3, lowerIsBetter: true, value: (d, i) => caliperEstimate(d, i).massKg },
    {
      key: 'clamp', label: 'Clamp force per side', unit: 'kN', digits: 2, lowerIsBetter: null,
      value: (d, i) => caliperEstimate(d, i).clampForceN / 1000,
    },
  ];
}

const plugWindow: Limit = { min: TIP_WINDOW_C.min, max: TIP_WINDOW_C.max, label: `${TIP_WINDOW_C.min}–${TIP_WINDOW_C.max} °C window` };

function plugHottest(d: PlugDesign, i: PlugInputs) {
  let hi = -Infinity;
  for (let rpm = PLUG_SWEEP_RPM.min; rpm <= PLUG_SWEEP_RPM.max; rpm += PLUG_SWEEP_RPM.step) hi = Math.max(hi, plugEstimate(d, i, rpm, 100).tipTempC);
  return hi;
}

function plugOutputs(inp: PlugInputs): OutputImpl<PlugDesign, PlugInputs>[] {
  return [
    {
      key: 'tip', label: `Tip temperature at ${inp.rpm} rpm, ${inp.loadPct} %`, unit: '°C', digits: 0, lowerIsBetter: null,
      limit: plugWindow, value: (d, i) => plugEstimate(d, i).tipTempC,
    },
    {
      key: 'hottest', label: 'Hottest tip, full load (any speed)', unit: '°C', digits: 0, lowerIsBetter: true,
      limit: { max: TIP_WINDOW_C.max, label: `≤ ${TIP_WINDOW_C.max} °C pre-ignition` }, value: plugHottest,
    },
    {
      key: 'idle', label: `Tip at idle (${PLUG_IDLE.rpm} rpm, ${PLUG_IDLE.loadPct} %)`, unit: '°C', digits: 0, lowerIsBetter: false,
      limit: { min: TIP_WINDOW_C.min, label: `≥ ${TIP_WINDOW_C.min} °C self-cleaning` },
      value: (d, i) => plugEstimate(d, i, PLUG_IDLE.rpm, PLUG_IDLE.loadPct).tipTempC,
    },
    {
      key: 'heat', label: 'Heat into the shell seat', unit: 'W', digits: 1, lowerIsBetter: null,
      value: (d, i) => plugEstimate(d, i).heatToSeatW,
    },
  ];
}

const strip = <D, I>(o: OutputImpl<D, I>): OutputDef => {
  const { value: _value, ...def } = o;
  return def;
};

/** The results that can be plotted for a component, with their limits. */
export function outputsFor(src: AnalyticsSource, c: ComponentId): OutputDef[] {
  return c === 'brake-caliper' ? caliperOutputs(src.caliperInputs).map(strip) : plugOutputs(src.plugInputs).map(strip);
}

/** Numeric design parameters for a component (materials can't be swept). */
export function paramsFor(c: ComponentId): ParamSpec<string>[] {
  return c === 'brake-caliper' ? CALIPER_PARAMS : PLUG_PARAMS;
}

/** Evaluates one output for a design with one parameter overridden. */
function evaluate(src: AnalyticsSource, c: ComponentId, slot: Slot, outputKey: string, patch: Record<string, number> = {}) {
  if (c === 'brake-caliper') {
    const o = caliperOutputs(src.caliperInputs).find((x) => x.key === outputKey);
    if (!o) throw new Error(`Unknown caliper output: ${outputKey}`);
    return o.value({ ...src.caliper[slot], ...patch }, src.caliperInputs);
  }
  const o = plugOutputs(src.plugInputs).find((x) => x.key === outputKey);
  if (!o) throw new Error(`Unknown plug output: ${outputKey}`);
  return o.value({ ...src.plug[slot], ...patch }, src.plugInputs);
}

export function designValue(src: AnalyticsSource, c: ComponentId, slot: Slot, key: string): number {
  const d = (c === 'brake-caliper' ? src.caliper[slot] : src.plug[slot]) as unknown as Record<string, number>;
  return d[key];
}

/** The output at each design's own point (what the Design Lab shows). */
export function atDesign(src: AnalyticsSource, c: ComponentId, outputKey: string) {
  return { A: evaluate(src, c, 'A', outputKey), B: evaluate(src, c, 'B', outputKey) };
}

/* ------------------------------------------------------------------ */
/*  One-parameter sweeps                                               */
/* ------------------------------------------------------------------ */

export interface ParamSweep {
  param: ParamSpec<string>;
  output: OutputDef;
  /** Each design keeps its own other parameters; only `param` moves. */
  points: { x: number; A: number; B: number }[];
  /** Where each design sits on the x axis. */
  at: { A: number; B: number };
  /** A and B differ in this parameter. */
  changed: boolean;
  /** Chart band for the limit, closed off with the data range. */
  band?: { min: number; max: number; label: string };
}

/** Grid for a parameter: every step for small integer ranges, otherwise `n` points. */
function grid(p: ParamSpec<string>, n: number) {
  const steps = Math.round((p.max - p.min) / p.step);
  const count = steps <= 40 ? steps : n - 1;
  return Array.from({ length: count + 1 }, (_, i) => p.min + ((p.max - p.min) * i) / count);
}

export function closeBand(limit: Limit | undefined, values: number[]) {
  if (!limit) return undefined;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return { min: limit.min ?? Math.min(lo, limit.max ?? lo), max: limit.max ?? Math.max(hi, limit.min ?? hi), label: limit.label };
}

export function parameterSweep(src: AnalyticsSource, c: ComponentId, paramKey: string, outputKey: string, n = 41): ParamSweep {
  const param = paramsFor(c).find((p) => p.key === paramKey);
  const output = outputsFor(src, c).find((o) => o.key === outputKey);
  if (!param || !output) throw new Error(`Unknown sweep ${paramKey} × ${outputKey}`);
  const points = grid(param, n).map((x) => ({
    x,
    A: evaluate(src, c, 'A', outputKey, { [paramKey]: x }),
    B: evaluate(src, c, 'B', outputKey, { [paramKey]: x }),
  }));
  const at = { A: designValue(src, c, 'A', paramKey), B: designValue(src, c, 'B', paramKey) };
  return {
    param,
    output,
    points,
    at,
    changed: Math.abs(at.A - at.B) > 1e-9,
    band: closeBand(output.limit, points.flatMap((p) => [p.A, p.B])),
  };
}

/** Every parameter's sweep for one output, parameters that differ between A and B first. */
export function allSweeps(src: AnalyticsSource, c: ComponentId, outputKey: string): ParamSweep[] {
  const list = paramsFor(c).map((p) => parameterSweep(src, c, p.key, outputKey));
  return [...list.filter((s) => s.changed), ...list.filter((s) => !s.changed)];
}

/* ------------------------------------------------------------------ */
/*  Sensitivity (tornado)                                              */
/* ------------------------------------------------------------------ */

export interface SensitivityRow {
  param: ParamSpec<string>;
  /** Parameter values tried, below and above each design's own value. */
  range: Record<Slot, { lo: number; hi: number }>;
  /** % change of the output at lo and at hi, relative to the design's own value. */
  A: { lo: number; hi: number };
  B: { lo: number; hi: number };
  /** Largest |% change| of either design: the sort key. */
  swing: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One-at-a-time sensitivity: each parameter is moved ±`pct` % from each
 * design's own value (±1 step for counts like pistons and ribs), clamped to
 * its range, and the output's % change is recorded.
 */
export function sensitivity(src: AnalyticsSource, c: ComponentId, outputKey: string, pct = 10): SensitivityRow[] {
  const isCount = (p: ParamSpec<string>) => p.step >= 1 && p.unit === '–';
  const rows = paramsFor(c).map((param) => {
    const side = (slot: Slot) => {
      const v = designValue(src, c, slot, param.key);
      const d = isCount(param) ? param.step : Math.abs(v) * (pct / 100);
      const lo = clamp(v - d, param.min, param.max);
      const hi = clamp(v + d, param.min, param.max);
      const base = evaluate(src, c, slot, outputKey);
      const rel = (x: number) => (Math.abs(base) < 1e-12 ? 0 : ((evaluate(src, c, slot, outputKey, { [param.key]: x }) - base) / Math.abs(base)) * 100);
      return { range: { lo, hi }, effect: { lo: rel(lo), hi: rel(hi) } };
    };
    const a = side('A');
    const b = side('B');
    const swing = Math.max(Math.abs(a.effect.lo), Math.abs(a.effect.hi), Math.abs(b.effect.lo), Math.abs(b.effect.hi));
    return { param, range: { A: a.range, B: b.range }, A: a.effect, B: b.effect, swing };
  });
  return rows.sort((x, y) => y.swing - x.swing);
}

/* ------------------------------------------------------------------ */
/*  Operating-condition curves                                         */
/* ------------------------------------------------------------------ */

export interface ConditionGroup {
  title: string;
  source: 'model' | 'estimated';
  conditions: string;
  series: RunSeries[];
}

/**
 * The same curves the Experiment protocols produce, computed live for the
 * current designs (nothing is recorded as a run).
 */
export function operatingCurves(src: AnalyticsSource, c: ComponentId): ConditionGroup[] {
  if (c === 'brake-caliper') {
    const runs = [
      runCaliperPressureSweep(src.caliper, src.caliperInputs),
      runBrakeStop(src.caliper, BRAKE_CONDITIONS_DEFAULT, src.caliperInputs),
      runBrakeFade(src.caliper, BRAKE_CONDITIONS_DEFAULT, src.caliperInputs),
    ];
    return runs.map((r) => ({ title: r.title, source: r.source, conditions: r.conditions, series: r.series }));
  }
  const pc = { rpm: src.plugInputs.rpm, loadPct: src.plugInputs.loadPct };
  const speedFull = runPlugSpeedSweep(src.plug, src.plugInputs, { ...pc, loadPct: 100 });
  const speedOp = runPlugSpeedSweep(src.plug, src.plugInputs, pc);
  const load = runPlugLoadSweep(src.plug, src.plugInputs, pc);
  const idle = runPlugLoadSweep(src.plug, src.plugInputs, { ...pc, rpm: PLUG_IDLE.rpm });
  const runs = pc.loadPct === 100 ? [speedFull, load, idle] : [speedFull, speedOp, load, idle];
  return runs.map((r) => ({ title: r.title, source: r.source, conditions: r.conditions, series: r.series }));
}

/* ------------------------------------------------------------------ */
/*  CSV export of every curve                                          */
/* ------------------------------------------------------------------ */

const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(8)) : '') : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Long-format CSV: one row per point, for every sweep of every output and every operating curve. */
export function analyticsCsv(src: AnalyticsSource, c: ComponentId): string {
  const rows: (string | number)[][] = [['chart', 'x_label', 'x', 'y_unit', 'A', 'B']];
  for (const o of outputsFor(src, c)) {
    for (const s of allSweeps(src, c, o.key)) {
      const name = `${o.label} vs ${s.param.label}`;
      for (const p of s.points) rows.push([name, `${s.param.label} (${s.param.unit})`, p.x, o.unit, p.A, p.B]);
    }
  }
  for (const g of operatingCurves(src, c)) {
    for (const s of g.series) for (const p of s.points) rows.push([`${g.title}: ${s.title}`, s.xLabel, p.x, s.yUnit, p.A, p.B]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
