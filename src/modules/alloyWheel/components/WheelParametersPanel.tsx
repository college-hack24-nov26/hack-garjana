import { useState } from 'react';
import { Badge, NumberInput, Panel, SliderField, Tabs, fmt } from '../../../ui/primitives';
import type { BadgeKind } from '../../../ui/primitives';
import { useWheelSnapshot } from '../sim/useWheelSim';
import { LOOP_SCRIPT, MODEL } from '../sim/wheelModel';
import type { Scenario } from '../sim/wheelModel';
import { DESIGN_SPECS, DRAWING_DESIGN, drawingTable } from '../wheel/drawing';
import type { Provenance } from '../wheel/drawing';
import { WHEEL_MATERIALS, fatigueStrength } from '../wheel/materials';
import type { WheelMaterialId } from '../wheel/materials';

type Tab = 'operating' | 'design' | 'run';

export const PLAYBACK = [
  { v: 0.05, label: '1/20× slow motion' },
  { v: 0.1, label: '1/10× slow motion' },
  { v: 0.25, label: '1/4× slow motion' },
  { v: 0.5, label: '1/2× slow motion' },
  { v: 1, label: '1× real time' },
  { v: 2, label: '2× accelerated' },
];

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'handling-loop', label: 'Handling loop: turns and a stop, repeating' },
  { id: 'cruise', label: 'Straight-line cruise' },
  { id: 'cornering', label: 'Steady right turn (this wheel outside)' },
  { id: 'brake-stop', label: 'Brake to a stop' },
  { id: 'manual', label: 'Manual: drive it yourself' },
];

export const provenanceBadge = (p: Provenance): { kind: BadgeKind; label?: string } =>
  p === 'drawing' ? { kind: 'drawing' } : p === 'derived' ? { kind: 'derived' } : p === 'interpreted' ? { kind: 'assumed', label: 'Interpreted' } : { kind: 'assumed' };

