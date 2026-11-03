/**
 * Checks for the Analytics computations: each sweep passes through the Design
 * Lab value at each design's own point, the physics points the right way, the
 * sensitivity ranking is sensible, and every number is finite.
 *
 *   node --experimental-strip-types scripts/analytics-check.ts
 */
import { allSweeps, analyticsCsv, atDesign, operatingCurves, outputsFor, parameterSweep, sensitivity } from '../src/workspace/analytics.ts';
import type { AnalyticsSource } from '../src/workspace/analytics.ts';
import { CALIPER_BASELINE, CALIPER_INPUT_DEFAULTS, CALIPER_PARAMS, PLUG_BASELINE, PLUG_INPUT_DEFAULTS, PLUG_PARAMS } from '../src/workspace/designs.ts';
import { caliperEstimate, plugEstimate } from '../src/workspace/estimators.ts';
import { BRAKE_CONDITIONS_DEFAULT, runBrakeStop, runPlugSpeedSweep } from '../src/workspace/experiments.ts';
import { buildReport, defaultOptions, reportMarkdown } from '../src/workspace/report.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const src: AnalyticsSource = {
  caliper: { A: { ...CALIPER_BASELINE }, B: { ...CALIPER_BASELINE, bridgeMm: 26, ribCount: 3, revision: 'B' } },
  caliperInputs: { ...CALIPER_INPUT_DEFAULTS },
  plug: { A: { ...PLUG_BASELINE }, B: { ...PLUG_BASELINE, noseLengthMm: 10, electrodeId: 'ni', revision: 'B' } },
  plugInputs: { ...PLUG_INPUT_DEFAULTS },
};

// Every output × parameter sweep is finite and covers the parameter's range.
for (const c of ['brake-caliper', 'spark-plug'] as const) {
  const params = c === 'brake-caliper' ? CALIPER_PARAMS : PLUG_PARAMS;
  let n = 0;
  let ok = true;
  for (const o of outputsFor(src, c)) {
    const list = allSweeps(src, c, o.key);
    n += list.length;
    for (const s of list) {
      ok &&= s.points.length >= 3 && s.points.every((p) => [p.x, p.A, p.B].every(Number.isFinite));
      ok &&= close(s.points[0].x, s.param.min) && close(s.points[s.points.length - 1].x, s.param.max);
    }
  }
  check(`${c}: every sweep finite and spans its parameter range`, ok, `${n} charts`);
  check(`${c}: one chart per parameter per output`, n === params.length * outputsFor(src, c).length);
}

// Changed parameters come first.
const stressSweeps = allSweeps(src, 'brake-caliper', 'stress');
check('changed parameters listed first', stressSweeps[0].changed && stressSweeps[1].changed && !stressSweeps[2].changed,
  stressSweeps.slice(0, 2).map((s) => s.param.key).join(', '));

// The sweep passes through the Design Lab value at each design's own point.
const bridge = parameterSweep(src, 'brake-caliper', 'bridgeMm', 'stress');
const at = (pts: { x: number; A: number; B: number }[], x: number, k: 'A' | 'B') => pts.find((p) => close(p.x, x))?.[k];
const aAt = at(bridge.points, 20, 'A');
const bAt = at(bridge.points, 26, 'B');
check('bridge sweep hits A at 20 mm', aAt !== undefined && close(aAt, caliperEstimate(src.caliper.A, src.caliperInputs).peakStressMPa));
check('bridge sweep hits B at 26 mm', bAt !== undefined && close(bAt, caliperEstimate(src.caliper.B, src.caliperInputs).peakStressMPa));
check('atDesign matches the estimator', close(atDesign(src, 'spark-plug', 'tip').B, plugEstimate(src.plug.B, src.plugInputs).tipTempC));

// Direction of effect.
const pts = bridge.points;
check('thicker bridge → lower stress', pts[pts.length - 1].A < pts[0].A);
const nose = parameterSweep(src, 'spark-plug', 'noseLengthMm', 'tip').points;
check('longer nose → hotter tip', nose[nose.length - 1].A > nose[0].A);
const ribs = parameterSweep(src, 'brake-caliper', 'ribCount', 'mass');
check('rib count sweeps every integer 0..4', ribs.points.map((p) => p.x).join(',') === '0,1,2,3,4');

