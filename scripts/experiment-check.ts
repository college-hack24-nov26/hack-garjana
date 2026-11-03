/**
 * Checks for the Experiment protocols: every run produces finite numbers,
 * identical designs give identical results, and the physics points the right
 * way (a bigger piston bore stops shorter; a longer insulator nose runs hotter).
 *
 *   node --experimental-strip-types scripts/experiment-check.ts
 */
import {
  BRAKE_CONDITIONS_DEFAULT,
  PROTOCOLS,
  runBrakeFade,
  runBrakeStop,
  runCaliperPressureSweep,
  runPlugLoadSweep,
  runPlugSpeedSweep,
} from '../src/workspace/experiments.ts';
import { CALIPER_BASELINE, CALIPER_INPUT_DEFAULTS, PLUG_BASELINE, PLUG_INPUT_DEFAULTS } from '../src/workspace/designs.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}
const allFinite = (run: { metrics: { A: number; B: number }[]; series: { points: { x: number; A: number; B: number }[] }[] }) =>
  run.metrics.every((m) => Number.isFinite(m.A) && Number.isFinite(m.B)) &&
  run.series.every((s) => s.points.length >= 2 && s.points.every((p) => [p.x, p.A, p.B].every(Number.isFinite)));
const sameAB = (run: { metrics: { A: number; B: number }[] }) => run.metrics.every((m) => Math.abs(m.A - m.B) < 1e-9);

const cal = { A: { ...CALIPER_BASELINE }, B: { ...CALIPER_BASELINE, revision: 'B' } };
const plug = { A: { ...PLUG_BASELINE }, B: { ...PLUG_BASELINE, revision: 'B' } };
const pc = { rpm: PLUG_INPUT_DEFAULTS.rpm, loadPct: PLUG_INPUT_DEFAULTS.loadPct };

check('five protocols, ids unique', PROTOCOLS.length === 5 && new Set(PROTOCOLS.map((p) => p.id)).size === 5);

// Identical designs -> identical results, for every protocol.
const runs = {
  stop: timed(() => runBrakeStop(cal, BRAKE_CONDITIONS_DEFAULT, CALIPER_INPUT_DEFAULTS)),
  fade: timed(() => runBrakeFade(cal, BRAKE_CONDITIONS_DEFAULT, CALIPER_INPUT_DEFAULTS)),
  pressure: timed(() => runCaliperPressureSweep(cal, CALIPER_INPUT_DEFAULTS)),
  speed: timed(() => runPlugSpeedSweep(plug, PLUG_INPUT_DEFAULTS, pc)),
  load: timed(() => runPlugLoadSweep(plug, PLUG_INPUT_DEFAULTS, pc)),
};
for (const [k, [run, ms]] of Object.entries(runs)) {
  check(`${k}: finite metrics and series`, allFinite(run));
  check(`${k}: A == B when the designs are identical`, sameAB(run));
  check(`${k}: runs in under 1.5 s`, ms < 1500, `${ms.toFixed(0)} ms`);
}

// Direction of effect.
const bigBore = { A: cal.A, B: { ...cal.A, pistonBoreMm: cal.A.pistonBoreMm + 8, revision: 'B' } };
const stop = runBrakeStop(bigBore, BRAKE_CONDITIONS_DEFAULT, CALIPER_INPUT_DEFAULTS);
const dist = stop.metrics.find((m) => m.key === 'stopDist')!;
check('bigger bore stops shorter (or equal if grip-limited)', dist.B <= dist.A + 1e-6, `A ${dist.A.toFixed(1)} m, B ${dist.B.toFixed(1)} m`);
check('single stop comes to a standstill', stop.metrics.find((m) => m.key === 'stopTime')!.A > 0);

const longNose = { A: plug.A, B: { ...plug.A, noseLengthMm: plug.A.noseLengthMm + 4, revision: 'B' } };
const speed = runPlugSpeedSweep(longNose, PLUG_INPUT_DEFAULTS, pc);
const hot = speed.metrics.find((m) => m.key === 'max')!;
check('longer nose runs hotter', hot.B > hot.A, `A ${hot.A.toFixed(0)} °C, B ${hot.B.toFixed(0)} °C`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll experiment checks passed');
process.exit(failures ? 1 : 0);
