import { useState } from 'react';
import { Badge, NumberInput, Panel, SliderField, Tabs, Toggle, fmt } from '../../../ui/primitives';
import { FLAME_SWEEP_DEG, SPARK_ADVANCE_DEG } from '../engine/combustionVisual';
import { crankDegreesPerFrame } from '../engine/kinematics';
import { TIP_STATUS_TEXT, tipColourOrGrey, tipStatus } from '../engine/tipWindow';
import { DEFAULT_ENGINE_PARAMS, REFERENCE_PLUG, TIP_WINDOW } from '../sim/engineSim';
import type { PlugGeometry } from '../sim/engineSim';
import { useEngineSnapshot } from '../sim/useEngineSim';

type Tab = 'operating' | 'plug' | 'run';

/** Time scale options, same as on the AutoTwin Experiment page. */
export const TIME_SCALES = [
  { v: 1, label: '1× real time' },
  { v: 0.1, label: '1/10× slow motion' },
  { v: 0.02, label: '1/50× slow motion' },
  { v: 0.005, label: '1/200× frame-by-frame' },
  { v: 0.001, label: '1/1000× frame-by-frame' },
];

function TipField({ label, design, value, onChange }: {
  label: string;
  design: 'A' | 'B';
  value: number | null;
  onChange: (v: number) => void;
}) {
  const status = tipStatus(value);
  return (
    <div className="field tip-field">
      <div className="field-row">
        <span className="field-label">
          <span className="swatch" style={{ background: design === 'A' ? '#f0a93b' : '#38bdf8' }} />
          {label}
        </span>
        <span className="swatch" style={{ background: tipColourOrGrey(value), width: 14, height: 14 }} title="Tip colour" />
        {value === null ? (
          <span className="num" style={{ color: 'var(--muted)' }}>—</span>
        ) : (
          <NumberInput value={value} label={`${label} temperature`} onCommit={(v) => onChange(Math.max(0, Math.min(1400, v)))} />
        )}
        <span className="unit">°C</span>
      </div>
      <span className={`tip-status ${status}`}>{TIP_STATUS_TEXT[status]}</span>
    </div>
  );
}

