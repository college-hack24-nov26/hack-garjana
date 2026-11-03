// Checks for the alloy wheel twin, no browser needed. Run with: npm run test:wheel
import {
  DRAWING_DESIGN,
  FIXED,
  RIM_PROFILE,
  TYRE_PROFILE,
  depthAt,
  massProperties,
  polyMoment,
  signedArea,
  wheelLayout,
} from '../src/modules/alloyWheel/wheel/drawing.ts';
import { WHEEL_MATERIALS, cyclesToFailure, fatigueStrength, findWheelMaterial } from '../src/modules/alloyWheel/wheel/materials.ts';
import { overturningMoment, revolutionCycle, spokeCos, spokeLoads, spotCoeffs } from '../src/modules/alloyWheel/sim/loads.ts';
import { LOAD_TRANSFER, WheelSim } from '../src/modules/alloyWheel/sim/wheelModel.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// 1. Geometry follows the drawing.
{
  const L = wheelLayout(DRAWING_DESIGN);
  const rimR = Math.max(...RIM_PROFILE.map((p) => p[0]));
  const rimX = RIM_PROFILE.map((p) => p[1]);
  check('rim Ø520 over the flanges', near(rimR * 2000, 520, 0.01), `${(rimR * 2000).toFixed(1)} mm`);
  check('rim width 256', near((Math.max(...rimX) - Math.min(...rimX)) * 1000, 256, 0.01));
  check('mounting face 70 in from the outboard face', near((FIXED.xOutboard - FIXED.xMount) * 1000, 70, 1e-9));
  check('spoke depth ≈ 20 at the rim (Section A-A)', near(depthAt(L, FIXED.rLegEnd) * 1000, 20, 0.01));
  const backDeg = (Math.atan(L.backSlope) * 180) / Math.PI;
  check('spoke back face drafted ≈ 15°', near(backDeg, 15, 0.5), `${backDeg.toFixed(2)}°`);
  const chord = 2 * FIXED.rAttach * Math.sin(L.legHalfAngle) * 1000;
  check('legs 90 apart at the rim', near(chord, 90, 1e-6), `${chord.toFixed(2)} mm`);
  check('crotch sits above the fork radius', L.rCrotch > L.rFork && L.rCrotch < FIXED.rAttach, `${(L.rCrotch * 1000).toFixed(1)} mm`);
  check('profiles wound counter-clockwise (lathed faces point out)', signedArea(RIM_PROFILE) > 0 && signedArea(TYRE_PROFILE) > 0);
  check('spoke outline counter-clockwise', signedArea(L.outline) > 0);
  // Moment integrator against a closed form: unit square → ∫∫ u dA = 1/2, ∫∫ u³ dA = 1/4.
  const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  check('polygon moment integrator exact', near(polyMoment(sq, 1, 0), 0.5, 1e-12) && near(polyMoment(sq, 3, 0), 0.25, 1e-12));
  const m = massProperties(L, findWheelMaterial('a356-t6').densityKgM3);
  check('A356 wheel mass plausible for a 20×10 cast wheel (9–16 kg)', m.massKg > 9 && m.massKg < 16, `${m.massKg.toFixed(2)} kg`);
  const thin = massProperties(wheelLayout({ ...DRAWING_DESIGN, legWidthMm: 16 }), 2685);
  check('narrower legs → lighter wheel', thin.massKg < m.massKg, `${m.massKg.toFixed(3)} → ${thin.massKg.toFixed(3)} kg`);
}

