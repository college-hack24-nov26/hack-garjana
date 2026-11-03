import type { ReactNode } from 'react';
import { navigate } from '../../../app/routes';
import { Badge, Panel, SliderField, fmt } from '../../../ui/primitives';
import { ChecksList, DeltaCell } from '../../../pages/shared';
import { DESIGN_SPECS, FIXED, wheelLayout } from '../wheel/drawing';
import type { Pt, WheelDesign } from '../wheel/drawing';
import { WHEEL_MATERIALS, findWheelMaterial } from '../wheel/materials';
import type { WheelMaterialId } from '../wheel/materials';
import { spotLabel } from '../sim/loads';
import { provenanceBadge } from '../components/WheelParametersPanel';
import { fmtCycles, fmtLife } from '../components/WheelTelemetryPanel';
import { getWheelTwin } from '../sharedTwin';
import { useWheelLab } from './WheelLabStore';
import type { WheelLabStore } from './WheelLabStore';
import { fmtCyclesPlain } from './evaluate';
import type { WheelLabInputs, WheelSlot } from './evaluate';
import '../wheel.css';

const VERDICT: Record<string, string> = { pass: 'pass', review: 'review', fail: 'fail' };

/**
 * Design Lab for the alloy wheel: design A (the drawing) next to candidate B,
 * with the twin's load path run at fixed design conditions and two rig tests.
 * `moduleSwitch` is the page's own component switch, passed in by the Design Lab.
 */