// Limit bands.
check('stress band is 0..allowable-ish', bridge.band?.max === src.caliperInputs.allowableStressMPa);
const fos = parameterSweep(src, 'brake-caliper', 'bridgeMm', 'fos');
check('FoS band starts at the minimum FoS', fos.band?.min === src.caliperInputs.minFoS && fos.band.max >= fos.band.min);

// Sensitivity: bridge thickness or slot depth should dominate stress; sorted descending.
const sens = sensitivity(src, 'brake-caliper', 'stress');
check('sensitivity sorted by swing', sens.every((r, i) => i === 0 || sens[i - 1].swing >= r.swing));
check('bridge thickness is in the top 3 for stress', sens.slice(0, 3).some((r) => r.param.key === 'bridgeMm'), sens.slice(0, 3).map((r) => r.param.key).join(', '));
check('thicker bridge has a negative stress effect', sens.find((r) => r.param.key === 'bridgeMm')!.A.hi < 0);

// Operating curves.
const calCurves = operatingCurves(src, 'brake-caliper');
const plugCurves = operatingCurves(src, 'spark-plug');
check('caliper operating curves: pressure, stop, fade', calCurves.length === 3 && calCurves.every((g) => g.series.length > 0));
check('plug operating curves present', plugCurves.length >= 3);

// CSV.
const csv = analyticsCsv(src, 'brake-caliper');
const lines = csv.trim().split('\n');
check('CSV has a header and many rows', lines[0] === 'chart,x_label,x,y_unit,A,B' && lines.length > 500, `${lines.length} lines`);
check('CSV rows all have 6 columns', lines.every((l) => l.split(',').length >= 6));

// Report.
const stop = { ...runBrakeStop(src.caliper, BRAKE_CONDITIONS_DEFAULT, src.caliperInputs), id: 'r1', createdAt: 0, designs: structuredClone(src.caliper) };
const old = { ...stop, id: 'r0', designs: { A: src.caliper.A, B: { ...src.caliper.B, bridgeMm: 22 } } };
const plugRun = { ...runPlugSpeedSweep(src.plug, src.plugInputs, { rpm: 3000, loadPct: 100 }), id: 'p1', createdAt: 0 };
const rsrc = { ...src, runs: [stop, old, plugRun] };
const opts = { ...defaultOptions('brake-caliper', rsrc.runs), runIds: ['r1', 'r0', 'p1', 'missing'] };
const rep = buildReport(rsrc, opts, Date.UTC(2026, 10, 4));
check('report: default run selection is this component only', defaultOptions('brake-caliper', rsrc.runs).runIds.join() === 'r1,r0');
check('report: runs filtered to the component, unknown ids dropped', rep.runs.map((r) => r.id).join() === 'r1,r0');
check('report: stale run detected', !rep.runs[0].stale && rep.runs[1].stale);
check('report: changes list the two changed parameters', rep.changes.map((c) => c.label).join() === 'Bridge thickness,Bridge rib count');
check('report: headline has both verdicts and the change count', rep.headline.length === 3 && /2 settings/.test(rep.headline[2]), rep.headline[2]);
check('report: one check row per rule, B on every row (some rules compare B with A, so have no A value)', rep.checks.length > 5 && rep.checks.every((r) => r.B) && new Set(rep.checks.map((r) => r.ruleId)).size === rep.checks.length);
const md = reportMarkdown(rep);
check('markdown: title, revisions and every section heading', ['# Brake Caliper', 'BC-A rev 1.0', '## Summary', '## What changed', '## Design checks', '## Sensitivity', '## Experiment runs', '## Method'].every((t) => md.includes(t)));
check('markdown: stale note on the older run', md.includes('the Design Lab has changed since this run'));
const mdOff = reportMarkdown(buildReport(rsrc, { ...opts, sections: { ...opts.sections, runs: false, sensitivity: false } }));
check('markdown: switched-off sections are left out', !mdOff.includes('## Experiment runs') && !mdOff.includes('## Sensitivity'));
check('markdown: no NaN or undefined', !/NaN|undefined/.test(md));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll analytics checks passed');
process.exit(failures ? 1 : 0);
