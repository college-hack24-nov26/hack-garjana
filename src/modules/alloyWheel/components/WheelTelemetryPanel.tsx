import { Badge, Panel, fmt } from '../../../ui/primitives';
import type { BadgeKind } from '../../../ui/primitives';
import { useWheelSnapshot } from '../sim/useWheelSim';
import { LOAD_TRANSFER, MODEL } from '../sim/wheelModel';
import { SPOTS, spotLabel } from '../sim/loads';

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

/** 1.2e-5 style for tiny numbers, plain otherwise. */
export const sci = (v: number, d = 1) => (v === 0 ? '0' : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6 ? v.toExponential(d) : fmt(v, 4));

export const fmtLife = (km: number) => (!Number.isFinite(km) || km > 1e7 ? '> 10⁷' : km >= 1e4 ? km.toExponential(1) : fmt(km, km < 10 ? 1 : 0));

export function WheelTelemetryPanel() {
  const sim = useWheelSnapshot();
  const s = sim.state;
  const p = sim.params;
  const mass = sim.mass;
  const limit = sim.fatigueLimitMPa;
  const fos = s.peakMPa > 0 ? sim.material.yieldMPa / s.peakMPa : Infinity;
  const bottomShare = s.arms.length ? Math.max(...s.arms.map((a) => a.n)) / Math.max(1, s.Fz) : 0;

  return (
    <Panel className="telemetry" title="Live telemetry" right={<Badge kind="model" label="Reduced-order" />}>
      <Row l="Vehicle speed" v={fmt(sim.speedKmh, 1)} u="km/h" b="model" />
      <Row l="Wheel speed" v={fmt(sim.rpm, 0)} u="rpm" b="derived" />
      <Row l="Vertical load Fz" v={fmt(s.Fz / 1000, 2)} u="kN" b="model" />
      <Row l="Lateral force Fy" v={fmt(s.Fy / 1000, 2)} u="kN" b="model" />
      <Row l="Longitudinal force Fx" v={fmt(s.Fx / 1000, 2)} u="kN" b="model" />
      <Row l="Wheel torque" v={fmt(s.torque, 0)} u="N·m" b="model" />
      <Row l="Spoke bending moment" v={fmt(s.moment, 0)} u="N·m" b="model" />

      <div className="sub-title">Spoke stress, worst spoke now</div>
      {SPOTS.map((sp) => (
        <Row key={sp.id} l={sp.label} v={fmt(s.spots[sp.id], 1)} u="MPa" b="estimated" />
      ))}
      <Row l="Rim hoop (inflation)" v={fmt(s.hoopMPa, 1)} u="MPa" b="derived" />
      <Row l="Rim hoop (spin)" v={fmt(s.spinMPa, 2)} u="MPa" b="derived" />

      <div className="sub-title">Tyre and fatigue</div>
      <Row l="Tyre deflection" v={fmt(s.deflection * 1000, 1)} u="mm" b="estimated" />
      <Row l="Revolutions" v={fmt(s.revolutions, 0)} b="derived" />
      <Row l="Distance" v={fmt(s.distanceM, 0)} u="m" b="derived" />
      <Row l="Stress amplitude (Goodman)" v={fmt(s.eqAmpMPa, 1)} u="MPa" b="estimated" />
      <Row l="Fatigue damage used" v={sci(s.damage)} b="estimated" />
      <Row l="Life at this condition" v={fmtLife(sim.lifeKm)} u="km" b="estimated" />

      <div className="sub-title">Wheel (from the drawn geometry)</div>
      <Row l="Mass" v={fmt(mass.massKg, 2)} u="kg" b="derived" />
      <Row l="Rim · spokes · hub" v={`${fmt(mass.rimKg, 1)} · ${fmt(mass.spokesKg, 1)} · ${fmt(mass.hubKg, 1)}`} u="kg" b="derived" />
      <Row l="Polar inertia" v={fmt(mass.inertiaKgM2, 3)} u="kg·m²" b="derived" />

      <div className="sub-title">Engineering insights</div>
      {s.gripLimited && (
        <p className="insight warn-line">
          ⚠ The tyre is at the friction circle (μ = {fmt(p.roadMu, 2)}). The car can&apos;t corner or brake harder, so the wheel
          loads stop rising too.
        </p>
      )}
      <p className="insight">
        The spoke over the contact patch carries <b>{fmt(bottomShare * 100, 0)} %</b> of Fz. Each spoke goes through one
        full stress cycle per turn. The critical point is the <b>{spotLabel(s.critSpot).toLowerCase()}</b>, swinging ±
        <b>{fmt(s.ampMPa, 1)} MPa</b> about <b>{fmt(s.meanMPa, 1)} MPa</b>.
      </p>
      <p className="insight">
        {s.eqAmpMPa > limit ? (
          <>
            That amplitude is above the {sim.material.short} fatigue strength at 10⁷ cycles (<b>{fmt(limit, 0)} MPa</b>), so
            this condition uses up life. It would last about <b>{fmtLife(sim.lifeKm)} km</b> if held continuously.
          </>
        ) : (
          <>
            That&apos;s below the {sim.material.short} fatigue strength at 10⁷ cycles (<b>{fmt(limit, 0)} MPa</b>), so this
            condition does little damage.
          </>
        )}{' '}
        Peak stress gives a factor of <b>{Number.isFinite(fos) ? fmt(fos, 1) : '—'}</b> on yield.
      </p>
      <div className="sub-title">Model status</div>
      <p className="disclaimer">
        Reduced-order hand calculation, not finite elements. Load sharing between spokes is assumed (half rigid-rim cosine,
        half concentrated at the patch), and each Y-spoke is a hub-to-rim beam with its ends held against rotation. Rim
        bending and casting porosity are not modelled. Load transfer uses h = {MODEL.cgHeight} m, wheelbase {MODEL.wheelbase}{' '}
        m and track {MODEL.track} m (gains {fmt(LOAD_TRANSFER.long, 2)} / {fmt(LOAD_TRANSFER.lat, 2)}). Fatigue uses
        Basquin + Goodman + Miner on illustrative constants: it ranks conditions, it does not predict life. Compare designs
        and conditions with it; don&apos;t certify anything.
      </p>
    </Panel>
  );
}