// 2. Load sharing: equilibrium for any angle and spoke count.
{
  for (const N of [4, 5, 6, 7]) {
    const L = wheelLayout({ ...DRAWING_DESIGN, spokeCount: N });
    const p = { Fz: 5000, Fy: 3000, Fx: -2500, loadedRadius: 0.33 };
    let worstV = 0;
    let worstM = 0;
    for (let k = 0; k < 50; k++) {
      const th = (k / 50) * 2 * Math.PI;
      const arms = spokeLoads(L, p, th);
      const vert = arms.reduce((a, s, i) => a + s.n * spokeCos(i, N, th), 0);
      const span = FIXED.rAttach - FIXED.rHub;
      const mom = arms.reduce((a, s, i) => a + ((2 * s.mo) / span) * FIXED.rAttach * spokeCos(i, N, th), 0);
      worstV = Math.max(worstV, Math.abs(vert - p.Fz));
      worstM = Math.max(worstM, Math.abs(mom - overturningMoment(L, p)));
    }
    check(`N=${N}: Σ radial·cosψ = Fz and moment balances at every angle`, worstV < 1e-6 && worstM < 1e-6, `${worstV.toExponential(1)} N, ${worstM.toExponential(1)} N·m`);
  }
  const L = wheelLayout(DRAWING_DESIGN);
  const arms = spokeLoads(L, { Fz: 4500, Fy: 0, Fx: 0, loadedRadius: 0.33 }, Math.PI); // spoke 0 straight down
  check('spoke over the contact patch carries the most compression', arms[0].n === Math.max(...arms.map((a) => a.n)) && arms[0].n > 0);
  check('braking torque shared equally', new Set(spokeLoads(L, { Fz: 4500, Fy: 0, Fx: -3000, loadedRadius: 0.33 }, 0.3).map((a) => a.mi.toFixed(9))).size === 1);
}

// 3. The sim: cruise, load transfer, stress trends.
{
  const sim = new WheelSim({ scenario: 'cruise', targetSpeedKmh: 100 });
  check('initial ω = v / R_e', near(sim.state.omega * sim.state.effRadius, 100 / 3.6, 1e-9), `${sim.rpm.toFixed(1)} rpm`);
  sim.play();
  sim.advanceSim(4);
  check('cruise holds speed', near(sim.speedKmh, 100, 0.3), `${sim.speedKmh.toFixed(2)} km/h`);
  check('static load = demo fixture 4500 N', near(sim.state.Fz, 4500, 1));
  const revs = sim.state.distanceM / (2 * Math.PI * sim.state.effRadius);
  check('revolutions = distance / (2πR_e)', near(sim.state.revolutions, revs, 1e-3), `${sim.state.revolutions.toFixed(2)} rev`);
  const pPa = 2.5e5;
  check('rim hoop stress = p·r/t', near(sim.state.hoopMPa, (pPa * FIXED.rSeat) / FIXED.wall / 1e6, 1e-9), `${sim.state.hoopMPa.toFixed(2)} MPa`);
  const straight = sim.state.eqAmpMPa;

  const turn = new WheelSim({ scenario: 'cornering', manoeuvreAtS: 0, lateralG: 0.8 });
  turn.play();
  turn.advanceSim(3);
  const expFz = 4500 * (1 + LOAD_TRANSFER.lat * 0.8);
  check('right turn loads this (outer) wheel', near(turn.state.Fz, expFz, 30), `${turn.state.Fz.toFixed(0)} N vs ${expFz.toFixed(0)} N`);
  check('cornering raises the stress amplitude', turn.state.eqAmpMPa > 2 * straight, `${straight.toFixed(1)} → ${turn.state.eqAmpMPa.toFixed(1)} MPa`);
  check('cornering wears the wheel faster', turn.state.damagePerRev > sim.state.damagePerRev);

  const stop = new WheelSim({ scenario: 'brake-stop', manoeuvreAtS: 0.5, brakeG: 0.8, targetSpeedKmh: 80 });
  stop.play();
  stop.advanceSim(1.5);
  check('braking moves weight forward onto this wheel', stop.state.Fz > 4500 * 1.2, `${stop.state.Fz.toFixed(0)} N`);
  check('braking puts torque through the spokes', stop.state.torque < -1000, `${stop.state.torque.toFixed(0)} N·m`);
  stop.advanceSim(2.5); // ~2.9 s to stop from 80 km/h, then a 1.5 s hold
  check('car stops and holds', stop.state.v === 0 && stop.state.phase === 'holding');

  const slip = new WheelSim({ scenario: 'cornering', manoeuvreAtS: 0, lateralG: 1.2, roadMu: 0.6 });
  slip.play();
  slip.advanceSim(3);
  check('friction circle caps lateral force at μ·Fz', slip.state.gripLimited && slip.state.Fy <= 0.6 * slip.state.Fz + 1e-6, `${slip.state.Fy.toFixed(0)} N ≤ ${(0.6 * slip.state.Fz).toFixed(0)} N`);

  const wide = new WheelSim({ scenario: 'cornering', manoeuvreAtS: 0, legWidthMm: 28 });
  const narrow = new WheelSim({ scenario: 'cornering', manoeuvreAtS: 0, legWidthMm: 16 });
  [wide, narrow].forEach((s) => (s.play(), s.advanceSim(3)));
  check('narrower legs → higher peak stress', narrow.state.peakMPa > wide.state.peakMPa, `${wide.state.peakMPa.toFixed(1)} → ${narrow.state.peakMPa.toFixed(1)} MPa`);
}