export function EngineParametersPanel() {
  const sim = useEngineSnapshot();
  const p = sim.params;
  const [tab, setTab] = useState<Tab>('operating');
  const hasTipData = p.tipTempA !== null || p.tipTempB !== null;
  const plugMm = (k: keyof PlugGeometry) => p.plug[k] * 1000;
  const setPlug = (k: keyof PlugGeometry, mm: number) => sim.setParams({ plug: { ...p.plug, [k]: mm / 1000 } });
  const degPerFrame = crankDegreesPerFrame(p.rpm, p.timeScale, 1 / 60);

  return (
    <Panel
      title="Parameters"
      right={
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'operating', label: 'Operating' },
            { id: 'plug', label: 'Plug' },
            { id: 'run', label: 'Run' },
          ]}
        />
      }
    >
      {tab === 'operating' && (
        <>
          <div className="note">
            These drive the <b>illustrative</b> engine animation only. They are not inputs to a finite-element solve.
          </div>
          <SliderField
            label="Engine speed"
            value={p.rpm}
            min={0}
            max={7000}
            step={100}
            unit="rpm"
            onChange={(v) => sim.setParams({ rpm: v })}
          />
          <Toggle
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Combustion fire <kbd className="kbd">F</kbd>
              </span>
            }
            on={p.showCombustion}
            onChange={(on) => sim.setParams({ showCombustion: on })}
          />
          <div className="hint" style={{ marginBottom: 6 }}>
            {p.showCombustion
              ? `Spark ${SPARK_ADVANCE_DEG}° before TDC, flame front crosses the chamber in ~${FLAME_SWEEP_DEG}°, burned gas glows through expansion. Visual envelope only — motion, strokes and firing order are unchanged.`
              : 'Fire hidden. Pistons, strokes and firing order are unchanged; the cylinder chips still mark the burning cylinder.'}
          </div>
          <div className="sub-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Plug tip temperature <Badge kind="demo" />
          </div>
          <div className="hint" style={{ marginBottom: 2 }}>
            No solver is connected in this build. Enter tip temperatures from your solver or test data; the defaults are
            placeholders. Heat-range window {TIP_WINDOW.selfCleaningC}–{TIP_WINDOW.preIgnitionC} °C.
          </div>
          <Toggle
            label="Colour tips from entered values"
            on={hasTipData}
            onChange={(on) =>
              sim.setParams(
                on
                  ? { tipTempA: DEFAULT_ENGINE_PARAMS.tipTempA, tipTempB: DEFAULT_ENGINE_PARAMS.tipTempB }
                  : { tipTempA: null, tipTempB: null },
              )
            }
          />
          <TipField label="Plug A (cyl 1, 4)" design="A" value={p.tipTempA} onChange={(v) => sim.setParams({ tipTempA: v })} />
          <TipField label="Plug B (cyl 2, 3)" design="B" value={p.tipTempB} onChange={(v) => sim.setParams({ tipTempB: v })} />
        </>
      )}

      {tab === 'plug' && (
        <>
          <div className="note amber">
            Plug geometry used to <b>draw</b> both plugs (×1.6 for legibility). The insulator nose length is the heat-range
            variable.
          </div>
          <SliderField label="Insulator nose length" value={plugMm('noseLength')} min={3} max={14} step={0.1} digits={1} unit="mm" onChange={(v) => setPlug('noseLength', v)} />
          <SliderField label="Insulator nose Ø" value={plugMm('noseDiameter')} min={4} max={9} step={0.1} digits={1} unit="mm" onChange={(v) => setPlug('noseDiameter', v)} />
          <SliderField label="Centre electrode Ø" value={plugMm('electrodeDiameter')} min={0.6} max={3} step={0.05} digits={2} unit="mm" onChange={(v) => setPlug('electrodeDiameter', v)} />
          <SliderField label="Electrode protrusion" value={plugMm('electrodeProtrusion')} min={0} max={5} step={0.1} digits={1} unit="mm" onChange={(v) => setPlug('electrodeProtrusion', v)} />
          <div className="field">
            <div className="field-row">
              <span className="field-label">Thread</span>
              <div className="seg">
                {[10, 12, 14].map((d) => (
                  <button key={d} className={Math.round(plugMm('threadDiameter')) === d ? 'active' : ''} onClick={() => setPlug('threadDiameter', d)}>
                    M{d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SliderField label="Shell reach" value={plugMm('shellLength')} min={12} max={26.5} step={0.5} digits={1} unit="mm" onChange={(v) => setPlug('shellLength', v)} />
          <button className="btn sm" onClick={() => sim.setParams({ plug: REFERENCE_PLUG })}>
            ↺ Reference plug
          </button>
        </>
      )}

      {tab === 'run' && (
        <>
          <div className="field">
            <span className="field-label">Time scale (visual playback)</span>
            <select className="select" value={p.timeScale} onChange={(e) => sim.setParams({ timeScale: Number(e.target.value) })}>
              {TIME_SCALES.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="hint">
              At real time a 6,000 rpm crank advances 600° per display frame, so the motion is stroboscopic. Slow motion
              makes the cycle observable. Now: {fmt(p.rpm, 0)} rpm × {p.timeScale} → {fmt(degPerFrame, 1)}° per 60 Hz frame
              {degPerFrame > 40 ? ' (aliased).' : '.'}
            </div>
          </div>
          <div className="field">
            <div className="hint">
              <b style={{ color: 'var(--text)' }}>Engine time</b> is physical time in the cycle (header clock). The time
              scale only changes how fast that time is shown — crank angle, strokes and firing order are unaffected.
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
