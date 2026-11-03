import { Badge, Panel, fmt } from '../../../ui/primitives';
import type { BadgeKind } from '../../../ui/primitives';
import { engineState, ignitionHzPerCylinder } from '../engine/kinematics';
import { meanPistonSpeed, pistonVelocity } from '../engine/linkage';
import { TIP_STATUS_TEXT, tipStatus } from '../engine/tipWindow';
import { TIP_WINDOW } from '../sim/engineSim';
import { useEngineSnapshot } from '../sim/useEngineSim';
import { A_COLOUR, B_COLOUR } from '../three/EngineScene';

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

/** Highest piston speed over one revolution at this rpm, checked every 1°. */
function peakPistonSpeed(rpm: number, g: Parameters<typeof pistonVelocity>[2]) {
  let peak = 0;
  let at = 0;
  for (let d = 0; d < 180; d++) {
    const v = Math.abs(pistonVelocity(d, rpm, g));
    if (v > peak) {
      peak = v;
      at = d;
    }
  }
  return { peak, at };
}

export function EngineTelemetryPanel() {
  const sim = useEngineSnapshot();
  const p = sim.params;
  const g = sim.geometry;
  const states = engineState(sim.state.crankDeg, g);
  const hz = ignitionHzPerCylinder(p.rpm);
  const peak = peakPistonSpeed(p.rpm, g);
  const firing = states.find((s) => s.combustion > 0.05);

  return (
    <Panel className="telemetry" title="Live telemetry" right={<Badge kind="theoretical" label="Kinematic" />}>
      <Row l="Engine speed" v={fmt(p.rpm, 0)} u="rpm" b="input" />
      <Row l="Crank angle" v={`${fmt(sim.state.crankDeg, 1)} / 720`} u="°" b="derived" />
      <Row l="Ignition / cylinder (N/120)" v={fmt(hz, 2)} u="Hz" b="theoretical" />
      <Row l="Ignition total (4·N/120)" v={fmt(hz * 4, 1)} u="Hz" b="theoretical" />
      <Row l="Mean piston speed" v={fmt(meanPistonSpeed(p.rpm, g), 2)} u="m/s" b="derived" />
      <Row l={`Peak piston speed (θ≈${peak.at}°)`} v={fmt(peak.peak, 2)} u="m/s" b="derived" />
      <Row l="Firing events (engine time)" v={fmt(sim.ignitions, 0)} b="derived" />

      <div className="sub-title">Cylinders · firing order 1-3-4-2</div>
      <table className="cyl-table">
        <thead>
          <tr>
            <th>Cyl</th>
            <th>Plug</th>
            <th>Stroke</th>
            <th className="r">From TDC</th>
          </tr>
        </thead>
        <tbody>
          {states.map((s) => (
            <tr key={s.index}>
              <td>{s.number}</td>
              <td style={{ color: s.design === 'A' ? A_COLOUR : B_COLOUR }}>{s.design}</td>
              <td style={{ color: s.combustion > 0.05 ? 'var(--amber)' : undefined }}>{s.stroke}</td>
              <td className="r">{fmt(s.dropFraction * g.stroke * 1000, 1)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sub-title">Findings</div>
      {(['A', 'B'] as const).map((d) => {
        const t = d === 'A' ? p.tipTempA : p.tipTempB;
        const st = tipStatus(t);
        return (
          <p className="insight" key={d}>
            Plug {d}:{' '}
            {t === null ? (
              'no tip temperature entered — tips drawn grey.'
            ) : (
              <>
                <b>{fmt(t, 0)} °C</b> entered — <span className={`tip-status ${st}`}>{TIP_STATUS_TEXT[st]}</span> (
                {TIP_WINDOW.selfCleaningC}–{TIP_WINDOW.preIgnitionC} °C).
              </>
            )}
          </p>
        );
      })}
      <p className="insight">
        {firing ? (
          <>
            Cylinder <b>{firing.number}</b> (plug {firing.design}) is burning. Exactly one cylinder fires every 180° of
            crank.
          </>
        ) : (
          <>Between flame kernels. Exactly one cylinder fires every 180° of crank.</>
        )}{' '}
        Pistons 1/4 and 2/3 move in pairs.
      </p>
      <div className="sub-title">Model status</div>
      <p className="disclaimer">
        Kinematic illustration of a reference 2.0 L inline-4 (86 × 86 mm, rod 143.5 mm), ported from the AutoTwin engine
        kinematics. The combustion fire and flame kernel are visual envelopes, not a heat-release or flame-propagation
        model. No solver runs in this build: tip temperatures are entered values, not results.
      </p>
    </Panel>
  );
}
