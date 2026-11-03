// Checks for the Design Lab estimators and the workspace store, no browser needed.
// Run with: npm run test:workspace
import { CALIPER_BASELINE, CALIPER_INPUT_DEFAULTS, PLUG_BASELINE, PLUG_INPUT_DEFAULTS } from '../src/workspace/designs.ts';
import { caliperEstimate, plugEstimate, plugSpeedSweep } from '../src/workspace/estimators.ts';
import { WorkspaceStore } from '../src/workspace/WorkspaceStore.ts';
import { estimatesFor, materialDiffs, parameterDiffs } from '../src/workspace/metrics.ts';
import { validateCaliper, validatePlug } from '../src/workspace/validation.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// 1. Caliper baseline: the hand calculation itself.
{
  const d = CALIPER_BASELINE;
  const inp = CALIPER_INPUT_DEFAULTS;
  const e = caliperEstimate(d, inp);
  const F = inp.linePressureMPa * d.pistonsPerSide * (Math.PI * d.pistonBoreMm ** 2) / 4;
  check('clamp force = p · n · πd²/4', near(e.clampForceN, F), (e.clampForceN / 1000).toFixed(2) + ' kN');
  check('bridge moment = F · slot depth / 2', near(e.bridgeMomentNm, (F * d.bodyHeightMm * d.slotDepthFrac) / 2 / 1000));
  check('factor of safety = yield / stress', near(e.factorOfSafety, 240 / e.peakStressMPa));
  check('baseline mass plausible for an iron caliper (3–7 kg)', e.massKg > 3 && e.massKg < 7, e.massKg.toFixed(3) + ' kg');
  check('baseline passes every rule', validateCaliper('A', d, inp).verdict === 'pass');
  // Plain rectangle (no ribs) must match b·h³/12 exactly.
  const flat = caliperEstimate({ ...d, ribCount: 0 }, inp);
  check('no ribs: I = b·h³/12', near(flat.bridgeIMm4, (d.bodyLengthMm * d.bridgeMm ** 3) / 12), flat.bridgeIMm4.toFixed(0) + ' mm⁴');
}

// 2. Caliper trends: the direction of change is what the estimate is for.
{
  const inp = CALIPER_INPUT_DEFAULTS;
  const base = caliperEstimate(CALIPER_BASELINE, inp);
  const thick = caliperEstimate({ ...CALIPER_BASELINE, bridgeMm: 26 }, inp);
  check('thicker bridge → lower stress', thick.peakStressMPa < base.peakStressMPa);
  check('thicker bridge → smaller mouth opening', thick.mouthOpeningMm < base.mouthOpeningMm);
  check('thicker bridge → heavier', thick.massKg > base.massKg);
  const alu = caliperEstimate({ ...CALIPER_BASELINE, materialId: 'a356-t6' }, inp);
  check('aluminium → same stress (statically determinate)', near(alu.peakStressMPa, base.peakStressMPa));
  check('aluminium → lighter', alu.massKg < 0.45 * base.massKg, alu.massKg.toFixed(3) + ' kg');
  check('aluminium → mouth opens more (E ratio)', near(alu.mouthOpeningMm / base.mouthOpeningMm, 169_000 / 72_400, 1e-6));
  const doubled = caliperEstimate(CALIPER_BASELINE, { ...inp, linePressureMPa: inp.linePressureMPa * 2 });
  check('stress is linear in line pressure', near(doubled.peakStressMPa, 2 * base.peakStressMPa));
  const ribs = caliperEstimate({ ...CALIPER_BASELINE, ribCount: 4 }, inp);
  check('more ribs → stiffer bridge', ribs.bridgeIMm4 > base.bridgeIMm4 && ribs.mouthOpeningMm < base.mouthOpeningMm);
  const thin = caliperEstimate({ ...CALIPER_BASELINE, legWallMm: 6 }, inp);
  const thinV = validateCaliper('B', { ...CALIPER_BASELINE, legWallMm: 6 }, inp);
  check('wall below the minimum fails the wall rule', thinV.results.find((r) => r.ruleId === 'cal.leg-wall')!.status === 'fail' && thin.massKg > 0);
  const crowded = caliperEstimate({ ...CALIPER_BASELINE, pistonsPerSide: 3, pistonBoreMm: 54, bodyLengthMm: 110 }, inp);
  const crowdedV = validateCaliper('B', { ...CALIPER_BASELINE, pistonsPerSide: 3, pistonBoreMm: 54, bodyLengthMm: 110 }, inp);
  check('pistons that do not fit fail the fit rule', crowdedV.results.find((r) => r.ruleId === 'cal.piston-fit')!.status === 'fail' && crowded.massKg > 0);
}

