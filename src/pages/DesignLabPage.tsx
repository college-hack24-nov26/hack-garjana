import { navigate } from '../app/routes';
import { ModuleSwitch } from '../shell/ModuleSwitch';
import type { ModuleId } from '../shell/ModuleSwitch';
import { WheelDesignLab } from '../modules/alloyWheel/lab/WheelDesignLab';
import { useWheelLab } from '../modules/alloyWheel/lab/WheelLabStore';
import { Badge, Panel, SliderField, fmt } from '../ui/primitives';
import {
  CALIPER_INPUT_SPECS,
  CALIPER_MATERIALS,
  CALIPER_PARAMS,
  COMPONENT_LABEL,
  ELECTRODE_MATERIALS,
  INSULATOR_MATERIALS,
  PLUG_INPUT_SPECS,
  PLUG_PARAMS,
  TIP_WINDOW_C,
} from '../workspace/designs';
import type { ComponentId, Slot } from '../workspace/designs';
import { estimatesFor, materialDiffs, parameterDiffs } from '../workspace/metrics';
import type { DesignEstimates } from '../workspace/metrics';
import { useWorkspace } from '../workspace/useWorkspace';
import type { WorkspaceStore } from '../workspace/WorkspaceStore';
import type { Verdict } from '../workspace/validation';
import { ChecksList, DeltaCell } from './shared';
import { LabAB3D } from './LabAB3D';

const VERDICT_SHORT: Record<Verdict, string> = { pass: 'pass', review: 'review', fail: 'fail' };

const ANALYSIS: Record<ComponentId, string> = {
  'brake-caliper': 'linear static structural · fidelity: reduced-order beam estimate (no solver)',
  'spark-plug': 'steady-state thermal · fidelity: reduced-order fin estimate (no solver)',
};

/**
 * Design Lab: design A (the reference) next to design B (the candidate),
 * with instant reduced-order estimates for both and a table of what differs.
 */
