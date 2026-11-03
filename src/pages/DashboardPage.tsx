import { SECTIONS, navigate } from '../app/routes';
import type { SectionId } from '../app/routes';
import { Badge, Panel, fmt } from '../ui/primitives';
import { estimatesFor } from '../workspace/metrics';
import { VERDICT_LABEL } from '../workspace/validation';
import type { Verdict } from '../workspace/validation';
import { useWorkspace } from '../workspace/useWorkspace';
import { fmtDateTime } from './shared';

const FLOW: { id: SectionId; what: string }[] = [
  { id: 'design-lab', what: 'Edit design A and candidate B' },
  { id: 'experiment', what: 'Run both through the same test' },
  { id: 'digital-twin', what: 'Watch the part work, live' },
  { id: 'analytics', what: 'Sweeps and sensitivities' },
  { id: 'compare', what: 'A vs B, side by side' },
  { id: 'ai-insights', what: 'Rule-based findings' },
  { id: 'reports', what: 'Export the evidence' },
];

const MATURITY: { what: string; status: string; kind: 'ok' | 'partial' | 'none' }[] = [
  { what: 'Geometry', status: 'Parametric, generated in code from the design inputs', kind: 'ok' },
  { what: 'Motion and dynamics', status: 'Simplified illustrative models (slider-crank, lumped brake)', kind: 'partial' },
  { what: 'Stress, opening, tip temperature', status: 'Reduced-order hand-calculation estimates', kind: 'partial' },
  { what: 'Finite-element solver', status: 'Not connected in this build', kind: 'none' },
  { what: 'Physical test data', status: 'None: nothing here is validated against measurements', kind: 'none' },
];

const sectionLabel = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.label ?? id;