export function WheelParametersPanel() {
  const sim = useWheelSnapshot();
  const p = sim.params;
  const [tab, setTab] = useState<Tab>('operating');

  return (
    <Panel
      title="Parameters"
      right={
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'operating', label: 'Operating' },
            { id: 'design', label: 'Design' },
            { id: 'run', label: 'Run' },
          ]}
        />
      }
    >
      {tab === 'operating' && (
        <>
          <div className="field" style={{ paddingTop: 0 }}>
            <span className="field-label">Manoeuvre</span>
            <select className="select" value={p.scenario} onChange={(e) => sim.setParams({ scenario: e.target.value as Scenario })}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {p.scenario === 'handling-loop' && (
              <div className="hint">
                Every {MODEL.loopPeriodS} s: {LOOP_SCRIPT.map((x) => x.label).join(' → ')}.
              </div>
            )}
          </div>
          {p.scenario === 'manual' && <ManualControls />}
          <SliderField
            label="Cruise speed"
            hint="The driver returns to this between manoeuvres"
            value={p.targetSpeedKmh}
            min={0}
            max={200}
            step={1}
            unit="km/h"
            onChange={(v) => sim.setParams({ targetSpeedKmh: v })}
          />
          <SliderField label="Cornering" hint="Lateral acceleration in turns" value={p.lateralG} min={0} max={1.2} step={0.05} digits={2} unit="g" onChange={(v) => sim.setParams({ lateralG: v })} />
          <SliderField label="Braking" hint="Deceleration when braking" value={p.brakeG} min={0.1} max={1.2} step={0.05} digits={2} unit="g" onChange={(v) => sim.setParams({ brakeG: v })} />
          <SliderField
            label="Static wheel load"
            hint={<><Badge kind="demo" /> front-left corner at rest</>}
            value={p.staticLoadN}
            min={2500}
            max={8000}
            step={50}
            unit="N"
            onChange={(v) => sim.setParams({ staticLoadN: v })}
          />
          <SliderField label="Tyre pressure" value={p.tyrePressureBar} min={1.6} max={3.6} step={0.05} digits={2} unit="bar" onChange={(v) => sim.setParams({ tyrePressureBar: v })} />
          <SliderField label="Road grip μ" hint="Friction-circle limit on the tyre forces" value={p.roadMu} min={0.2} max={1.3} step={0.05} digits={2} onChange={(v) => sim.setParams({ roadMu: v })} />
        </>
      )}

      {tab === 'design' && <DesignTab />}

      {tab === 'run' && (
        <>
          <SliderField
            label="Simulation duration"
            hint="Physical (simulated) time"
            value={p.durationS}
            min={6}
            max={120}
            step={2}
            unit="s"
            onChange={(v) => sim.setParams({ durationS: Math.max(v, sim.state.t + 0.1) })}
          />
          <div className="field">
            <div className="field-row">
              <span className="field-label">
                Manoeuvre starts at
                <small>Scripted manoeuvres only</small>
              </span>
              <NumberInput
                value={p.manoeuvreAtS}
                digits={1}
                label="Manoeuvre start"
                onCommit={(v) => sim.setParams({ manoeuvreAtS: Math.max(0, Math.min(p.durationS, v)) })}
              />
              <span className="unit">s</span>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Playback speed (visual only)</span>
            <select className="select" value={p.playback} onChange={(e) => sim.setParams({ playback: Number(e.target.value) })}>
              {PLAYBACK.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="hint">
              Playback changes how fast simulated time is shown, not the physics. At {fmt(sim.rpm, 0)} rpm and {p.playback}× the
              wheel turns {fmt((sim.rpm * 6 * p.playback) / 60, 0)}° per 60 Hz frame
              {(sim.rpm * 6 * p.playback) / 60 > 360 / (2 * p.spokeCount) / 2
                ? ', enough for the spokes to strobe. Slow it down to follow them.'
                : '.'}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function ManualControls() {
  const sim = useWheelSnapshot();
  const m = sim.manual;
  return (
    <div className="field">
      <div className="manual-pad">
        <button className={`btn sm ${m.turn === -1 ? 'primary' : ''}`} aria-pressed={m.turn === -1} onClick={() => sim.setManual({ turn: m.turn === -1 ? 0 : -1 })}>
          ← Left
        </button>
        <button className={`btn sm ${m.accel ? 'primary' : ''}`} aria-pressed={m.accel} onClick={() => sim.setManual({ accel: !m.accel, brake: false })}>
          ↑ Accelerate
        </button>
        <button className={`btn sm ${m.turn === 1 ? 'primary' : ''}`} aria-pressed={m.turn === 1} onClick={() => sim.setManual({ turn: m.turn === 1 ? 0 : 1 })}>
          Right →
        </button>
        <button className={`btn sm ${m.brake ? 'brake-on' : 'danger'}`} aria-pressed={m.brake} onClick={() => sim.setManual({ brake: !m.brake, accel: false })}>
          ● Brake
        </button>
      </div>
      <div className="hint">
        Or hold <span className="kbd">←</span> <span className="kbd">→</span> to turn, <span className="kbd">↑</span> to accelerate and{' '}
        <span className="kbd">Space</span> to brake. This is the front-left wheel, so a right turn puts it on the outside.
      </div>
    </div>
  );
}

function DesignTab() {
  const sim = useWheelSnapshot();
  const p = sim.params;
  const mat = sim.material;
  const rows = drawingTable(sim.layout);
  const isDrawing = DESIGN_SPECS.every((s) => p[s.key] === DRAWING_DESIGN[s.key]) && p.spokeCount === DRAWING_DESIGN.spokeCount;

  return (
    <>
      <div className="note">
        Geometry follows the <b>reference drawing</b>. Changing a value rebuilds the 3D model, mass and stresses straight away.
      </div>
      <div className="field">
        <span className="field-label">Material</span>
        <select className="select" value={p.materialId} onChange={(e) => sim.setParams({ materialId: e.target.value as WheelMaterialId })}>
          {WHEEL_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="hint">
          {mat.note} ρ {fmt(mat.densityKgM3)} kg/m³ · E {fmt(mat.eGPa, 1)} GPa · yield {fmt(mat.yieldMPa)} MPa · fatigue strength at 10⁷
          cycles ≈ {fmt(fatigueStrength(mat, 1e7))} MPa (illustrative).
        </div>
      </div>
      <div className="field">
        <div className="field-row">
          <span className="field-label">Y-spokes</span>
          <Badge kind={p.spokeCount === 5 ? 'drawing' : 'assumed'} />
          <div className="seg">
            {[4, 5, 6, 7].map((n) => (
              <button key={n} className={p.spokeCount === n ? 'active' : ''} onClick={() => sim.setParams({ spokeCount: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      {DESIGN_SPECS.map((s) => {
        const b = provenanceBadge(p[s.key] === DRAWING_DESIGN[s.key] ? s.source : 'assumed');
        return (
          <SliderField
            key={s.key}
            label={s.label}
            hint={<><Badge kind={b.kind} label={b.label} /> {s.hint}</>}
            value={p[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            digits={s.digits}
            unit={s.unit}
            onChange={(v) => sim.setParams({ [s.key]: v })}
          />
        );
      })}
      <SliderField
        label="Junction stress factor Kt"
        hint={<><Badge kind="assumed" /> Applied at the hub, crotch and rim junctions. 1 = nominal beam stress.</>}
        value={p.kt}
        min={1}
        max={2.5}
        step={0.05}
        digits={2}
        onChange={(v) => sim.setParams({ kt: v })}
      />
      <div className="field">
        <button className="btn block" disabled={isDrawing} onClick={() => sim.setParams({ ...DRAWING_DESIGN })}>
          ↺ Reset spokes to the drawing
        </button>
      </div>
      <div className="sub-title">Dimensions (mm) and where they came from</div>
      <table className="dim-table">
        <tbody>
          {rows.map((r) => {
            const b = provenanceBadge(r.source);
            return (
              <tr key={r.label}>
                <td>
                  {r.label}
                  <small>{r.where}</small>
                </td>
                <td className="v">{r.value}</td>
                <td>
                  <Badge kind={b.kind} label={b.label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="disclaimer">
        The drawing&apos;s centre-cap emblem is a third-party trademark, so the twin uses a generic emblem of the same size
        (Ø60 cap, R15 ring).
      </p>
    </>
  );
}
