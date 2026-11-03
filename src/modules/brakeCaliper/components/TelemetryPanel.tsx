import { Badge, Panel, fmt } from '../../../ui/primitives';
import type { BadgeKind } from '../../../ui/primitives';
import { useSimSnapshot } from '../sim/useBrakeSim';
import { MODEL } from '../sim/brakeModel';

function Row({ l, v, u, b }: { l: string; v: string; u?: string; b: BadgeKind }) {
  return (
    <div className="tele-row">
      <span className="l">{l}</span>
      <span className="v">
        {v}
        {u && <small>{u}</small>}
      </span>
      <Badge kind={b} />
    </div>
  );
}

export function TelemetryPanel() {
  const sim = useSimSnapshot();
  const s = sim.state;
  const p = sim.params;
  const v = s.omega * p.wheelRadius;
  const frictionKW = (s.brakeTorque * s.omega) / 1000;
  const braking = s.clampForce > 0 && s.omega > 0;
  const stopDist = braking && s.decel > 0.05 ? (v * v) / (2 * s.decel) : null;
  const stopTime = braking && s.decel > 0.05 ? v / s.decel : null;
  const gripTorque = p.roadMu * p.quarterMass * 9.81 * p.wheelRadius;
  const pressureToGrip = gripTorque / (2 * p.padMu * sim.pistonAreaPerSide * p.rotorEffRadius) / 1e6 + MODEL.contactPressureMPa;

  return (
    <Panel className="telemetry" title="Live telemetry" right={<Badge kind="model" label="Illustrative" />}>
      <Row l="Wheel speed" v={fmt(sim.rpm, 0)} u="rpm" b="model" />
      <Row l="Vehicle speed" v={fmt(sim.speedKmh, 1)} u="km/h" b="derived" />
      <Row l="Line pressure" v={fmt(s.pressure, 2)} u="MPa" b="model" />
      <Row l="Piston travel" v={fmt(s.pistonTravelMm, 3)} u="mm" b="model" />
      <Row l="Clamp force / side" v={fmt(s.clampForce / 1000, 2)} u="kN" b="model" />
      <Row l="Brake torque" v={fmt(s.brakeTorque, 0)} u="N·m" b="model" />
      <Row l={s.decel < -0.005 ? 'Acceleration' : 'Deceleration'} v={fmt(Math.abs(s.decel), 2)} u="m/s²" b="model" />
      <Row l="Friction power" v={fmt(frictionKW, 1)} u="kW" b="model" />
      <Row l="Rotor temperature" v={fmt(s.rotorTempC, 1)} u="°C" b="estimated" />
      <Row l="Energy dissipated" v={fmt(s.energyJ / 1000, 1)} u="kJ" b="model" />

      <div className="sub-title">Engineering insights</div>
      {s.gripLimited && (
        <p className="insight warn-line">
          ⚠ Caliper torque exceeds tyre grip. Deceleration is capped at μ·g = <b>{fmt(p.roadMu * 9.81, 2)} m/s²</b>;
          above ≈<b>{fmt(pressureToGrip, 1)} MPa</b> extra pressure adds no stopping (an ideal-ABS assumption).
        </p>
      )}
      {stopDist !== null && stopTime !== null ? (
        <p className="insight">
          At the current deceleration the wheel stops in <b>{fmt(stopTime, 1)} s</b> over <b>{fmt(stopDist, 1)} m</b>.
          The pads are turning <b>{fmt(frictionKW, 0)} kW</b> of kinetic energy into heat.
        </p>
      ) : (
        <p className="insight">
          Not braking. Each 1 MPa above the {fmt(MODEL.contactPressureMPa, 2)} MPa contact pressure adds ≈
          <b> {fmt(2 * p.padMu * sim.pistonAreaPerSide * 1e6 * p.rotorEffRadius, 0)} N·m</b> of torque with this
          bore, μ and friction radius.
        </p>
      )}
      <p className="insight">
        Rotor temperature uses a lumped-capacitance estimate (9.5 kg cast iron, speed-dependent convection). Treat it as a
        trend, not a surface temperature.
      </p>
      <div className="sub-title">Model status</div>
      <p className="disclaimer">
        Simplified illustrative dynamics, not a validated brake solver: first-order hydraulics, linear pad compliance,
        constant μ, rolling without slip, no weight transfer. Running clearance is drawn ×33 so piston and pad travel are
        visible.
      </p>
    </Panel>
  );
}