// 3. Spark plug fin model.
{
  const inp = PLUG_INPUT_DEFAULTS;
  const base = plugEstimate(PLUG_BASELINE, inp);
  check('tip between seat and gas temperature', base.tipTempC > inp.seatTempC && base.tipTempC < inp.gasTempC, base.tipTempC.toFixed(0) + ' °C');
  check('reference plug sits inside the 450–850 °C window', base.tipTempC >= 450 && base.tipTempC <= 850 && validatePlug('A', PLUG_BASELINE, inp).verdict !== 'fail');
  const long = plugEstimate({ ...PLUG_BASELINE, noseLengthMm: 11 }, inp);
  check('longer nose → hotter tip', long.tipTempC > base.tipTempC, `${base.tipTempC.toFixed(0)} → ${long.tipTempC.toFixed(0)} °C`);
  const solid = plugEstimate({ ...PLUG_BASELINE, electrodeId: 'ni' }, inp);
  check('solid nickel electrode runs hotter than copper core', solid.tipTempC > base.tipTempC);
  const sweep = plugSpeedSweep(PLUG_BASELINE, inp, 100, [1000, 2000, 3000, 4000, 5000, 6000]);
  check('tip temperature rises with engine speed', sweep.every((p, i) => i === 0 || p.tipTempC > sweep[i - 1].tipTempC));
  const idle = plugEstimate(PLUG_BASELINE, inp, 900, 20);
  check('idle, light load runs cold (fouling side)', idle.tipTempC < 450, idle.tipTempC.toFixed(0) + ' °C');
  const zero = plugEstimate({ ...PLUG_BASELINE, noseLengthMm: 3, protrusionMm: 0 }, { ...inp, hRef: 400 }, 800, 10);
  check('very short nose still above the seat temperature', zero.tipTempC > inp.seatTempC);
  check('heat to seat is positive', base.heatToSeatW > 0, base.heatToSeatW.toFixed(1) + ' W');
}

// 4. Workspace store (no localStorage in Node: it must still work).
{
  const ws = new WorkspaceStore();
  check('store builds without localStorage', ws.caliper.A.revision === 'BC-A rev 1.0' && ws.runs.length === 0);
  ws.setCaliper('A', { bridgeMm: 24 });
  ws.copyAToB('brake-caliper');
  check('copy A → B copies geometry', ws.caliper.B.bridgeMm === 24);
  check('copy A → B keeps B revision', ws.caliper.B.revision === 'BC-B rev 0.1');
  ws.resetSlot('brake-caliper', 'B');
  check('reset B returns to baseline', ws.caliper.B.bridgeMm === CALIPER_BASELINE.bridgeMm);
  ws.setCaliper('B', { materialId: 'a356-t6' });
  const est = estimatesFor(ws, 'brake-caliper');
  check('estimates table reads the store', est.rows[0].A > est.rows[0].B, `mass A ${est.rows[0].A.toFixed(2)} vs B ${est.rows[0].B.toFixed(2)}`);
  check('material diff reports the change', materialDiffs(ws, 'brake-caliper')[0].A !== materialDiffs(ws, 'brake-caliper')[0].B);
  check('parameter diff lists every parameter', parameterDiffs(ws, 'brake-caliper').length === 10);
  for (let i = 0; i < 50; i++) {
    ws.addRun({
      component: 'spark-plug',
      kind: 'test',
      title: 'Test run ' + i,
      revisions: { A: 'a', B: 'b' },
      source: 'estimated',
      conditions: '',
      metrics: [],
      series: [],
      feasible: { A: true, B: true },
    });
  }
  check('run history is capped', ws.runs.length === 40 && ws.runs[0].title === 'Test run 49');
  check('activity log is capped', ws.activity.length <= 30);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