export function DashboardPage() {
  const ws = useWorkspace();
  const cal = estimatesFor(ws, 'brake-caliper');
  const plug = estimatesFor(ws, 'spark-plug');
  const verdicts = [cal.verdict.A, cal.verdict.B, plug.verdict.A, plug.verdict.B];
  const passing = verdicts.filter((v) => v === 'pass').length;
  const reviewing = verdicts.filter((v) => v === 'review').length;
  const massDelta = cal.caliper ? cal.caliper.B.massKg - cal.caliper.A.massKg : 0;
  const lastRun = ws.runs[0];

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-eyebrow">AutoTwin · Virtual prototyping workspace</div>
        <h1 className="hero-title">Design, test and compare automotive components before you cut metal.</h1>
        <div className="hero-sub">
          Edit a candidate next to its baseline, put both through the same test, watch the part work in a live 3D
          twin, and keep every number labelled with where it came from.
        </div>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => navigate({ section: 'design-lab' })}>
            ○ Open Design Lab
          </button>
          <button className="btn" onClick={() => navigate({ section: 'digital-twin', module: 'brake-caliper' })}>
            ◉ Brake caliper twin
          </button>
          <button className="btn" onClick={() => navigate({ section: 'digital-twin', module: 'spark-plug' })}>
            ◉ Spark plug twin
          </button>
          <button className="btn" onClick={() => navigate({ section: 'digital-twin', module: 'alloy-wheel' })}>
            ◉ Alloy wheel twin
          </button>
        </div>
      </section>

      <div className="kpis">
        <Panel bodyClass="kpi">
          <div className="k-label">Designs in workspace</div>
          <div className="k-value">4</div>
          <div className="k-sub">2 components × baseline A + candidate B</div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">Designs passing every check</div>
          <div className="k-value">
            {passing}
            <small>/ 4</small>
          </div>
          <div className="k-sub">
            <Badge kind="estimated" /> {reviewing} need review · not FEA
          </div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">Experiment runs</div>
          <div className="k-value">{ws.runs.length}</div>
          <div className="k-sub">{lastRun ? `last: ${fmtDateTime(lastRun.createdAt)}` : 'none yet'}</div>
        </Panel>
        <Panel bodyClass="kpi">
          <div className="k-label">Caliper B vs A mass</div>
          <div className="k-value">
            {massDelta > 0 ? '+' : ''}
            {fmt(massDelta, 3)}
            <small>kg</small>
          </div>
          <div className="k-sub">
            <Badge kind="estimated" /> {cal.revisions.B} vs {cal.revisions.A}
          </div>
        </Panel>
      </div>

      <div className="section-label">Components</div>
      <div className="tile-grid">
        <ComponentTile
          name="Brake Caliper"
          analysis="Structural · brake dynamics"
          desc="Trim bridge, wall and rib sections without letting the caliper mouth open past its limit under the clamp load."
          revisions={cal.revisions}
          verdict={cal.verdict}
          headline={
            cal.caliper
              ? `Peak stress A ${fmt(cal.caliper.A.peakStressMPa, 1)} → B ${fmt(cal.caliper.B.peakStressMPa, 1)} MPa`
              : ''
          }
          onDesign={() => {
            ws.setComponent('brake-caliper');
            navigate({ section: 'design-lab' });
          }}
          onTwin={() => navigate({ section: 'digital-twin', module: 'brake-caliper' })}
        />
        <ComponentTile
          name="Spark Plug"
          analysis="Thermal · engine kinematics"
          desc="Tune insulator nose and electrode so the firing end stays inside its 450–850 °C heat-range window."
          revisions={plug.revisions}
          verdict={plug.verdict}
          headline={
            plug.plug
              ? `Tip A ${fmt(plug.plug.A.tipTempC)} → B ${fmt(plug.plug.B.tipTempC)} °C at ${fmt(ws.plugInputs.rpm)} rpm`
              : ''
          }
          onDesign={() => {
            ws.setComponent('spark-plug');
            navigate({ section: 'design-lab' });
          }}
          onTwin={() => navigate({ section: 'digital-twin', module: 'spark-plug' })}
        />
        <div className="tile">
          <div className="tile-top">
            <div className="tile-name">Alloy Wheel</div>
            <span className="chip">Structural · rolling road load</span>
          </div>
          <div className="tile-desc">
            The Y-spoke wheel from the reference drawing, rolling through turns and stops with live spoke stresses and a
            per-turn fatigue cycle.
          </div>
          <div className="tile-headline">
            <Badge kind="drawing" /> Ø520 × 256 · 5 Y-spokes · 5× Ø10 on 72°
          </div>
          <div className="tile-headline">
            <Badge kind="estimated" /> Twin only: Design Lab and Experiment don&apos;t model the wheel yet
          </div>
          <div className="tile-actions">
            <button className="btn sm primary" onClick={() => navigate({ section: 'digital-twin', module: 'alloy-wheel' })}>
              ◉ Digital Twin
            </button>
          </div>
        </div>
      </div>

      <div className="section-label">How the workspace fits together</div>
      <div className="flow">
        {FLOW.map((f, i) => (
          <button key={f.id} className="flow-step" onClick={() => navigate({ section: f.id })}>
            <span className="flow-dot">{String(i + 1).padStart(2, '0')}</span>
            <span className="flow-label">{sectionLabel(f.id)}</span>
            <span className="flow-what">{f.what}</span>
          </button>
        ))}
      </div>

      <div className="dash-bottom">
        <Panel title="Recent activity">
          {ws.activity.length === 0 ? (
            <div className="hint">
              Nothing yet. Changes you make in the Design Lab and runs from the Experiment page show up here.
            </div>
          ) : (
            <ul className="activity">
              {ws.activity.slice(0, 8).map((a, i) => (
                <li key={i}>
                  <span className="t">{fmtDateTime(a.t)}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="What's real in this build">
          <table className="data-table">
            <tbody>
              {MATURITY.map((m) => (
                <tr key={m.what}>
                  <td>
                    <span className={`dot ${m.kind}`} />
                    {m.what}
                  </td>
                  <td className="muted">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 8 }}>
            AutoTwin here is a virtual-prototyping demonstrator. Its numbers are not a certification and not a
            substitute for physical validation.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ComponentTile(props: {
  name: string;
  analysis: string;
  desc: string;
  revisions: { A: string; B: string };
  verdict: { A: Verdict; B: Verdict };
  headline: string;
  onDesign: () => void;
  onTwin: () => void;
}) {
  return (
    <div className="tile">
      <div className="tile-top">
        <div className="tile-name">{props.name}</div>
        <span className="chip">{props.analysis}</span>
      </div>
      <div className="tile-desc">{props.desc}</div>
      <div className="tile-ab">
        <span className={`ab-pill a ${props.verdict.A}`}>
          A · {props.revisions.A} · {VERDICT_LABEL[props.verdict.A]}
        </span>
        <span className={`ab-pill b ${props.verdict.B}`}>
          B · {props.revisions.B} · {VERDICT_LABEL[props.verdict.B]}
        </span>
      </div>
      <div className="tile-headline">
        <Badge kind="estimated" /> {props.headline}
      </div>
      <div className="tile-actions">
        <button className="btn sm primary" onClick={props.onDesign}>
          ○ Design Lab
        </button>
        <button className="btn sm" onClick={props.onTwin}>
          ◉ Digital Twin
        </button>
      </div>
    </div>
  );
}
