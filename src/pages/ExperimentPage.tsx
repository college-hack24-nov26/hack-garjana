import { useMemo, useState } from 'react';
import { navigate } from '../app/routes';
import { FocusViewer } from '../insights/focus/FocusViewer';
import { abFocus } from '../insights/focus/focusSpec';
import { ComponentSwitch } from '../shell/ComponentSwitch';
import { ABChart } from '../ui/ABChart';
import { Badge, Panel, SliderField, Tabs, fmt } from '../ui/primitives';
import { COMPONENT_LABEL } from '../workspace/designs';
import type { CaliperDesign, ComponentId, PlugDesign, Slot } from '../workspace/designs';
import { materialDiffs, parameterDiffs, pctChange } from '../workspace/metrics';
import {
  BRAKE_CONDITIONS_DEFAULT,
  PROTOCOLS,
  runBrakeFade,
  runBrakeStop,
  runCaliperPressureSweep,
  runPlugLoadSweep,
  runPlugSpeedSweep,
} from '../workspace/experiments';
import type { BrakeConditions, PlugConditions, Protocol, ProtocolId } from '../workspace/experiments';
import { useWorkspace } from '../workspace/useWorkspace';
import type { ExperimentRun, WorkspaceStore } from '../workspace/WorkspaceStore';
import { DeltaCell, fmtDateTime } from './shared';

type BrakeKey = keyof BrakeConditions;
const BRAKE_SPECS: { key: BrakeKey; label: string; unit?: string; min: number; max: number; step: number; digits: number; hint?: string; fadeOnly?: boolean }[] = [
  { key: 'speedKmh', label: 'Test speed', unit: 'km/h', min: 20, max: 200, step: 5, digits: 0 },
  { key: 'pressureMPa', label: 'Line pressure', unit: 'MPa', min: 1, max: 15, step: 0.5, digits: 1, hint: 'Held constant while braking.' },
  { key: 'padMu', label: 'Pad friction μ', min: 0.2, max: 0.6, step: 0.01, digits: 2 },
  { key: 'roadMu', label: 'Tyre–road μ', min: 0.2, max: 1.2, step: 0.05, digits: 2, hint: 'Caps the deceleration: past this the tyre, not the caliper, limits the stop.' },
  { key: 'quarterMassKg', label: 'Mass per wheel', unit: 'kg', min: 200, max: 800, step: 10, digits: 0 },
  { key: 'fadeDurationS', label: 'Test length', unit: 's', min: 30, max: 180, step: 5, digits: 0, fadeOnly: true },
];

/** Kept at module level so leaving the page and coming back doesn't reset the bench. */
let benchBrake: BrakeConditions = { ...BRAKE_CONDITIONS_DEFAULT };
let benchPlug: PlugConditions | null = null;
let benchProtocol: Record<ComponentId, ProtocolId> = { 'brake-caliper': 'brake-stop', 'spark-plug': 'plug-speed' };

const FEASIBLE_MEANS: Record<ComponentId, string> = {
  'brake-caliper': 'no FAIL in the Design Lab checks',
  'spark-plug': 'tip never above 850 °C in the sweep',
};

/**
 * Experiment: pick a test protocol, set its conditions, and run design A and
 * design B through it. Every run is recorded in the workspace so the other
 * pages (Dashboard, AI Insights) can use it.
 */
