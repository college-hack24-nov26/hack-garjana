import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrakeSim, MODEL } from './sim/brakeModel';
import { BrakeSimContext, pressureColor, useSimSnapshot } from './sim/useBrakeSim';
import { BrakeScene } from './three/BrakeScene';
import type { CameraView } from './three/BrakeScene';
import { CLEARANCE_EXAGGERATION } from './three/BrakeAssembly';
import { ParametersPanel } from './components/ParametersPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { LineChart } from '../../ui/LineChart';
import { Badge, Panel, fmt } from '../../ui/primitives';

const PHASE_LABEL: Record<string, string> = {
  stopped: 'Stopped',
  cruising: 'Cruising',
  accelerating: 'Accelerating',
  coasting: 'Coasting',
  braking: 'Braking',
  holding: 'Holding (stopped)',
  releasing: 'Releasing',
};

const TIME_AXIS = {
  x: (h: { t: number }) => h.t,
  xTick: (v: number) => `${+v.toFixed(1)}s`,
  xTip: (v: number) => `t = ${v.toFixed(2)} s`,
};

const fmtClock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

/** One BrakeSim for the whole session, so it survives switching modules. */
let sharedSim: BrakeSim | null = null;
function getBrakeSim() {
  if (!sharedSim) {
    sharedSim = new BrakeSim();
    sharedSim.play(); // start moving on first load. Reset takes it back to a paused t = 0
    // Dev-only hook for automated UI checks. Production builds leave it out.
    if (import.meta.env.DEV) (window as unknown as { __brakeSim: BrakeSim }).__brakeSim = sharedSim;
  }
  return sharedSim;
}

interface DashboardProps {
  moduleSwitch: ReactNode;
  onRunningChange?: (r: boolean) => void;
}

/**
 * Brake Caliper page. Holds the BrakeSim and hands it down through context.
 * Everything on screen (3D, KPI cards, telemetry, charts) reads from it.
 */
export function BrakeCaliperDashboard(props: DashboardProps) {
  const [sim] = useState(getBrakeSim);
  return (
    <BrakeSimContext.Provider value={sim}>
      <DashboardBody {...props} />
    </BrakeSimContext.Provider>
  );
}

