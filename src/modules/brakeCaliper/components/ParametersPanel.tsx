import { useState } from 'react';
import { NumberInput, Panel, SliderField, Tabs, fmt } from '../../../ui/primitives';
import { useSimSnapshot } from '../sim/useBrakeSim';
import { MODEL, kmhToRpm, rpmToKmh } from '../sim/brakeModel';
import type { DriveMode, Scenario } from '../sim/brakeModel';

type Tab = 'operating' | 'brake' | 'run';

const PLAYBACK = [
  { v: 0.05, label: '1/20× slow motion' },
  { v: 0.1, label: '1/10× slow motion' },
  { v: 0.25, label: '1/4× slow motion' },
  { v: 0.5, label: '1/2× slow motion' },
  { v: 1, label: '1× real time' },
  { v: 2, label: '2× accelerated' },
];

export function ParametersPanel() {
  const sim = useSimSnapshot();
  const p = sim.params;
  const [tab, setTab] = useState<Tab>('operating');
  const R = p.wheelRadius;
  const targetRpm = kmhToRpm(p.targetSpeedKmh, R);
  const maxKmh = 200;

  return (
    <Panel
      title="Parameters"
      right={
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'operating', label: 'Operating' },
            { id: 'brake', label: 'Brake' },
            { id: 'run', label: 'Run' },
          ]}
        />
      }
    >
      {tab === 'operating' && (
        <>
          <div className="note">
            These drive the <b>illustrative</b> brake model. Speed and RPM are linked by the effective rolling radius{' '}
            <b>R = {R.toFixed(2)} m</b>.
          </div>
          <SliderField
            label="Vehicle speed"
            hint={p.driveMode === 'cruise' ? 'Cruise target; wheel ramps to it' : 'Initial speed (coasting)'}
            value={p.targetSpeedKmh}
            min={0}
            max={maxKmh}
            step={1}
            unit="km/h"
            onChange={(v) => sim.setParams({ targetSpeedKmh: v })}
          />
          <div className="field" style={{ paddingTop: 0 }}>
            <div className="field-row">
              <span className="field-label">
                Wheel speed
                <small>= v / (2πR) · 60</small>
              </span>
              <NumberInput
                value={targetRpm}
                label="Wheel speed rpm"
                onCommit={(rpm) => sim.setParams({ targetSpeedKmh: Math.min(maxKmh, Math.max(0, rpmToKmh(rpm, R))) })}
              />
              <span className="unit">rpm</span>
            </div>
          </div>
          <div className="field">
            <div className="field-row">
              <span className="field-label">After release</span>
            </div>
            <div className="seg" style={{ width: '100%' }}>
              {(['cruise', 'coast'] as DriveMode[]).map((m) => (
                <button
                  key={m}
                  style={{ flex: 1 }}
                  className={p.driveMode === m ? 'active' : ''}
                  onClick={() => sim.setParams({ driveMode: m })}
                >
                  {m === 'cruise' ? 'Cruise to target' : 'Coast (no drive)'}
                </button>
              ))}
            </div>
          </div>
          <SliderField
            label="Brake line pressure"
            hint="Commanded when the brake is applied"
            value={p.pressureSetpointMPa}
            min={0}
            max={15}
            step={0.1}
            digits={1}
            unit="MPa"
            onChange={(v) => sim.setParams({ pressureSetpointMPa: v })}
          />
          <div className="field">
            <button
              className={`btn block ${sim.manualBrake ? 'brake-on' : 'danger'}`}
              aria-pressed={sim.manualBrake}
              onClick={() => sim.setManualBrake(!sim.manualBrake)}
            >
              {sim.manualBrake ? '■ Release brake' : '● Apply brake'}
            </button>
            <div className="hint">
              Or hold <span className="kbd">Space</span> to brake momentarily. Inputs take effect while the simulation is
              playing.
            </div>
          </div>
        </>
      )}

      {tab === 'brake' && (
        <>
          <div className="note amber">
            Geometry is fixed to the drawn assembly; friction and mass values are <b>illustrative defaults</b>, not
            measured data.
          </div>
          <SliderField
            label="Piston bore"
            value={p.pistonDiaMm}
            min={28}
            max={44}
            step={1}
            unit="mm"
            onChange={(v) => sim.setParams({ pistonDiaMm: v })}
          />
          <div className="field">
            <div className="field-row">
              <span className="field-label">Pistons per side</span>
              <div className="seg">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={p.pistonsPerSide === n ? 'active' : ''}
                    onClick={() => sim.setParams({ pistonsPerSide: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="hint">
              Opposed caliper → {p.pistonsPerSide * 2} pistons total · area per side{' '}
              {fmt(sim.pistonAreaPerSide * 1e6, 0)} mm²
            </div>
          </div>
          <SliderField
            label="Pad friction μ"
            value={p.padMu}
            min={0.2}
            max={0.6}
            step={0.01}
            digits={2}
            onChange={(v) => sim.setParams({ padMu: v })}
          />
          <SliderField
            label="Tyre–road μ"
            hint="Grip cap (ideal ABS, no lock-up)"
            value={p.roadMu}
            min={0.2}
            max={1.2}
            step={0.05}
            digits={2}
            onChange={(v) => sim.setParams({ roadMu: v })}
          />
          <SliderField
            label="Quarter-vehicle mass"
            value={p.quarterMass}
            min={200}
            max={800}
            step={10}
            unit="kg"
            onChange={(v) => sim.setParams({ quarterMass: v })}
          />
          <div className="sub-title">Fixed by geometry</div>
          <div className="tele-row">
            <span className="l">Rolling radius (225/45 R18)</span>
            <span className="v">{R.toFixed(3)}<small>m</small></span>
          </div>
          <div className="tele-row">
            <span className="l">Effective friction radius</span>
            <span className="v">{p.rotorEffRadius.toFixed(3)}<small>m</small></span>
          </div>
          <div className="tele-row">
            <span className="l">Running clearance / side</span>
            <span className="v">{MODEL.runningClearanceMm.toFixed(2)}<small>mm</small></span>
          </div>
        </>
      )}

      {tab === 'run' && (
        <>
          <div className="field">
            <span className="field-label">Scenario</span>
            <select
              className="select"
              value={p.scenario}
              onChange={(e) => sim.setParams({ scenario: e.target.value as Scenario })}
            >
              <option value="manual">Manual — apply / release yourself</option>
              <option value="single-stop">Single stop — brake to standstill</option>
              <option value="repeated-stops">Repeated snubs — target → 35 % → target</option>
            </select>
            {p.scenario !== 'manual' && (
              <div className="field-row">
                <span className="field-label">Brake onset</span>
                <NumberInput
                  value={p.brakeAtS}
                  digits={1}
                  label="Brake onset time"
                  onCommit={(v) => sim.setParams({ brakeAtS: Math.max(0, Math.min(p.durationS, v)) })}
                />
                <span className="unit">s</span>
              </div>
            )}
          </div>
          <SliderField
            label="Simulation duration"
            hint="Physical (simulated) time"
            value={p.durationS}
            min={5}
            max={120}
            step={5}
            unit="s"
            onChange={(v) => sim.setParams({ durationS: Math.max(v, sim.state.t + 0.1) })}
          />
          <div className="field">
            <span className="field-label">Playback speed (visual only)</span>
            <select
              className="select"
              value={p.playback}
              onChange={(e) => sim.setParams({ playback: Number(e.target.value) })}
            >
              {PLAYBACK.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="hint">
              Playback changes how fast simulated time is shown, not the physics. At {fmt(sim.rpm, 0)} rpm and{' '}
              {p.playback}× the wheel turns {fmt((sim.rpm * 6 * p.playback) / 60, 0)}° per 60 Hz frame
              {(sim.rpm * 6 * p.playback) / 60 > 30
                ? ' — more than the spoke pitch allows, so rotation will strobe. Use slow motion to read it.'
                : '.'}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
