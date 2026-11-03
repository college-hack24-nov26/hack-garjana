// Quick sanity checks for the brake model, no browser needed. Run with: npm run test:sim
import { BrakeSim, kmhToRpm } from '../src/modules/brakeCaliper/sim/brakeModel.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

// 1. Cruise holds the target speed, and the wheel angle keeps pace with the rpm.
{
  const sim = new BrakeSim({ targetSpeedKmh: 80 });
  const rpm0 = sim.rpm;
  check('initial rpm matches v/R', Math.abs(rpm0 - kmhToRpm(80, 0.33)) < 1e-6, rpm0.toFixed(1) + ' rpm');
  sim.play();
  sim.advanceSim(5);
  check('cruise holds speed', Math.abs(sim.speedKmh - 80) < 0.5, sim.speedKmh.toFixed(2) + ' km/h');
  check('no brake torque while cruising', sim.state.brakeTorque === 0 && sim.state.pressure === 0);
}

// 2. Pressing the brake moves the pistons, makes torque, slows the car, heats the rotor and stops it.
{
  const sim = new BrakeSim({ targetSpeedKmh: 100, pressureSetpointMPa: 4 });
  sim.play();
  sim.setManualBrake(true);
  sim.advanceSim(0.5);
  const s = sim.state;
  check('pressure rises toward setpoint', s.pressure > 3.9, s.pressure.toFixed(3) + ' MPa');
  check('piston travel > clearance', s.pistonTravelMm > 0.15, s.pistonTravelMm.toFixed(3) + ' mm');
  check('brake torque positive', s.brakeTorque > 500, s.brakeTorque.toFixed(0) + ' N·m');
  check('decel plausible (0.3–1.0 g)', s.decel > 2.9 && s.decel < 9.81, (s.decel / 9.81).toFixed(2) + ' g');
  sim.advanceSim(10);
  check('wheel stops and holds', sim.state.omega === 0 && sim.state.phase === 'holding');
  check('wheel never reverses', sim.history.every((h) => h.rpm >= 0));
  check('rotor heated', sim.state.rotorTempC > 40, sim.state.rotorTempC.toFixed(1) + ' °C');
  const ke = 0.5 * 400 * (100 / 3.6) ** 2;
  check('energy dissipated ≈ kinetic energy (+losses)', sim.state.energyJ > 0.85 * ke && sim.state.energyJ < 1.15 * ke,
    `${(sim.state.energyJ / 1000).toFixed(1)} kJ vs KE ${(ke / 1000).toFixed(1)} kJ`);

  // Let go: pressure drops, the pistons pull back and cruise speeds up again.
  sim.setManualBrake(false);
  sim.advanceSim(1);
  check('pressure released', sim.state.pressure < 0.01, sim.state.pressure.toExponential(2));
  check('pistons retracted', sim.state.pistonTravelMm < 0.01, sim.state.pistonTravelMm.toFixed(4) + ' mm');
  check('cruise re-accelerating', sim.state.omega > 0 && sim.state.phase === 'accelerating');
  const v0 = sim.speedKmh / 3.6;
  sim.advanceSim(1);
  const a = sim.speedKmh / 3.6 - v0;
  check('cruise re-acceleration ≈ 3 m/s² limit', Math.abs(a - 3) < 0.15, a.toFixed(2) + ' m/s²');
}

// 3. More pressure means harder braking, until the tyre grip limit takes over.
{
  const dec = (mpa: number) => {
    const sim = new BrakeSim({ targetSpeedKmh: 100, pressureSetpointMPa: mpa });
    sim.play(); sim.setManualBrake(true); sim.advanceSim(0.6);
    return sim;
  };
  const a2 = dec(2).state.decel, a6 = dec(6).state.decel, s15 = dec(15);
  check('more pressure → more decel', a6 > a2, `${a2.toFixed(2)} → ${a6.toFixed(2)} m/s²`);
  check('grip cap at 15 MPa', s15.state.gripLimited && Math.abs(s15.state.decel - 9.81) < 0.6, s15.state.decel.toFixed(2) + ' m/s²');
}

// 4. At zero speed nothing turns, and in coast mode the car slows down on its own.
{
  const sim = new BrakeSim({ targetSpeedKmh: 0 });
  sim.play(); sim.advanceSim(3);
  check('0 rpm stays still', sim.state.omega === 0 && sim.state.theta === 0);
  const c = new BrakeSim({ targetSpeedKmh: 60, driveMode: 'coast' });
  c.play(); c.advanceSim(5);
  check('coast decays slowly', c.speedKmh < 60 && c.speedKmh > 55, c.speedKmh.toFixed(2) + ' km/h');
}

// 5. Run length and the scripted scenarios.
{
  const sim = new BrakeSim({ durationS: 3 });
  sim.play(); sim.advanceSim(10);
  check('stops at duration', Math.abs(sim.state.t - 3) < 1e-6 && sim.state.finished && !sim.running);
  const st = new BrakeSim({ scenario: 'single-stop', brakeAtS: 1, targetSpeedKmh: 60, durationS: 15 });
  st.play(); st.advanceSim(15);
  const minRpm = Math.min(...st.history.map((h) => h.rpm));
  check('single-stop reaches standstill then resumes', minRpm === 0 && st.speedKmh > 1, `end ${st.speedKmh.toFixed(1)} km/h`);
  const rp = new BrakeSim({ scenario: 'repeated-stops', brakeAtS: 1, targetSpeedKmh: 100, durationS: 60, pressureSetpointMPa: 6 });
  rp.play(); rp.advanceSim(60);
  let applications = 0;
  for (let i = 1; i < rp.history.length; i++) if (rp.history[i].pressureCmd > 0 && rp.history[i - 1].pressureCmd === 0) applications++;
  check('repeated stops cycle', applications >= 3, `${applications} applications, rotor ${rp.state.rotorTempC.toFixed(0)} °C`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