function DashboardBody({ moduleSwitch, onRunningChange }: DashboardProps) {
  const sim = useSimSnapshot();
  const s = sim.state;
  const p = sim.params;
  const [view, setView] = useState<CameraView>('iso');
  const [viewNonce, setViewNonce] = useState(0);
  const [cutaway, setCutaway] = useState(true);
  const [showTyre, setShowTyre] = useState(true);

  useEffect(() => onRunningChange?.(sim.running), [sim.running, onRunningChange]);

  // Hold Space to brake. Ignored while typing in a field.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e) || e.repeat) return;
      e.preventDefault();
      sim.setManualBrake(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e)) return;
      e.preventDefault();
      sim.setManualBrake(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [sim]);

  const chooseView = (v: CameraView) => {
    setView(v);
    setViewNonce((n) => n + 1);
    if (v === 'side') setCutaway(true); // you can't see the caliper edge-on without the cutaway
  };

  const thetaDeg = (s.theta * 180) / Math.PI;
  const decelG = s.decel / 9.81;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Brake Caliper Digital Twin</h1>
          <div className="page-sub">
            Brake Caliper · fixed {p.pistonsPerSide * 2}-piston opposed · Ø330×28 vented rotor · model: simplified
            illustrative dynamics (not solver-verified)
          </div>
        </div>
        <div className="page-actions">
          {moduleSwitch}
          <div className="anim-clock">
            <div className="lbl">Sim time</div>
            <div className="val">
              {fmtClock(s.t)} <small>/ {fmtClock(p.durationS)}</small>
            </div>
          </div>
          {sim.running ? (
            <button className="btn warn" onClick={() => sim.pause()}>
              ❚❚ Pause
            </button>
          ) : (
            <button className="btn primary" onClick={() => sim.play()}>
              ▶ {s.finished ? 'Replay' : s.t > 0 ? 'Resume' : 'Play'}
            </button>
          )}
          <button className="btn" onClick={() => sim.reset()}>
            ↺ Reset
          </button>
        </div>
      </div>

      <div className="kpis">
        <Panel bodyClass="kpi">
          <div className="k-label">◷ Wheel speed</div>
          <div className="k-value">
            {fmt(sim.rpm, 0)}
            <small>rpm</small>
          </div>
          <div className="k-sub">
            {fmt(sim.speedKmh, 1)} km/h · ω {fmt(s.omega, 1)} rad/s <Badge kind="model" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">
            <span style={{ color: pressureColor(s.pressure) }}>●</span> Line pressure
          </div>
          <div className="k-value">
            {fmt(s.pressure, 2)}
            <small>MPa</small>
          </div>
          <div className="k-sub">
            set {fmt(p.pressureSetpointMPa, 1)} MPa · {fmt(s.pressure * 10, 1)} bar <Badge kind="model" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">⟳ Brake torque</div>
          <div className="k-value">
            {fmt(s.brakeTorque, 0)}
            <small>N·m</small>
          </div>
          <div className="k-sub">
            {s.decel < -0.005 ? 'accel' : 'decel'} {fmt(Math.abs(s.decel), 2)} m/s² · {fmt(Math.abs(decelG), 2)} g{' '}
            <Badge kind="model" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">▲ Rotor temperature</div>
          <div className="k-value">
            {fmt(s.rotorTempC, 1)}
            <small>°C</small>
          </div>
          <div className="k-sub">
            Δ{fmt(s.rotorTempC - p.ambientC, 1)} K over ambient <Badge kind="estimated" />
          </div>
        </Panel>
      </div>

      <div className="workspace">
        <ParametersPanel />

        <div className="viewport">
          <BrakeScene sim={sim} view={view} viewNonce={viewNonce} cutaway={cutaway} showTyre={showTyre} />
          <div className="vp-info">
            <div className="t">Front corner brake assembly — fixed caliper, rotating wheel + rotor</div>
            <div className="d">
              225/45 R18 · 5-spoke alloy · Ø330×28 mm vented rotor · {p.pistonsPerSide * 2}× Ø{p.pistonDiaMm} mm
              opposed pistons
              <br />
              Hydraulic fluid colour = line pressure · pad glow = friction power
            </div>
            <div className="w">
              Geometry is illustrative · clearance drawn ×{Math.round(CLEARANCE_EXAGGERATION)} (
              {MODEL.runningClearanceMm} mm → {(MODEL.runningClearanceMm * CLEARANCE_EXAGGERATION).toFixed(0)} mm)
            </div>
          </div>
          <div className="vp-readout">
            <div className="r">
              θ {thetaDeg.toFixed(1).padStart(5, ' ')}° · {fmt(sim.rpm, 0)} rpm · {fmt(s.pressure, 1)} MPa
            </div>
            <span className={`state-chip ${s.phase}`}>{PHASE_LABEL[s.phase]}</span>
            {s.gripLimited && <span className="state-chip releasing">Grip limited</span>}
          </div>
          {!sim.running && (
            <div className="vp-paused">{s.finished ? 'RUN COMPLETE' : s.t === 0 ? 'READY · PRESS PLAY' : 'PAUSED'}</div>
          )}
          <div className="vp-legend">
            <span>0</span>
            <span className="bar" />
            <span>≥10 MPa</span>
          </div>
          <div className="vp-bottom">
            {(['front', 'side', 'iso'] as CameraView[]).map((v) => (
              <button key={v} className={`vp-btn ${view === v ? 'active' : ''}`} onClick={() => chooseView(v)}>
                {v === 'front' ? 'Front' : v === 'side' ? 'Side section' : 'Isometric'}
              </button>
            ))}
            <span style={{ width: 8 }} />
            <button className={`vp-btn ${cutaway ? 'active' : ''}`} aria-pressed={cutaway} onClick={() => setCutaway(!cutaway)}>
              Cutaway
            </button>
            <button className={`vp-btn ${showTyre ? 'active' : ''}`} aria-pressed={showTyre} onClick={() => setShowTyre(!showTyre)}>
              Tyre
            </button>
            <button
              className="vp-btn"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                setViewNonce((n) => n + 1);
              }}
            >
              ↺ Reset view
            </button>
          </div>
        </div>

        <TelemetryPanel />
      </div>

      <div className="charts">
        <LineChart
          title="Wheel speed"
          unit="rpm"
          color="#22d3ee"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.rpm}
          reference={(h) => h.targetRpm}
          seriesLabel="wheel"
          referenceLabel={p.driveMode === 'cruise' ? 'cruise target' : 'initial'}
          minYMax={200}
        />
        <LineChart
          title="Line pressure"
          unit="MPa"
          color="#fb923c"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.pressure}
          reference={(h) => h.pressureCmd}
          seriesLabel="line"
          referenceLabel="command"
          digits={2}
          minYMax={2}
        />
        <LineChart
          title="Brake torque"
          unit="N·m"
          color="#a78bfa"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.torque}
          seriesLabel="torque"
          minYMax={200}
        />
        <LineChart
          title="Rotor temperature (est.)"
          unit="°C"
          color="#f472b6"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.tempC}
          seriesLabel="rotor"
          digits={1}
          minYMax={p.ambientC + 15}
          yMin={Math.floor(p.ambientC / 10) * 10}
        />
      </div>
    </div>
  );
}
