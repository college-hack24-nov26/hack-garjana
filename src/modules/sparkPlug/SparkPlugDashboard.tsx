import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LineChart } from '../../ui/LineChart';
import { Badge, Panel, fmt } from '../../ui/primitives';
import { combustionIntensity, engineState, ignitionHzPerCylinder, pistonDrop } from './engine/kinematics';
import { fireLuminosity } from './engine/combustionVisual';
import { meanPistonSpeed, pistonVelocity } from './engine/linkage';
import { tipColourOrGrey } from './engine/tipWindow';
import { EngineSim } from './sim/engineSim';
import { EngineSimContext, useEngineSnapshot } from './sim/useEngineSim';
import { EngineParametersPanel, TIME_SCALES } from './components/EngineParametersPanel';
import { EngineTelemetryPanel } from './components/EngineTelemetryPanel';
import { ENGINE_VIEWS, EngineCanvas } from './three/EngineCanvas';
import type { EngineView } from './three/EngineCanvas';
import { A_COLOUR, B_COLOUR } from './three/EngineScene';
import { ViewportInfo } from '../../ui/ViewportInfo';
import { TwinWorkspace } from '../../ui/TwinWorkspace';

/** One EngineSim for the whole session, so it survives switching modules. */
let sharedSim: EngineSim | null = null;
function getEngineSim() {
  if (!sharedSim) {
    sharedSim = new EngineSim();
    sharedSim.play();
    if (import.meta.env.DEV) (window as unknown as { __engineSim: EngineSim }).__engineSim = sharedSim;
  }
  return sharedSim;
}

interface DashboardProps {
  moduleSwitch: ReactNode;
  onRunningChange?: (r: boolean) => void;
}

/** Spark Plug page: the AutoTwin split-plug engine inside the TwinLab dashboard. */
export function SparkPlugDashboard(props: DashboardProps) {
  const [sim] = useState(getEngineSim);
  return (
    <EngineSimContext.Provider value={sim}>
      <Body {...props} />
    </EngineSimContext.Provider>
  );
}

const fmtEngineTime = (t: number) => (t < 10 ? `${t.toFixed(3)} s` : `${t.toFixed(1)} s`);
const ANGLE_AXIS = {
  x: (d: { deg: number }) => d.deg,
  xMax: 720,
  xStep: 180,
  xTick: (v: number) => `${v}°`,
  xTip: (v: number) => `θ = ${v.toFixed(0)}° (cyl 1)`,
};

