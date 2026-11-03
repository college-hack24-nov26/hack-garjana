// Checks for the spark plug module. Run with: npm run test:engine
// Part 1 repeats the main assertions from AutoTwin's frontend/src/engine/kinematics.test.ts
// (our kinematics.ts has the same code). The rest cover the fixed rod linkage, the sim and
// the combustion fire timing.
import {
  CYLINDER_DESIGN, CYLINDER_PHASE, FIRING_ORDER, REFERENCE_ENGINE as G, combustionIntensity,
  crankDegreesPerFrame, cylinderCycleAngle, engineState, ignitionHzPerCylinder, pistonDrop, strokeAt,
} from '../src/modules/sparkPlug/engine/kinematics.ts';
import { crankLinkage, meanPistonSpeed, pistonVelocity } from '../src/modules/sparkPlug/engine/linkage.ts';
import { EngineSim } from '../src/modules/sparkPlug/sim/engineSim.ts';
import { tipStatus } from '../src/modules/sparkPlug/engine/tipWindow.ts';
import {
  FLAME_SWEEP_DEG, combustionEvent, degSinceSpark, fireLuminosity, flameFront, sparkFlash,
} from '../src/modules/sparkPlug/engine/combustionVisual.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---- Part 1: AutoTwin kinematics ----
check('TDC at 0° and 720°', close(pistonDrop(0, G), 0) && close(pistonDrop(720, G), 0));
check('one full stroke at BDC', close(pistonDrop(180, G), G.stroke));
check('asymmetric about mid-stroke (finite rod)', pistonDrop(90, G) > G.stroke / 2);
check('firing order 1-3-4-2, 180° apart', FIRING_ORDER.join('') === '1342' && CYLINDER_PHASE.join(',') === '0,540,180,360');
check('plug A in cyl 1 & 4, B in 2 & 3', CYLINDER_DESIGN.join('') === 'ABBA');
let onePower = true, oneBurn = true, pairs = true;
for (let c = 0; c < 720; c += 7) {
  const st = engineState(c, G);
  if (st.filter((s) => s.stroke === 'Power').length !== 1) onePower = false;
  if (st.filter((s) => s.combustion > 0.05).length > 1) oneBurn = false;
  if (!close(st[0].dropFraction, st[3].dropFraction, 1e-6) || !close(st[1].dropFraction, st[2].dropFraction, 1e-6)) pairs = false;
}
check('exactly one cylinder on power stroke', onePower);
check('at most one flame kernel at a time', oneBurn);
check('pistons 1/4 and 2/3 move in pairs', pairs);
check('stroke boundaries', strokeAt(0) === 'Power' && strokeAt(180) === 'Exhaust' && strokeAt(360) === 'Intake' && strokeAt(540) === 'Compression');
check('ignition fires before TDC, not mid-stroke', combustionIntensity(710) > 0 && combustionIntensity(450) === 0);
check('N/120 per cylinder', close(ignitionHzPerCylinder(6000), 50));
check('aliasing: 600°/frame at 6000 rpm real time, 12° at 1/50×',
  close(crankDegreesPerFrame(6000, 1, 1 / 60), 600, 1e-6) && close(crankDegreesPerFrame(6000, 0.02, 1 / 60), 12, 1e-6));

// ---- Part 2: the rod linkage we draw ----
let rigid = true, above = true, maxErr = 0;
for (let d = 0; d <= 720; d += 1) {
  const k = crankLinkage(d, G);
  const len = Math.hypot(k.wristY - k.pinY, k.pinZ);
  maxErr = Math.max(maxErr, Math.abs(len - G.rodLength));
  if (Math.abs(len - G.rodLength) > 1e-9) rigid = false;
  if (k.wristY <= k.pinY) above = false;
  // The rod's rotation has to point it from the crank pin to the wrist pin.
  const dirY = Math.cos(k.rodAngle), dirZ = Math.sin(k.rodAngle);
  if (Math.abs(dirY * G.rodLength - (k.wristY - k.pinY)) > 1e-9 || Math.abs(dirZ * G.rodLength + k.pinZ) > 1e-9) rigid = false;
}
check('rod is rigid (length = l at every angle)', rigid, `max error ${maxErr.toExponential(1)} m`);
check('wrist pin always above crank pin', above);
const k0 = crankLinkage(0, G), k180 = crankLinkage(180, G);
check('crank pin up at TDC, down at BDC', close(k0.pinY, G.stroke / 2) && close(k180.pinY, -G.stroke / 2));
check('wrist travel equals stroke', close(k0.wristY - k180.wristY, G.stroke));
// The crank pin mesh sits at local (0, r, 0). Turned by θ about X it lands at (r cos θ, r sin θ),
// which should be exactly where the rod ends.
let throwMatches = true;
for (const d of [0, 37, 90, 145, 180, 233, 270, 333]) {
  const t = (d * Math.PI) / 180, r = G.stroke / 2, k = crankLinkage(d, G);
  if (!close(r * Math.cos(t), k.pinY) || !close(r * Math.sin(t), k.pinZ)) throwMatches = false;
}
check('rod end coincides with crank-pin mesh', throwMatches);
// Velocity should match a numerical derivative of the piston drop.
let velOk = true;
for (const d of [10, 60, 90, 120, 170, 300]) {
  const h = 1e-4, w = (3000 * 2 * Math.PI) / 60;
  const num = ((pistonDrop(d + h, G) - pistonDrop(d - h, G)) / (2 * h)) * (180 / Math.PI) * w;
  if (Math.abs(num - pistonVelocity(d, 3000, G)) > 1e-5) velOk = false;
}
check('piston velocity matches d(drop)/dt', velOk);
check('mean piston speed 2SN/60', close(meanPistonSpeed(3000, G), 8.6, 1e-12));