export function WheelDesignLab({ moduleSwitch }: { moduleSwitch: ReactNode }) {
  const lab = useWheelLab();

  const sendToTwin = (slot: WheelSlot) => {
    const d = lab.designs[slot];
    const { sim } = getWheelTwin();
    const design: Partial<WheelDesign> = {};
    for (const s of DESIGN_SPECS) design[s.key] = d[s.key];
    sim.setParams({ ...design, spokeCount: d.spokeCount, materialId: d.materialId, kt: d.kt, staticLoadN: lab.inputs.ratedLoadN });
    navigate({ section: 'digital-twin', module: 'alloy-wheel' });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Design Lab</h1>
          <div className="page-sub">
            Alloy Wheel · linear static structural · fidelity: reduced-order beam load path + rig fatigue estimate (no solver)
          </div>
        </div>
        <div className="page-actions">
          {moduleSwitch}
          <button className="btn" onClick={() => sendToTwin('A')} title="Load design A into the alloy wheel twin">
            ◉ Open A in twin
          </button>
          <button className="btn primary" onClick={() => sendToTwin('B')} title="Load candidate B into the alloy wheel twin and drive it">
            ◉ Drive B in twin →
          </button>
        </div>
      </div>

      <div className="lab-grid">
        <DesignPanel lab={lab} slot="A" />
        <DesignPanel lab={lab} slot="B" />
        <div className="lab-side">
          <OutlinePanel lab={lab} />
          <PreviewPanel lab={lab} />
          <div className="note amber">
            <b>How far can these numbers be trusted?</b>
            <div style={{ marginTop: 4 }}>
              The same hand-calculation load path as the twin: assumed load sharing between spokes, each Y-spoke a beam
              from hub to rim, Basquin + Goodman + Miner on illustrative material constants. Rim bending and casting
              porosity are ignored. The rig factors and targets are assumptions. Use the direction of change between A
              and B, not the absolute values.
            </div>
          </div>
          <Panel title="Checks" right={<Badge kind="estimated" />}>
            <div className="checks-ab">
              <ChecksList title={`A · ${lab.designs.A.revision}`} results={lab.checks.A} />
              <ChecksList title={`B · ${lab.designs.B.revision}`} results={lab.checks.B} />
            </div>
          </Panel>
          <DiffPanel lab={lab} />
          <InputsPanel lab={lab} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DesignPanel({ lab, slot }: { lab: WheelLabStore; slot: WheelSlot }) {
  const d = lab.designs[slot];
  const mat = findWheelMaterial(d.materialId);
  const title = slot === 'A' ? 'Design A · Baseline (reference)' : 'Design B · Candidate (under test)';
  const set = (patch: Parameters<WheelLabStore['setDesign']>[1]) => lab.setDesign(slot, patch);
  return (
    <Panel
      className={`design-panel slot-${slot.toLowerCase()}`}
      title={<span className="slot-title">{title}</span>}
      right={
        <div className="panel-actions">
          {slot === 'B' && (
            <button className="btn sm" onClick={() => lab.copyAToB()} title="Copy design A's geometry and material into B">
              ← Copy A
            </button>
          )}
          <button className="btn sm" onClick={() => lab.resetSlot(slot)}>
            Reset
          </button>
        </div>
      }
    >
      <label className="stack-field">
        <span>Revision</span>
        <input className="text" value={d.revision} maxLength={40} onChange={(e) => set({ revision: e.target.value })} />
      </label>
      <label className="stack-field">
        <span>Material</span>
        <select className="select" value={d.materialId} onChange={(e) => set({ materialId: e.target.value as WheelMaterialId })}>
          {WHEEL_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mat-props">
        ρ {fmt(mat.densityKgM3)} kg/m³ · E {fmt(mat.eGPa, 1)} GPa · yield {fmt(mat.yieldMPa)} MPa
      </div>
      <div className="field">
        <div className="field-row">
          <span className="field-label">Y-spokes</span>
          <div className="seg">
            {[4, 5, 6, 7].map((n) => (
              <button key={n} className={d.spokeCount === n ? 'active' : ''} onClick={() => set({ spokeCount: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      {DESIGN_SPECS.map((s) => {
        const b = provenanceBadge(s.source);
        return (
          <SliderField
            key={s.key}
            label={s.label}
            hint={
              <>
                <Badge kind={b.kind} label={b.label} /> {s.hint}
              </>
            }
            value={d[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            digits={s.digits}
            unit={s.unit}
            onChange={(v) => set({ [s.key]: v })}
          />
        );
      })}
      <SliderField
        label="Junction stress factor Kt"
        hint={
          <>
            <Badge kind="assumed" /> 1 = nominal beam stress
          </>
        }
        value={d.kt}
        min={1}
        max={2.5}
        step={0.05}
        digits={2}
        onChange={(v) => set({ kt: v })}
      />
    </Panel>
  );
}

/** Front view of both designs: A outlined amber, B filled cyan. */
function OutlinePanel({ lab }: { lab: WheelLabStore }) {
  const S = 0.29; // m, half-size of the view box
  const shape = (slot: WheelSlot) => {
    const L = lab.estimates[slot].layout ?? wheelLayout(lab.designs[slot]);
    const paths: string[] = [];
    for (let i = 0; i < L.N; i++) {
      const a = (2 * Math.PI * i) / L.N;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pts = L.outline.map(([t, r]: Pt) => [t * c + r * s, -(-t * s + r * c)]);
      paths.push('M' + pts.map(([x, y]) => `${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`).join('L') + 'Z');
    }
    return paths.join(' ');
  };
  const ring = (r: number, cls: string) => <circle cx={0} cy={0} r={r * 1000} className={cls} />;
  return (
    <Panel title="Front view · A vs B" right={<span className="hint">spoke outlines from the geometry</span>}>
      <svg className="wheel-outline" viewBox={`${-S * 1000} ${-S * 1000} ${2 * S * 1000} ${2 * S * 1000}`} role="img" aria-label="Spoke outlines of design A and B, front view">
        {ring(FIXED.rFlange, 'rim')}
        {ring(FIXED.rSeat - FIXED.wall - 0.014, 'rim-inner')}
        {ring(FIXED.rHub, 'hub')}
        <path d={shape('B')} className="spokes-b" />
        <path d={shape('A')} className="spokes-a" />
        {ring(FIXED.rCapRecess, 'cap')}
      </svg>
      <div className="chart-key">
        <span>
          <i style={{ borderColor: 'var(--amber)' }} />A · {lab.designs.A.spokeCount} spokes
        </span>
        <span>
          <i style={{ borderColor: 'var(--accent-2)' }} />B · {lab.designs.B.spokeCount} spokes
        </span>
      </div>
    </Panel>
  );
}

function PreviewPanel({ lab }: { lab: WheelLabStore }) {
  const { A, B } = lab.estimates;
  const inp = lab.inputs;
  const rows: { label: string; a: string; b: string; unit: string }[] = [
    { label: 'Wheel mass', a: fmt(A.massKg, 2), b: fmt(B.massKg, 2), unit: 'kg' },
    { label: 'Polar inertia', a: fmt(A.inertiaKgM2, 3), b: fmt(B.inertiaKgM2, 3), unit: 'kg·m²' },
    { label: `Peak stress, ${inp.corneringG} g turn`, a: fmt(A.roadPeakMPa, 0), b: fmt(B.roadPeakMPa, 0), unit: 'MPa' },
    { label: 'Factor of safety on yield', a: fmt(A.fos, 2), b: fmt(B.fos, 2), unit: '' },
    { label: 'Road life, turn held', a: fmtLife(A.roadLifeKm), b: fmtLife(B.roadLifeKm), unit: 'km' },
    { label: 'Cornering rig life', a: fmtCycles(A.rigCorneringCycles), b: fmtCycles(B.rigCorneringCycles), unit: 'cyc' },
    { label: 'Radial rig life', a: fmtCycles(A.rigRadialCycles), b: fmtCycles(B.rigRadialCycles), unit: 'cyc' },
  ];
  return (
    <Panel title="Design-condition preview" right={<Badge kind="estimated" />}>
      <div className="ab-head">
        <span />
        <span className="a">A</span>
        <span className="b">B</span>
      </div>
      {rows.map((r) => (
        <div className="ab-row" key={r.label}>
          <span className="l">{r.label}</span>
          <span className="v a">{r.a}</span>
          <span className="v b">{r.b}</span>
          <span className="u">{r.unit}</span>
        </div>
      ))}
      <div className="ab-row verdict">
        <span className="l">Verdict (all checks)</span>
        <span className={`v a ${VERDICT[lab.verdicts.A]}`}>{lab.verdicts.A}</span>
        <span className={`v b ${VERDICT[lab.verdicts.B]}`}>{lab.verdicts.B}</span>
        <span className="u" />
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Critical point: A at the {spotLabel(A.roadPeakSpot).toLowerCase()}, B at the {spotLabel(B.roadPeakSpot).toLowerCase()}.
        Rig moment {fmt(A.rigMomentNm, 0)} N·m · drum load {fmt(A.rigRadialLoadN / 1000, 2)} kN.
      </div>
    </Panel>
  );
}

function DiffPanel({ lab }: { lab: WheelLabStore }) {
  const rows = lab.diffs();
  const { A, B } = lab.designs;
  const ma = findWheelMaterial(A.materialId).short;
  const mb = findWheelMaterial(B.materialId).short;
  const ea = lab.estimates.A;
  const eb = lab.estimates.B;
  const changed = rows.filter((r) => Math.abs(r.B - r.A) > 1e-9).length + (ma !== mb ? 1 : 0);
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
          <tr className={ma !== mb ? 'changed' : ''}>
            <td>Material</td>
            <td colSpan={3} className="mat-diff">
              {ma === mb ? (
                <span className="muted">same: {ma}</span>
              ) : (
                <>
                  <span className="a-txt">{ma}</span> → <span className="b-txt">{mb}</span>
                </>
              )}
            </td>
          </tr>
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
          <tr>
            <td>
              Mass <span className="muted">(kg)</span>
            </td>
            <td className="r">{fmt(ea.massKg, 2)}</td>
            <td className="r">{fmt(eb.massKg, 2)}</td>
            <DeltaCell a={ea.massKg} b={eb.massKg} digits={2} lowerIsBetter percent />
          </tr>
          <tr>
            <td>
              Peak stress <span className="muted">(MPa)</span>
            </td>
            <td className="r">{fmt(ea.roadPeakMPa, 0)}</td>
            <td className="r">{fmt(eb.roadPeakMPa, 0)}</td>
            <DeltaCell a={ea.roadPeakMPa} b={eb.roadPeakMPa} digits={0} lowerIsBetter percent />
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

const INPUT_SPECS: { key: keyof WheelLabInputs; label: string; unit: string; min: number; max: number; step: number; digits: number; kind: 'demo' | 'assumed' }[] = [
  { key: 'ratedLoadN', label: 'Rated wheel load Fv', unit: 'N', min: 2500, max: 8000, step: 50, digits: 0, kind: 'demo' },
  { key: 'corneringG', label: 'Design cornering', unit: 'g', min: 0.2, max: 1.2, step: 0.05, digits: 2, kind: 'assumed' },
  { key: 'tyrePressureBar', label: 'Tyre pressure', unit: 'bar', min: 1.6, max: 4.5, step: 0.05, digits: 2, kind: 'assumed' },
  { key: 'minFoS', label: 'Minimum factor of safety', unit: '–', min: 1, max: 3, step: 0.05, digits: 2, kind: 'assumed' },
  { key: 'minSectionMm', label: 'Castable minimum section', unit: 'mm', min: 3, max: 12, step: 0.5, digits: 1, kind: 'assumed' },
  { key: 'rigMu', label: 'Cornering rig μ', unit: '–', min: 0.5, max: 1.1, step: 0.05, digits: 2, kind: 'assumed' },
  { key: 'rigS', label: 'Cornering rig factor S', unit: '–', min: 1, max: 2.5, step: 0.05, digits: 2, kind: 'assumed' },
  { key: 'rigK', label: 'Radial rig factor K', unit: '–', min: 1.5, max: 3, step: 0.05, digits: 2, kind: 'assumed' },
];

function InputsPanel({ lab }: { lab: WheelLabStore }) {
  const inp = lab.inputs;
  const targets: { key: 'targetCornering' | 'targetRadial'; label: string }[] = [
    { key: 'targetCornering', label: 'Cornering rig target' },
    { key: 'targetRadial', label: 'Radial rig target' },
  ];
  return (
    <Panel
      title="Design conditions (both designs)"
      right={
        <button className="btn sm" onClick={() => lab.resetInputs()}>
          Reset
        </button>
      }
    >
      {INPUT_SPECS.map((s) => (
        <SliderField
          key={s.key}
          label={s.label}
          hint={<Badge kind={s.kind} />}
          value={inp[s.key]}
          min={s.min}
          max={s.max}
          step={s.step}
          digits={s.digits}
          unit={s.unit === '–' ? undefined : s.unit}
          onChange={(v) => lab.setInputs({ [s.key]: v })}
        />
      ))}
      {targets.map((t) => (
        <div className="field" key={t.key}>
          <span className="field-label">
            {t.label}
            <small>
              <Badge kind="assumed" /> cycles the wheel must survive; set it from your standard
            </small>
          </span>
          <div className="seg" style={{ width: '100%' }}>
            {[5e4, 1e5, 2e5, 5e5, 1e6].map((n) => (
              <button key={n} style={{ flex: 1 }} className={inp[t.key] === n ? 'active' : ''} onClick={() => lab.setInputs({ [t.key]: n })}>
                {fmtCyclesPlain(n)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}