export function ExperimentPage() {
  const ws = useWorkspace();
  const c = ws.component;
  const [protocolId, setProtocolIdState] = useState<Record<ComponentId, ProtocolId>>(benchProtocol);
  const [brake, setBrakeState] = useState<BrakeConditions>(benchBrake);
  const [plug, setPlugState] = useState<PlugConditions>(
    () => benchPlug ?? { rpm: ws.plugInputs.rpm, loadPct: ws.plugInputs.loadPct },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewSrc, setViewSrc] = useState<'tested' | 'current'>('tested');

  const setProtocol = (id: ProtocolId) => {
    benchProtocol = { ...protocolId, [c]: id };
    setProtocolIdState(benchProtocol);
  };
  const setBrake = (patch: Partial<BrakeConditions>) => {
    benchBrake = { ...brake, ...patch };
    setBrakeState(benchBrake);
  };
  const setPlug = (patch: Partial<PlugConditions>) => {
    benchPlug = { ...plug, ...patch };
    setPlugState(benchPlug);
  };

  const protocol = PROTOCOLS.find((p) => p.id === protocolId[c])!;
  const runs = ws.runs.filter((r) => r.component === c);
  const shown = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  // The 3D view and the change table show the designs the selected run tested,
  // or the Design Lab's current designs when there's no run (or you ask for them).
  const current = currentDesigns(ws, c);
  const tested = shown?.designs ?? null;
  const testedDiffers = tested !== null && JSON.stringify(tested) !== JSON.stringify(current);
  const viewing = tested && (viewSrc === 'tested' || !testedDiffers) ? 'tested' : 'current';
  const designs = viewing === 'tested' && tested ? tested : current;

  const run = () => {
    const draft = runProtocol(ws, protocol.id, brake, plug);
    const saved = ws.addRun({ ...draft, designs: structuredClone(current) });
    setSelectedId(saved.id);
    setViewSrc('tested');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Experiment</h1>
          <div className="page-sub">
            {COMPONENT_LABEL[c]} · design A and design B through exactly the same test
          </div>
        </div>
        <div className="page-actions">
          <ComponentSwitch value={c} onChange={(v) => ws.setComponent(v)} />
          <button className="btn" onClick={() => navigate({ section: 'design-lab' })}>
            ○ Edit designs
          </button>
          <button className="btn" onClick={() => navigate({ section: 'digital-twin', module: c })}>
            ◉ Open twin
          </button>
        </div>
      </div>

      <div className="xp-grid">
        <div className="xp-side">
          <Panel title="1 · Test protocol">
            <div className="protocols" role="radiogroup" aria-label="Test protocol">
              {PROTOCOLS.filter((p) => p.component === c).map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={p.id === protocol.id}
                  className={`protocol ${p.id === protocol.id ? 'active' : ''}`}
                  onClick={() => setProtocol(p.id)}
                >
                  <span className="protocol-top">
                    <span className="protocol-name">{p.name}</span>
                    <Badge kind={p.source} />
                  </span>
                  <span className="protocol-what">{p.what}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="2 · Test conditions"
            right={<ConditionsReset protocol={protocol} ws={ws} onBrake={setBrake} onPlug={setPlug} />}
          >
            <Conditions protocol={protocol} ws={ws} brake={brake} plug={plug} onBrake={setBrake} onPlug={setPlug} />
          </Panel>

          <Panel title="3 · Run">
            <div className="xp-under-test">
              <span className="ab-pill a">A · {c === 'brake-caliper' ? ws.caliper.A.revision : ws.plug.A.revision}</span>
              <span className="ab-pill b">B · {c === 'brake-caliper' ? ws.caliper.B.revision : ws.plug.B.revision}</span>
            </div>
            <button className="btn primary xp-run" onClick={run}>
              ▶ Run A and B
            </button>
            <div className="hint" style={{ marginTop: 8 }}>
              {protocol.source === 'model'
                ? 'Runs the same simplified brake dynamics as the Digital Twin, headless. Of the design settings, only piston bore and piston count affect this test; bridge, walls and ribs do not change how the car stops (see the structural sweep for those).'
                : 'Uses the Design Lab reduced-order estimators. Trend indicator, not a solver result.'}
            </div>
          </Panel>
        </div>

        <div className="xp-main">
          <ChangesPanel
            ws={ws}
            component={c}
            designs={designs}
            viewing={viewing}
            testedDiffers={testedDiffers}
            legacyRun={shown !== null && !shown.designs}
            onViewSrc={setViewSrc}
          />
          {shown ? (
            <RunResult run={shown} isLatest={shown === runs[0]} />
          ) : (
            <Panel title="Result">
              <div className="xp-empty">
                No {COMPONENT_LABEL[c].toLowerCase()} runs yet. Pick a protocol, set the conditions and press{' '}
                <b>Run A and B</b>.
              </div>
            </Panel>
          )}
          <RunHistory ws={ws} runs={runs} selectedId={shown?.id ?? null} onSelect={setSelectedId} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function runProtocol(ws: WorkspaceStore, id: ProtocolId, brake: BrakeConditions, plug: PlugConditions) {
  switch (id) {
    case 'brake-stop':
      return runBrakeStop(ws.caliper, brake, ws.caliperInputs);
    case 'brake-fade':
      return runBrakeFade(ws.caliper, brake, ws.caliperInputs);
    case 'caliper-pressure':
      return runCaliperPressureSweep(ws.caliper, ws.caliperInputs);
    case 'plug-speed':
      return runPlugSpeedSweep(ws.plug, ws.plugInputs, plug);
    case 'plug-load':
      return runPlugLoadSweep(ws.plug, ws.plugInputs, plug);
  }
}

function ConditionsReset({
  protocol,
  ws,
  onBrake,
  onPlug,
}: {
  protocol: Protocol;
  ws: WorkspaceStore;
  onBrake: (p: Partial<BrakeConditions>) => void;
  onPlug: (p: Partial<PlugConditions>) => void;
}) {
  if (protocol.id === 'caliper-pressure') return null;
  const reset = () =>
    protocol.component === 'brake-caliper'
      ? onBrake({ ...BRAKE_CONDITIONS_DEFAULT })
      : onPlug({ rpm: ws.plugInputs.rpm, loadPct: ws.plugInputs.loadPct });
  return (
    <button className="btn sm" onClick={reset}>
      Reset
    </button>
  );
}

function Conditions({
  protocol,
  ws,
  brake,
  plug,
  onBrake,
  onPlug,
}: {
  protocol: Protocol;
  ws: WorkspaceStore;
  brake: BrakeConditions;
  plug: PlugConditions;
  onBrake: (p: Partial<BrakeConditions>) => void;
  onPlug: (p: Partial<PlugConditions>) => void;
}) {
  if (protocol.id === 'caliper-pressure') {
    const i = ws.caliperInputs;
    return (
      <div className="hint">
        Sweeps line pressure from 2 to 18 MPa. The limits come from the Design Lab load case: allowable stress{' '}
        <b>{fmt(i.allowableStressMPa)} MPa</b>, allowable mouth opening <b>{fmt(i.allowableMouthMm, 2)} mm</b>.{' '}
        <button className="link-btn" onClick={() => navigate({ section: 'design-lab' })}>
          Change them
        </button>
      </div>
    );
  }
  if (protocol.component === 'brake-caliper') {
    return (
      <>
        {BRAKE_SPECS.filter((s) => !s.fadeOnly || protocol.id === 'brake-fade').map((s) => (
          <SliderField
            key={s.key}
            label={s.label}
            hint={s.hint}
            value={brake[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            digits={s.digits}
            unit={s.unit}
            badge={<Badge kind="input" />}
            onChange={(v) => onBrake({ [s.key]: v })}
          />
        ))}
      </>
    );
  }
  // Spark plug: the speed sweep holds load fixed, the load sweep holds speed fixed.
  return (
    <>
      {protocol.id === 'plug-speed' ? (
        <SliderField
          label="Engine load (held)"
          hint="Speed is swept 800–7000 rpm."
          value={plug.loadPct}
          min={10}
          max={100}
          step={5}
          unit="%"
          badge={<Badge kind="input" />}
          onChange={(v) => onPlug({ loadPct: v })}
        />
      ) : (
        <SliderField
          label="Engine speed (held)"
          hint="Load is swept 10–100 %."
          value={plug.rpm}
          min={800}
          max={7000}
          step={50}
          unit="rpm"
          badge={<Badge kind="input" />}
          onChange={(v) => onPlug({ rpm: v })}
        />
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        Gas {fmt(ws.plugInputs.gasTempC)} °C and seat {fmt(ws.plugInputs.seatTempC)} °C come from the Design Lab{' '}
        <Badge kind="demo" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

type DesignPair = Record<Slot, CaliperDesign> | Record<Slot, PlugDesign>;

function currentDesigns(ws: WorkspaceStore, c: ComponentId): DesignPair {
  return c === 'brake-caliper' ? ws.caliper : ws.plug;
}

/** Parameter and material differences between a given A/B pair. */
function diffsFor(ws: WorkspaceStore, c: ComponentId, designs: DesignPair) {
  const src = {
    component: c,
    caliper: c === 'brake-caliper' ? (designs as Record<Slot, CaliperDesign>) : ws.caliper,
    plug: c === 'spark-plug' ? (designs as Record<Slot, PlugDesign>) : ws.plug,
    caliperInputs: ws.caliperInputs,
    plugInputs: ws.plugInputs,
  };
  const allParams = parameterDiffs(src, c);
  const allMats = materialDiffs(src, c);
  const params = allParams.filter((r) => Math.abs(r.B - r.A) > 1e-9);
  const mats = allMats.filter((m) => m.A !== m.B);
  return { params, mats, unchanged: allParams.length + allMats.length - params.length - mats.length };
}

/**
 * What differs between A and B: the 3D comparison (where on the part) and a
 * table of the changed parameters (what, and by how much).
 */
function ChangesPanel({
  ws,
  component,
  designs,
  viewing,
  testedDiffers,
  legacyRun,
  onViewSrc,
}: {
  ws: WorkspaceStore;
  component: ComponentId;
  designs: DesignPair;
  viewing: 'tested' | 'current';
  testedDiffers: boolean;
  legacyRun: boolean;
  onViewSrc: (v: 'tested' | 'current') => void;
}) {
  const d = diffsFor(ws, component, designs);
  const n = d.params.length + d.mats.length;
  const right = testedDiffers ? (
    <Tabs
      value={viewing}
      onChange={onViewSrc}
      options={[
        { id: 'tested', label: 'As tested' },
        { id: 'current', label: 'Design Lab now' },
      ]}
    />
  ) : (
    <span className="hint">{viewing === 'tested' ? 'as tested in the selected run' : 'current Design Lab designs'}</span>
  );
  return (
    <Panel className="xp-changes" title={`What changed, A → B · ${n} ${n === 1 ? 'difference' : 'differences'}`} right={right}>
      {testedDiffers && viewing === 'tested' && (
        <div className="note amber xp-stale">
          The Design Lab has changed since this run. You&apos;re seeing the designs as they were tested; run again to
          test the current ones.
        </div>
      )}
      {legacyRun && (
        <div className="hint xp-stale">
          This run was saved before designs were recorded with it, so the current designs are shown.
        </div>
      )}
      <div className="xp-viewer">
        <ViewerSlot ws={ws} component={component} designs={designs} />
      </div>
      {n === 0 ? (
        <div className="hint" style={{ marginTop: 10 }}>
          A and B are identical, so every test will give the same result for both. Change design B in the{' '}
          <button className="link-btn" onClick={() => navigate({ section: 'design-lab' })}>
            Design Lab
          </button>
          .
        </div>
      ) : (
        <table className="data-table plain xp-diff">
          <thead>
            <tr>
              <th>Changed</th>
              <th className="r a">A · {designs.A.revision}</th>
              <th className="r b">B · {designs.B.revision}</th>
              <th className="r">B − A</th>
            </tr>
          </thead>
          <tbody>
            {d.mats.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td colSpan={3} className="mat-diff">
                  <span className="a-txt">{m.A}</span> → <span className="b-txt">{m.B}</span>
                </td>
              </tr>
            ))}
            {d.params.map((r) => {
              const p = pctChange(r.A, r.B);
              return (
                <tr key={r.label}>
                  <td>
                    {r.label}
                    {r.unit !== '–' && <span className="muted"> ({r.unit})</span>}
                  </td>
                  <td className="r">{fmt(r.A, r.digits)}</td>
                  <td className="r">{fmt(r.B, r.digits)}</td>
                  <td className="r delta neutral">
                    {r.B > r.A ? '+' : ''}
                    {fmt(r.B - r.A, r.digits)}
                    {p !== null && (
                      <small>
                        {' '}
                        ({p > 0 ? '+' : ''}
                        {fmt(p, 0)}%)
                      </small>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {n > 0 && d.unchanged > 0 && (
        <div className="hint" style={{ marginTop: 6 }}>
          {d.unchanged} other {d.unchanged === 1 ? 'setting is' : 'settings are'} the same in A and B.
        </div>
      )}
    </Panel>
  );
}

/**
 * The shared A/B 3D view (also used by AI Insights): the model morphs from A to
 * B with every changed part lit up and labelled. The spec is keyed on the
 * designs' contents so the morph doesn't restart on every re-render.
 */
function ViewerSlot({ ws, component, designs }: { ws: WorkspaceStore; component: ComponentId; designs: DesignPair }) {
  const key = JSON.stringify(designs);
  const spec = useMemo(() => abFocus(ws, component, designs), [ws, component, key]);
  return <FocusViewer spec={spec} src={ws} />;
}

function RunResult({ run, isLatest }: { run: ExperimentRun; isLatest: boolean }) {
  return (
    <Panel
      className="xp-result"
      title={
        <span>
          {run.title} {!isLatest && <span className="chip">earlier run</span>}
        </span>
      }
      right={<Badge kind={run.source} />}
    >
      <div className="xp-meta">
        <span>{fmtDateTime(run.createdAt)}</span>
        <span>{run.conditions}</span>
      </div>

      <table className="data-table plain xp-metrics">
        <thead>
          <tr>
            <th>Result</th>
            <th className="r a">A · {run.revisions.A}</th>
            <th className="r b">B · {run.revisions.B}</th>
            <th className="r">B − A</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {run.metrics.map((m) => (
            <tr key={m.key}>
              <td>
                {m.label}
                {m.lowerIsBetter !== null && <span className="muted"> ({m.lowerIsBetter ? 'lower' : 'higher'} is better)</span>}
              </td>
              <td className="r">{fmt(m.A, m.digits)}</td>
              <td className="r">{fmt(m.B, m.digits)}</td>
              <DeltaCell a={m.A} b={m.B} digits={m.digits} lowerIsBetter={m.lowerIsBetter} percent />
              <td className="muted">{m.unit}</td>
            </tr>
          ))}
          <tr>
            <td>
              Feasible <span className="muted">({FEASIBLE_MEANS[run.component]})</span>
            </td>
            <td className={`r ${run.feasible.A ? 'ok' : 'bad'}`}>{run.feasible.A ? '✓ yes' : '✕ no'}</td>
            <td className={`r ${run.feasible.B ? 'ok' : 'bad'}`}>{run.feasible.B ? '✓ yes' : '✕ no'}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      <div className="xp-charts">
        {run.series.map((s) => (
          <ABChart
            key={s.title}
            title={s.title}
            unit={s.yUnit}
            points={s.points}
            labels={run.revisions}
            xLabel={s.xLabel}
            band={s.band}
            xFormat={(v) => (Math.abs(v) >= 100 ? fmt(v) : `${+v.toFixed(1)}`)}
            zeroBased={s.yUnit === 'km/h'}
          />
        ))}
      </div>
    </Panel>
  );
}

function RunHistory({
  ws,
  runs,
  selectedId,
  onSelect,
}: {
  ws: WorkspaceStore;
  runs: ExperimentRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const right =
    ws.runs.length > 0 ? (
      <button
        className="btn sm"
        onClick={() => {
          if (window.confirm(`Delete all ${ws.runs.length} experiment runs (both components)?`)) ws.clearRuns();
        }}
      >
        Clear all
      </button>
    ) : undefined;
  return (
    <Panel title={`Run history · ${runs.length}`} right={right}>
      {runs.length === 0 ? (
        <div className="hint">Runs you make for this component are listed here, newest first.</div>
      ) : (
        <ul className="xp-history">
          {runs.map((r) => (
            <li key={r.id} className={r.id === selectedId ? 'active' : ''}>
              <button className="xp-h-main" onClick={() => onSelect(r.id)}>
                <span className="xp-h-title">{r.title}</span>
                <span className="xp-h-sub">
                  {fmtDateTime(r.createdAt)} · {r.revisions.A} vs {r.revisions.B}
                </span>
              </button>
              <Badge kind={r.source} />
              <button className="btn sm" aria-label={`Delete run: ${r.title}`} title="Delete this run" onClick={() => ws.removeRun(r.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