// 4. Fatigue bookkeeping.
{
  const m = WHEEL_MATERIALS[0];
  check('Basquin round trip', near(cyclesToFailure(m, fatigueStrength(m, 1e6)), 1e6, 1));
  const L = wheelLayout(DRAWING_DESIGN);
  const c = revolutionCycle(L, { Fz: 6000, Fy: 4000, Fx: 0, loadedRadius: 0.33 }, spotCoeffs(L, 1.6), m);
  check('cycle covers a full turn', c.samples.length === 73 && c.samples[0].crit === c.samples[72].crit);
  check('critical amplitude matches the sampled swing', near(c.ampMPa, (Math.max(...c.samples.map((s) => s.crit)) - Math.min(...c.samples.map((s) => s.crit))) / 2, 1e-9));
  const sim = new WheelSim({ scenario: 'cornering', manoeuvreAtS: 0 });
  sim.play();
  sim.advanceSim(2);
  const d0 = sim.state.damage;
  const r0 = sim.state.revolutions;
  sim.advanceSim(2);
  const expected = sim.state.damagePerRev * (sim.state.revolutions - r0);
  check('damage integrates rate × revolutions', near(sim.state.damage - d0, expected, expected * 0.02 + 1e-18), `${(sim.state.damage - d0).toExponential(2)} vs ${expected.toExponential(2)}`);
}

// 5. Test rigs.
{
  const rig = new WheelSim({ scenario: 'rig-cornering' });
  const p = rig.params;
  const R = FIXED.tyreFreeRadius - p.staticLoadN / rig.tyreStiffness;
  const M = (p.rigMu * R + FIXED.xMount) * p.staticLoadN * p.rigS;
  check('cornering rig moment = (μR + d)·Fv·S', near(rig.rigMoment, M, 1e-9), `${M.toFixed(0)} N·m`);
  check('cornering rig: no tyre load, all moment', rig.state.Fz === 0 && near(rig.state.moment, M, 1e-9));
  rig.play();
  rig.advanceSim(1);
  check('cornering rig cycle is fully reversed (mean ≈ 0)', Math.abs(rig.state.meanMPa) < 0.02 * rig.state.ampMPa, `±${rig.state.ampMPa.toFixed(1)} about ${rig.state.meanMPa.toFixed(2)} MPa`);
  check('cornering rig counts one cycle per turn', near(rig.cyclesToFailure, 1 / rig.state.damagePerRev, 1e-6));
  const thin = new WheelSim({ scenario: 'rig-cornering', legWidthMm: 14, kt: 1.8 });
  check('thin legs + Kt fail the cornering target that the drawing design passes', rig.cyclesToFailure > p.rigTargetCornering && thin.cyclesToFailure < p.rigTargetCornering, `${rig.cyclesToFailure.toExponential(1)} vs ${thin.cyclesToFailure.toExponential(1)} cycles`);

  const drum = new WheelSim({ scenario: 'rig-radial' });
  check('radial rig load = K·Fv', near(drum.state.Fz, drum.params.rigK * drum.params.staticLoadN, 1e-9), `${drum.state.Fz.toFixed(0)} N`);
  check('radial rig: no lateral or drive force', drum.state.Fy === 0 && drum.state.Fx === 0);
  const back = new WheelSim({ scenario: 'rig-radial' });
  back.setParams({ scenario: 'cruise' });
  check('leaving a rig restarts on the road at the static load', near(back.state.Fz, back.params.staticLoadN, 1e-9) && back.state.t === 0);
}