// ---- Part 3: the engine sim ----
{
  const sim = new EngineSim({ rpm: 3000, timeScale: 0.02 });
  check('starts at TDC, paused', sim.state.crankDeg === 0 && !sim.running);
  sim.advanceWall(1 / 60);
  check('paused sim does not advance', sim.state.t === 0);
  sim.play();
  for (let i = 0; i < 60; i++) sim.advanceWall(1 / 60); // 1 s of real time at 1/50x
  check('1 s wall at 1/50× = 0.02 s engine time', close(sim.state.t, 0.02, 1e-9), `${sim.state.t.toFixed(4)} s`);
  check('crank advanced 360° (3000 rpm × 0.02 s)', close(sim.state.totalDeg, 360, 1e-6), `${sim.state.totalDeg.toFixed(2)}°`);
  check('per-frame step = 6° at 3000 rpm, 1/50×', close(sim.state.lastStepDeg, 6, 1e-9));
  check('two firing events per revolution', sim.ignitions === 2);
  sim.setParams({ rpm: 6000 });
  const before = sim.state.totalDeg;
  sim.advanceSim(0.01);
  check('speed change takes effect immediately', close(sim.state.totalDeg - before, 360, 1e-6));
  sim.setParams({ rpm: 0 });
  const c0 = sim.state.crankDeg;
  sim.advanceSim(1);
  check('0 rpm holds the crank still', sim.state.crankDeg === c0);
  sim.pause();
  check('pause stops running', !sim.running && sim.state.lastStepDeg === 0);
  sim.reset();
  check('reset to t=0, TDC, history 1 sample', sim.state.t === 0 && sim.state.crankDeg === 0 && sim.history.length === 1);
  check('tip status thresholds', tipStatus(400) === 'cold' && tipStatus(620) === 'ok' && tipStatus(900) === 'hot' && tipStatus(null) === 'none');
}

// ---- Part 4: combustion fire timing ----
{
  check('spark 18° BTDC', degSinceSpark(702) === 0 && degSinceSpark(0) === 18);
  check('no fire on intake / compression before the spark',
    [360, 400, 540, 600, 700, 701.9].every((c) => fireLuminosity(c) === 0 && flameFront(c) === 0));
  check('fire lit right after the spark', fireLuminosity(703) > 0 && sparkFlash(702) === 1 && sparkFlash(702 + 14) === 0);
  let mono = true;
  for (let s = 0; s < FLAME_SWEEP_DEG; s++) if (flameFront(702 + s + 1) < flameFront(702 + s)) mono = false;
  check('flame front grows 0 → 1 across the sweep', mono && flameFront(702) === 0 && flameFront(702 + FLAME_SWEEP_DEG) === 1);
  let peakAt = 0, peak = 0;
  for (let c = -18; c < 200; c++) if (fireLuminosity(c) > peak) { peak = fireLuminosity(c); peakAt = c; }
  check('glow peaks just after TDC (5–20° ATDC)', peak === 1 && peakAt >= 5 && peakAt <= 20, `${peakAt}° ATDC`);
  check('glow decays through expansion, out by early exhaust', fireLuminosity(90) < fireLuminosity(30) && fireLuminosity(140) < fireLuminosity(90) && fireLuminosity(183) === 0);
  // Each cylinder fires once every 720°, 180° after the one before it, in 1-3-4-2 order.
  let order = true;
  for (let k = 0; k < 4; k++) {
    const g = 702 + 1 + k * 180; // crank angle 1° after the k-th spark in the cycle
    const lit = [0, 1, 2, 3].filter((i) => degSinceSpark(cylinderCycleAngle(i, g)) < 2);
    if (lit.length !== 1 || lit[0] + 1 !== FIRING_ORDER[k] || flameFront(cylinderCycleAngle(lit[0], g)) <= 0) order = false;
  }
  check('sparks follow firing order 1-3-4-2', order);
  check('event counter steps at each spark',
    combustionEvent(0, 701) === 0 && combustionEvent(0, 702) === 1 && combustionEvent(0, 1422) === 2 && combustionEvent(540, 521) === -1 && combustionEvent(540, 522) === 0); // a cylinder with a 540° phase sparks at 702 + 540, which wraps to 522°
  const sim = new EngineSim();
  check('combustion fire on by default, toggles without touching motion', (() => {
    const was = sim.params.showCombustion; sim.play(); sim.advanceSim(0.004);
    const deg = sim.state.crankDeg; sim.setParams({ showCombustion: false });
    return was === true && sim.params.showCombustion === false && sim.state.crankDeg === deg;
  })());
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