export function DesignLabPage() {
  const ws = useWorkspace();
  const wheelLab = useWheelLab();
  const c = ws.component;

  // The alloy wheel has its own A/B store (src/modules/alloyWheel/lab); the caliper and
  // plug keep using the workspace. The switch here offers all three.
  const pick = (m: ModuleId) => {
    if (m === 'alloy-wheel') return wheelLab.setActive(true);
    wheelLab.setActive(false);
    ws.setComponent(m);
  };
  const moduleSwitch = <ModuleSwitch value={wheelLab.active ? 'alloy-wheel' : c} onChange={pick} />;
  if (wheelLab.active) return <WheelDesignLab moduleSwitch={moduleSwitch} />;

  const est = estimatesFor(ws);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Design Lab</h1>
          <div className="page-sub">
            {COMPONENT_LABEL[c]} · {ANALYSIS[c]}
          </div>
        </div>
        <div className="page-actions">
          {moduleSwitch}
          <button className="btn" onClick={() => navigate({ section: 'digital-twin', module: c })}>
            ◉ Open twin
          </button>
          <button className="btn primary" onClick={() => navigate({ section: 'experiment' })}>
            ◷ Test in Experiment →
          </button>
        </div>
      </div>

      <LabAB3D />

      <div className="lab-grid">
        <DesignPanel ws={ws} slot="A" />
        <DesignPanel ws={ws} slot="B" />
        <div className="lab-side">
          <PreviewPanel est={est} />
          <EstimateNote component={c} />
          <Panel title="Checks" right={<Badge kind="estimated" />}>
            <div className="checks-ab">
              <ChecksList title={`A · ${est.revisions.A}`} results={est.validation.A.results} />
              <ChecksList title={`B · ${est.revisions.B}`} results={est.validation.B.results} />
            </div>
          </Panel>
          <DiffPanel ws={ws} />
          <InputsPanel ws={ws} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DesignPanel({ ws, slot }: { ws: WorkspaceStore; slot: Slot }) {
  const c = ws.component;
  const title = slot === 'A' ? 'Design A · Baseline (reference)' : 'Design B · Candidate (under test)';
  const actions = (
    <div className="panel-actions">
      {slot === 'B' && (
        <button className="btn sm" onClick={() => ws.copyAToB(c)} title="Copy design A's geometry and material into B">
          ← Copy A
        </button>
      )}
      <button className="btn sm" onClick={() => ws.resetSlot(c, slot)}>
        Reset
      </button>
    </div>
  );
  return (
    <Panel className={`design-panel slot-${slot.toLowerCase()}`} title={<span className="slot-title">{title}</span>} right={actions}>
      {c === 'brake-caliper' ? <CaliperFields ws={ws} slot={slot} /> : <PlugFields ws={ws} slot={slot} />}
    </Panel>
  );
}

function RevisionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="stack-field">
      <span>Revision</span>
      <input className="text" value={value} maxLength={40} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function MaterialField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="stack-field">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CaliperFields({ ws, slot }: { ws: WorkspaceStore; slot: Slot }) {
  const d = ws.caliper[slot];
  const mat = CALIPER_MATERIALS.find((m) => m.id === d.materialId) ?? CALIPER_MATERIALS[0];
  return (
    <>
      <RevisionField value={d.revision} onChange={(revision) => ws.setCaliper(slot, { revision })} />
      <MaterialField
        label="Material"
        value={d.materialId}
        options={CALIPER_MATERIALS}
        onChange={(materialId) => ws.setCaliper(slot, { materialId })}
      />
      <div className="mat-props">
        ρ {fmt(mat.densityKgM3)} kg/m³ · E {fmt(mat.eMPa / 1000, 1)} GPa · yield {fmt(mat.yieldMPa)} MPa
      </div>
      {CALIPER_PARAMS.map((p) => (
        <SliderField
          key={p.key}
          label={p.label}
          hint={p.hint}
          value={d[p.key]}
          min={p.min}
          max={p.max}
          step={p.step}
          digits={p.digits}
          unit={p.unit === '–' ? undefined : p.unit}
          onChange={(v) => ws.setCaliper(slot, { [p.key]: v })}
        />
      ))}
    </>
  );
}

function PlugFields({ ws, slot }: { ws: WorkspaceStore; slot: Slot }) {
  const d = ws.plug[slot];
  return (
    <>
      <RevisionField value={d.revision} onChange={(revision) => ws.setPlug(slot, { revision })} />
      <MaterialField
        label="Insulator"
        value={d.insulatorId}
        options={INSULATOR_MATERIALS}
        onChange={(insulatorId) => ws.setPlug(slot, { insulatorId })}
      />
      <MaterialField
        label="Centre electrode"
        value={d.electrodeId}
        options={ELECTRODE_MATERIALS}
        onChange={(electrodeId) => ws.setPlug(slot, { electrodeId })}
      />
      {PLUG_PARAMS.map((p) => (
        <SliderField
          key={p.key}
          label={p.label}
          hint={p.hint}
          value={d[p.key]}
          min={p.min}
          max={p.max}
          step={p.step}
          digits={p.digits}
          unit={p.unit}
          onChange={(v) => ws.setPlug(slot, { [p.key]: v })}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

function PreviewPanel({ est }: { est: DesignEstimates }) {
  return (
    <Panel title="Steady-state preview" right={<Badge kind="estimated" />}>
      <div className="ab-head">
        <span />
        <span className="a">A</span>
        <span className="b">B</span>
      </div>
      {est.rows.map((r) => (
        <div className="ab-row" key={r.key}>
          <span className="l">{r.label}</span>
          <span className="v a">{fmt(r.A, r.digits)}</span>
          <span className="v b">{fmt(r.B, r.digits)}</span>
          <span className="u">{r.unit}</span>
        </div>
      ))}
      <div className="ab-row verdict">
        <span className="l">
          Verdict (all checks){' '}
          <button className="link-btn" onClick={() => navigate({ section: 'ai-insights' })}>
            why?
          </button>
        </span>
        <span className={`v a ${est.verdict.A}`}>{VERDICT_SHORT[est.verdict.A]}</span>
        <span className={`v b ${est.verdict.B}`}>{VERDICT_SHORT[est.verdict.B]}</span>
        <span className="u" />
      </div>
      {est.component === 'spark-plug' && (
        <div className="hint" style={{ marginTop: 8 }}>
          Target window: {TIP_WINDOW_C.min}–{TIP_WINDOW_C.max} °C (self-cleaning to pre-ignition).
        </div>
      )}
    </Panel>
  );
}

function EstimateNote({ component }: { component: ComponentId }) {
  return (
    <div className="note amber">
      <b>How far can these numbers be trusted?</b>
      <div style={{ marginTop: 4 }}>
        {component === 'brake-caliper' ? (
          <>
            Hand-calculation beam estimate, not a finite-element result, and not checked against a solver in this
            build. The legs are taken as rigid, so mouth opening reads low; a beam can&apos;t see the stress
            concentrations at the piston bores and mounting holes, so peak stress reads low too. Use the direction of
            change between A and B, not the absolute values.
          </>
        ) : (
          <>
            Fin model: the insulator nose and electrode carry heat to the shell seat while the gas heats their surface.
            Radiation, contact resistance and the ground electrode are ignored, and the gas-side inputs are demo
            fixtures. Read it as a trend: a longer nose runs hotter, a copper-cored electrode runs cooler.
          </>
        )}
      </div>
    </div>
  );
}

function DiffPanel({ ws }: { ws: WorkspaceStore }) {
  const rows = parameterDiffs(ws);
  const mats = materialDiffs(ws);
  const changed = rows.filter((r) => Math.abs(r.B - r.A) > 1e-9).length + mats.filter((m) => m.A !== m.B).length;
  return (
    <Panel title="Parameter differences" right={<span className="hint">{changed} changed</span>}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th className="r a">A</th>
            <th className="r b">B</th>
            <th className="r">Δ</th>
          </tr>
        </thead>
        <tbody>
          {mats.map((m) => (
            <tr key={m.label} className={m.A !== m.B ? 'changed' : ''}>
              <td>{m.label}</td>
              <td colSpan={3} className="mat-diff">
                {m.A === m.B ? (
                  <span className="muted">same: {m.A}</span>
                ) : (
                  <>
                    <span className="a-txt">{m.A}</span> → <span className="b-txt">{m.B}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
          {rows.map((r) => (
            <tr key={r.label} className={Math.abs(r.B - r.A) > 1e-9 ? 'changed' : ''}>
              <td>
                {r.label}
                {r.unit !== '–' && <span className="muted"> ({r.unit})</span>}
              </td>
              <td className="r">{fmt(r.A, r.digits)}</td>
              <td className="r">{fmt(r.B, r.digits)}</td>
              <DeltaCell a={r.A} b={r.B} digits={r.digits} />
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function InputsPanel({ ws }: { ws: WorkspaceStore }) {
  const c = ws.component;
  const right = (
    <button className="btn sm" onClick={() => ws.resetInputs(c)}>
      Reset
    </button>
  );
  return (
    <Panel title="Load case & limits" right={right}>
      <div className="hint" style={{ marginBottom: 4 }}>
        Both designs are checked against these. The defaults are demo fixtures: replace them with your real
        requirements.
      </div>
      {c === 'brake-caliper'
        ? CALIPER_INPUT_SPECS.map((p) => (
            <SliderField
              key={p.key}
              label={p.label}
              hint={p.hint}
              value={ws.caliperInputs[p.key]}
              min={p.min}
              max={p.max}
              step={p.step}
              digits={p.digits}
              unit={p.unit}
              badge={<Badge kind="demo" />}
              onChange={(v) => ws.setCaliperInputs({ [p.key]: v })}
            />
          ))
        : PLUG_INPUT_SPECS.map((p) => (
            <SliderField
              key={p.key}
              label={p.label}
              hint={p.hint}
              value={ws.plugInputs[p.key]}
              min={p.min}
              max={p.max}
              step={p.step}
              digits={p.digits}
              unit={p.unit}
              badge={<Badge kind="demo" />}
              onChange={(v) => ws.setPlugInputs({ [p.key]: v })}
            />
          ))}
    </Panel>
  );
}