function Body({ moduleSwitch, onRunningChange }: DashboardProps) {
  const sim = useEngineSnapshot();
  const p = sim.params;
  const g = sim.geometry;
  const s = sim.state;
  const [view, setView] = useState<EngineView>('cutaway');
  const [viewNonce, setViewNonce] = useState(0);
  const [showBlock, setShowBlock] = useState(true);

  useEffect(() => onRunningChange?.(sim.running), [sim.running, onRunningChange]);

  // F turns the combustion fire on and off. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return;
      sim.setParams({ showCombustion: !sim.params.showCombustion });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sim]);

  const tipColours = useMemo(
    () => ({ A: tipColourOrGrey(p.tipTempA), B: tipColourOrGrey(p.tipTempB) }),
    [p.tipTempA, p.tipTempB],
  );
  const states = engineState(s.crankDeg, g);
  const hz = ignitionHzPerCylinder(p.rpm);
  const aliased = sim.running && s.lastStepDeg > 40;
  const scaleLabel = TIME_SCALES.find((o) => o.v === p.timeScale)?.label ?? `${p.timeScale}×`;

  // Curves over crank angle for cylinder 1. The geometry never changes, but velocity scales with rpm.
  const r = g.stroke / 2;
  const positionCurve = useMemo(
    () =>
      Array.from({ length: 361 }, (_, i) => {
        const deg = i * 2;
        return {
          deg,
          mm: pistonDrop(deg, g) * 1000,
          harmonic: r * (1 - Math.cos((deg * Math.PI) / 180)) * 1000,
          burn: combustionIntensity(deg) * 100,
          fire: fireLuminosity(deg) * 100,
        };
      }),
    [g, r],
  );
  const velocityCurve = useMemo(
    () => Array.from({ length: 361 }, (_, i) => ({ deg: i * 2, v: pistonVelocity(i * 2, p.rpm, g) })),
    [g, p.rpm],
  );
  const cyl1 = s.crankDeg; // cylinder 1 has zero phase offset

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Spark Plug Digital Twin</h1>
          <div className="page-sub">
            Spark Plug · split A/B plugs in one inline-4 · firing 1-3-4-2 · kinematics: AutoTwin slider-crank (illustrative
            engine, no solver)
          </div>
        </div>
        <div className="page-actions">
          {moduleSwitch}
          <div className="anim-clock">
            <div className="lbl">Engine time</div>
            <div className="val">
              {fmtEngineTime(s.t)} <small>· {scaleLabel.split(' ')[0]}</small>
            </div>
          </div>
          {sim.running ? (
            <button className="btn warn" onClick={() => sim.pause()}>
              ❚❚ Pause engine
            </button>
          ) : (
            <button className="btn primary" onClick={() => sim.play()}>
              ▶ {s.t > 0 ? 'Resume engine' : 'Animate engine'}
            </button>
          )}
          <button className="btn" onClick={() => sim.reset()}>
            ↺ Reset
          </button>
        </div>
      </div>

      <div className="kpis">
        <Panel bodyClass="kpi">
          <div className="k-label">◷ Crankshaft speed</div>
          <div className="k-value">
            {fmt(p.rpm, 0)}
            <small>rpm</small>
          </div>
          <div className="k-sub">
            ω {fmt(sim.omega, 1)} rad/s <Badge kind="input" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">⚡ Ignition rate</div>
          <div className="k-value">
            {fmt(hz * 4, hz * 4 < 100 ? 2 : 1)}
            <small>Hz total</small>
          </div>
          <div className="k-sub">
            {fmt(hz, 2)} Hz/cyl <Badge kind="theoretical" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">↕ Mean piston speed</div>
          <div className="k-value">
            {fmt(meanPistonSpeed(p.rpm, g), 2)}
            <small>m/s</small>
          </div>
          <div className="k-sub">
            2·S·N/60 · stroke {fmt(g.stroke * 1000, 0)} mm <Badge kind="derived" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">▲ Plug tip A / B</div>
          <div className="k-value">
            <span className="swatch" style={{ background: tipColours.A }} />
            {p.tipTempA === null ? '—' : fmt(p.tipTempA, 0)}
            <small>/</small> <span className="swatch" style={{ background: tipColours.B }} />
            {p.tipTempB === null ? '—' : fmt(p.tipTempB, 0)}
            <small>°C</small>
          </div>
          <div className="k-sub">
            {p.tipTempA === null && p.tipTempB === null ? 'no tip data' : 'entered values, not solver output'}{' '}
            <Badge kind="demo" />
          </div>
        </Panel>
      </div>

      <TwinWorkspace>
        <EngineParametersPanel />

        <div className="viewport">
          <EngineCanvas
            sim={sim}
            view={view}
            viewNonce={viewNonce}
            showBlock={showBlock}
            tipColours={tipColours}
            plug={p.plug}
            combustion={p.showCombustion}
          />
          <ViewportInfo>
            <div className="t">Split-plug A/B arrangement — one engine, identical operating conditions</div>
            <div className="d">
              Plug A: cyl 1 &amp; 4 · Plug B: cyl 2 &amp; 3 · <span style={{ color: A_COLOUR }}>■ A</span>{' '}
              <span style={{ color: B_COLOUR }}>■ B</span>
              <br />
              Illustrative inline-4, 2.0 L (86 × 86 mm, rod 143.5 mm) · plugs drawn ×1.6
            </div>
            <div className="w">
              Engine geometry is illustrative context. Tip colour = entered tip temperature.
              {p.showCombustion && ' Fire = visual combustion envelope, not a heat-release model.'}
            </div>
          </ViewportInfo>
          <div className="vp-readout">
            <div className="r">
              θ {fmt(s.crankDeg, 1)}° / 720 · {fmt(p.rpm, 0)} rpm
            </div>
          </div>
          {aliased && (
            <div className="vp-alias">
              ⚠ Display sampling: {fmt(s.lastStepDeg, 0)}° per frame — rendered motion is aliased (stroboscopic) and
              reads slower than it is. Reduce the time scale to observe the cycle.
            </div>
          )}
          {!sim.running && <div className="vp-paused">{s.t === 0 ? 'READY · PRESS ANIMATE' : 'PAUSED'}</div>}
          {view !== 'tips' && (
            <div className="cyl-row">
              {states.map((c) => (
                <div key={c.index} className={`cyl-chip ${c.combustion > 0.05 ? 'firing' : ''}`}>
                  <div className="top" style={{ color: c.design === 'A' ? A_COLOUR : B_COLOUR }}>
                    CYL {c.number} · PLUG {c.design}
                  </div>
                  <div className="st">{c.stroke}</div>
                </div>
              ))}
            </div>
          )}
          <div className="vp-bottom">
            {(Object.keys(ENGINE_VIEWS) as EngineView[]).map((v) => (
              <button
                key={v}
                className={`vp-btn ${view === v ? 'active' : ''}`}
                onClick={() => {
                  setView(v);
                  setViewNonce((n) => n + 1);
                }}
              >
                {ENGINE_VIEWS[v].label}
              </button>
            ))}
            <span style={{ width: 8 }} />
            <button className={`vp-btn ${showBlock ? 'active' : ''}`} aria-pressed={showBlock} onClick={() => setShowBlock(!showBlock)}>
              Block
            </button>
            <button
              className={`vp-btn fire ${p.showCombustion ? 'active' : ''}`}
              aria-pressed={p.showCombustion}
              title="Show or hide the combustion fire in the cylinders (F)"
              onClick={() => sim.setParams({ showCombustion: !p.showCombustion })}
            >
              🔥 Combustion {p.showCombustion ? 'on' : 'off'}
            </button>
            <button className="vp-btn" style={{ marginLeft: 'auto' }} onClick={() => setViewNonce((n) => n + 1)}>
              ↺ Reset view
            </button>
          </div>
        </div>

        <EngineTelemetryPanel />
      </TwinWorkspace>

      <div className="charts">
        <LineChart
          title="Piston 1 · distance from TDC"
          unit="mm"
          color="#22d3ee"
          data={positionCurve}
          version="position"
          {...ANGLE_AXIS}
          y={(d) => d.mm}
          reference={(d) => d.harmonic}
          seriesLabel="slider-crank"
          referenceLabel="pure sine (∞ rod)"
          digits={1}
          minYMax={90}
          marker={{ x: cyl1, y: pistonDrop(cyl1, g) * 1000 }}
        />
        <LineChart
          title="Piston 1 · velocity"
          unit="m/s"
          color="#a78bfa"
          data={velocityCurve}
          version={p.rpm}
          {...ANGLE_AXIS}
          y={(d) => d.v}
          seriesLabel="velocity (+ = down)"
          digits={2}
          minYMax={1}
          marker={{ x: cyl1, y: pistonVelocity(cyl1, p.rpm, g) }}
        />
        <LineChart
          title={`Cyl 1 · combustion glow (visual)${p.showCombustion ? '' : ' · fire hidden'}`}
          unit="%"
          color="#fb923c"
          data={positionCurve}
          version="fire"
          {...ANGLE_AXIS}
          y={(d) => d.fire}
          reference={(d) => d.burn}
          seriesLabel="fire glow (3D)"
          referenceLabel="AutoTwin kernel"
          minYMax={100}
          marker={{ x: cyl1, y: fireLuminosity(cyl1) * 100 }}
        />
        <LineChart
          title="Crankshaft speed"
          unit="rpm"
          color="#34d399"
          data={sim.history}
          version={sim.getVersion()}
          x={(h) => h.t}
          xMax={Math.max(s.t, 0.05)}
          xTick={(v) => `${+v.toFixed(3)}s`}
          xTip={(v) => `engine t = ${v.toFixed(3)} s`}
          y={(h) => h.rpm}
          seriesLabel="crank"
          minYMax={1000}
          marker={{ x: s.t, y: p.rpm }}
        />
      </div>
    </div>
  );
}
