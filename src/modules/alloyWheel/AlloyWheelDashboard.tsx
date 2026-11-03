import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LineChart } from '../../ui/LineChart';
import { Badge, Panel, fmt } from '../../ui/primitives';
import { useStoreVersion } from '../../core/useStoreVersion';
import { WheelSim } from './sim/wheelModel';
import type { WheelPhase } from './sim/wheelModel';
import { BuildClockContext, STRESS_GRADIENT, WheelSimContext, stressCss, useWheelSnapshot } from './sim/useWheelSim';
import { spotLabel } from './sim/loads';
import { BUILD_DURATION, BUILD_STEPS, BuildClock, currentStep } from './wheel/build';
import { DRAWING } from './wheel/drawing';
import { WheelScene, WHEEL_VIEWS } from './three/WheelScene';
import type { WheelView } from './three/WheelScene';
import { WheelParametersPanel } from './components/WheelParametersPanel';
import { WheelTelemetryPanel, fmtLife, sci } from './components/WheelTelemetryPanel';

const PHASE: Record<WheelPhase, { label: string; cls: string }> = {
  stopped: { label: 'Stopped', cls: 'stopped' },
  holding: { label: 'Holding (stopped)', cls: 'holding' },
  cruising: { label: 'Cruising', cls: 'cruising' },
  accelerating: { label: 'Accelerating', cls: 'accelerating' },
  braking: { label: 'Braking', cls: 'braking' },
  'corner-outer': { label: 'Right turn · outer wheel', cls: 'cornering' },
  'corner-inner': { label: 'Left turn · inner wheel', cls: 'cornering' },
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

/** One WheelSim and build clock for the whole session, so they survive switching modules. */
let shared: { sim: WheelSim; clock: BuildClock } | null = null;
function getShared() {
  if (!shared) {
    shared = { sim: new WheelSim(), clock: new BuildClock() };
    shared.sim.play();
    if (import.meta.env.DEV) (window as unknown as { __wheelSim: WheelSim }).__wheelSim = shared.sim;
  }
  return shared;
}

interface DashboardProps {
  moduleSwitch: ReactNode;
  onRunningChange?: (r: boolean) => void;
}

/** Alloy Wheel page: the wheel from the reference drawing, rolling under a live load path. */
export function AlloyWheelDashboard(props: DashboardProps) {
  const [{ sim, clock }] = useState(getShared);
  return (
    <WheelSimContext.Provider value={sim}>
      <BuildClockContext.Provider value={clock}>
        <Body {...props} clock={clock} />
      </BuildClockContext.Provider>
    </WheelSimContext.Provider>
  );
}

function Body({ moduleSwitch, onRunningChange, clock }: DashboardProps & { clock: BuildClock }) {
  const sim = useWheelSnapshot();
  useStoreVersion(clock);
  const s = sim.state;
  const p = sim.params;
  const [view, setView] = useState<WheelView>('iso');
  const [viewNonce, setViewNonce] = useState(0);
  const [showTyre, setShowTyre] = useState(true);
  const [showLoads, setShowLoads] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [section, setSection] = useState(false);
  const [exploded, setExploded] = useState(false);
  const resumeAfterBuild = useRef(false);

  useEffect(() => onRunningChange?.(sim.running), [sim.running, onRunningChange]);

  // When the build sequence finishes, carry on driving if we were driving before.
  useEffect(() => {
    if (!clock.active && resumeAfterBuild.current) {
      resumeAfterBuild.current = false;
      sim.play();
    }
  }, [clock.active, sim]);

  // Keyboard driving: ←/→ turn, ↑ accelerate, Space brake. Switches to Manual if needed.
  useEffect(() => {
    const keys: Record<string, (on: boolean) => Partial<WheelSim['manual']>> = {
      Space: (on) => ({ brake: on }),
      ArrowUp: (on) => ({ accel: on }),
      ArrowLeft: (on) => ({ turn: on ? -1 : 0 }),
      ArrowRight: (on) => ({ turn: on ? 1 : 0 }),
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    };
    const handle = (on: boolean) => (e: KeyboardEvent) => {
      const f = keys[e.code];
      if (!f || typing(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (on && sim.params.scenario !== 'manual') sim.setParams({ scenario: 'manual' });
      if (sim.params.scenario === 'manual') sim.setManual(f(on));
    };
    const down = handle(true);
    const up = handle(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [sim]);

  const chooseView = (v: WheelView) => {
    setView(v);
    setViewNonce((n) => n + 1);
    setSection(v === 'section');
  };

  const startBuild = () => {
    resumeAfterBuild.current = sim.running;
    sim.pause();
    setExploded(false);
    setOverlay(false);
    setShowTyre(true);
    if (view === 'section') chooseView('iso');
    clock.start();
  };
  const step = clock.active ? currentStep(clock.t) : null;

  const limit = sim.fatigueLimitMPa;
  const fos = s.peakMPa > 0 ? sim.material.yieldMPa / s.peakMPa : Infinity;
  const thetaDeg = (s.theta * 180) / Math.PI;
  const markerIdx = Math.round((thetaDeg / 360) * (sim.cycle.length - 1));
  const marker = sim.cycle[markerIdx] ? { x: sim.cycle[markerIdx].deg, y: sim.cycle[markerIdx].crit } : null;
  const phase = PHASE[s.phase];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alloy Wheel Digital Twin</h1>
          <div className="page-sub">
            Alloy Wheel · {p.spokeCount} Y-spokes · Ø{DRAWING.outerDia} × {DRAWING.rimWidth} from the reference drawing ·{' '}
            {fmt(sim.mass.massKg, 2)} kg {sim.material.short} · model: reduced-order load path (not FEA)
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
            <button className="btn primary" disabled={clock.active} onClick={() => sim.play()}>
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
            {fmt(sim.speedKmh, 1)} km/h · R<sub>e</sub> {fmt(s.effRadius * 1000, 0)} mm <Badge kind="model" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">▼ Wheel load Fz</div>
          <div className="k-value">
            {fmt(s.Fz / 1000, 2)}
            <small>kN</small>
          </div>
          <div className="k-sub">
            Fy {fmt(s.Fy / 1000, 2)} · Fx {fmt(s.Fx / 1000, 2)} kN <Badge kind="model" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">
            <span style={{ color: stressCss(s.peakMPa / limit) }}>●</span> Peak spoke stress
          </div>
          <div className="k-value">
            {fmt(s.peakMPa, 1)}
            <small>MPa</small>
          </div>
          <div className="k-sub">
            {spotLabel(s.peakSpot).toLowerCase()} · FoS {Number.isFinite(fos) ? fmt(fos, 1) : '—'} on yield <Badge kind="estimated" />
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">∿ Life at this condition</div>
          <div className="k-value">
            {fmtLife(sim.lifeKm)}
            <small>km</small>
          </div>
          <div className="k-sub">
            ±{fmt(s.eqAmpMPa, 0)} MPa/turn · damage {sci(s.damage)} <Badge kind="estimated" />
          </div>
        </Panel>
      </div>

      <div className="workspace">
        <WheelParametersPanel />

        <div className="viewport">
          <WheelScene
            sim={sim}
            clock={clock}
            view={view}
            viewNonce={viewNonce}
            overlay={overlay}
            section={section}
            exploded={exploded}
            showTyre={showTyre}
            showLoads={showLoads && !clock.active && !exploded}
          />
          {!clock.active && (
          <div className="vp-info">
            <div className="t">Front-left wheel on the road: fixed axle, rotating wheel and tyre</div>
            <div className="d">
              {p.spokeCount} Y-spokes · fork R{fmt(p.forkRadiusMm)} · legs {fmt(p.legSpreadMm)} apart · 5× Ø10 on a 72° pitch ·
              ET +58
              <br />
              Arrows = tyre forces at the contact patch (30 mm per kN)
            </div>
            <div className="w">Geometry from the drawing · stresses are a beam estimate, not FEA</div>
          </div>
          )}
          <div className="vp-readout">
            <div className="r">
              θ {thetaDeg.toFixed(1).padStart(5, ' ')}° · {fmt(sim.rpm, 0)} rpm · {fmt(s.Fz / 1000, 2)} kN
            </div>
            <span className={`state-chip ${phase.cls}`}>{phase.label}</span>
            {s.gripLimited && <span className="state-chip releasing">Grip limited</span>}
          </div>
          {step && (
            <div className="build-caption">
              <div className="k">
                Step {BUILD_STEPS.indexOf(step) + 1}/{BUILD_STEPS.length}
              </div>
              <div className="t">{step.title}</div>
              <div className="d">{step.ref}</div>
              <div className="bar">
                <span style={{ width: `${(clock.t / BUILD_DURATION) * 100}%` }} />
              </div>
            </div>
          )}
          {!sim.running && !clock.active && (
            <div className="vp-paused">{s.finished ? 'RUN COMPLETE' : s.t === 0 ? 'READY · PRESS PLAY' : 'PAUSED'}</div>
          )}
          {overlay && (
            <div className="vp-legend wheel-legend" title="Spoke stress from the beam estimate, scaled to the fatigue strength at 10⁷ cycles. Grey parts are not evaluated.">
              <span>0</span>
              <span className="bar" style={{ background: STRESS_GRADIENT, width: 120 }} />
              <span>
                {fmt(limit, 0)} MPa <small className="muted">σf @10⁷</small>
              </span>
            </div>
          )}
          <div className="vp-bottom">
            {(Object.keys(WHEEL_VIEWS) as WheelView[]).map((v) => (
              <button key={v} className={`vp-btn ${view === v ? 'active' : ''}`} onClick={() => chooseView(v)}>
                {WHEEL_VIEWS[v].label}
              </button>
            ))}
            <span style={{ width: 8 }} />
            <ToggleBtn on={overlay} set={setOverlay} label="Stress" />
            <ToggleBtn on={showLoads} set={setShowLoads} label="Loads" />
            <ToggleBtn on={showTyre} set={setShowTyre} label="Tyre" />
            <ToggleBtn on={section} set={setSection} label="Cut A-A" />
            <ToggleBtn on={exploded} set={setExploded} label="Explode" />
            <button className="vp-btn build" style={{ marginLeft: 'auto' }} onClick={clock.active ? () => clock.stop() : startBuild}>
              {clock.active ? '■ Skip build' : '▶ Build from drawing'}
            </button>
            <button className="vp-btn" onClick={() => setViewNonce((n) => n + 1)}>
              ↺ View
            </button>
          </div>
        </div>

        <WheelTelemetryPanel />
      </div>

      <div className="charts">
        <LineChart
          title="Vehicle speed"
          unit="km/h"
          color="#22d3ee"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.kmh}
          reference={(h) => h.targetKmh}
          seriesLabel="speed"
          referenceLabel="cruise"
          minYMax={60}
        />
        <LineChart
          title="Wheel load Fz"
          unit="kN"
          color="#38bdf8"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.FzkN}
          reference={(h) => h.Fz0kN}
          seriesLabel="Fz"
          referenceLabel="static"
          digits={2}
          minYMax={6}
        />
        <LineChart
          title="Peak spoke stress (est.)"
          unit="MPa"
          color="#f472b6"
          data={sim.history}
          version={sim.getVersion()}
          xMax={p.durationS}
          {...TIME_AXIS}
          y={(h) => h.peakMPa}
          reference={(h) => h.limitMPa}
          seriesLabel="peak"
          referenceLabel="fatigue strength @10⁷"
          digits={1}
          minYMax={60}
        />
        <LineChart
          title="Stress over one turn (spoke 1)"
          unit="MPa"
          color="#a78bfa"
          data={sim.cycle}
          version={`${sim.getVersion()}`}
          x={(c) => c.deg}
          y={(c) => c.crit}
          xMax={360}
          xStep={90}
          xTick={(v) => `${v}°`}
          xTip={(v) => `θ = ${v.toFixed(0)}° (180° = over the patch)`}
          reference={(c) => c.root}
          seriesLabel={spotLabel(s.critSpot).toLowerCase()}
          referenceLabel="arm root"
          digits={1}
          minYMax={20}
          marker={marker}
        />
      </div>
    </div>
  );
}

function ToggleBtn({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button className={`vp-btn ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => set(!on)}>
      {label}
    </button>
  );
}