// 6. Design Lab: A/B estimates and checks.
{
  const { WheelLabStore, WHEEL_CANDIDATE } = await import('../src/modules/alloyWheel/lab/WheelLabStore.ts');
  const { WHEEL_BASELINE, WHEEL_LAB_DEFAULTS, estimateWheel, wheelChecks, overallVerdict } = await import(
    '../src/modules/alloyWheel/lab/evaluate.ts'
  );
  const lab = new WheelLabStore(false);
  const twin = new WheelSim({ scenario: 'rig-cornering' });
  check('lab A = the drawing design, same mass as the twin', near(lab.estimates.A.massKg, twin.mass.massKg, 1e-9), `${lab.estimates.A.massKg.toFixed(2)} kg`);
  check('lab cornering-rig life matches the twin rig', near(lab.estimates.A.rigCorneringCycles, twin.cyclesToFailure, twin.cyclesToFailure * 1e-9));
  check('drawing design passes every lab check', lab.verdicts.A === 'pass', lab.checks.A.map((r) => `${r.ruleId}:${r.status}`).join(' '));
  check('candidate B is lighter than A', lab.estimates.B.massKg < lab.estimates.A.massKg, `${lab.estimates.A.massKg.toFixed(2)} → ${lab.estimates.B.massKg.toFixed(2)} kg`);
  lab.copyAToB();
  check('copy A → B gives identical estimates', near(lab.estimates.B.roadPeakMPa, lab.estimates.A.roadPeakMPa, 1e-12) && lab.designs.B.revision === WHEEL_CANDIDATE.revision);
  lab.setDesign('B', { legWidthMm: 14, kt: 1.8 });
  check('thin legs + Kt fail the cornering-rig check', lab.checks.B.find((r) => r.ruleId === 'wheel-rig-cornering')!.status === 'fail' && lab.verdicts.B === 'fail');
  lab.setDesign('B', { legWidthMm: 999 });
  check('lab clamps parameters to their ranges', lab.designs.B.legWidthMm === 30);
  const steel = { ...WHEEL_BASELINE, materialId: 'alloy-steel' as const };
  const e = estimateWheel(steel, WHEEL_LAB_DEFAULTS);
  check('alloy steel: heavier, and passes stress with a bigger margin', e.massKg > 30 && overallVerdict(wheelChecks(steel, e, WHEEL_LAB_DEFAULTS)) === 'pass', `${e.massKg.toFixed(1)} kg, FoS ${e.fos.toFixed(1)}`);
  const hard = { ...WHEEL_LAB_DEFAULTS, corneringG: 1.2, minFoS: 2 };
  const eh = estimateWheel(WHEEL_BASELINE, hard);
  check('harder design condition → stress check no longer passes', wheelChecks(WHEEL_BASELINE, eh, hard)[0].status !== 'pass', `${eh.roadPeakMPa.toFixed(0)} MPa vs ${(186 / 2).toFixed(0)}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll wheel checks passed');
process.exit(failures ? 1 : 0);
