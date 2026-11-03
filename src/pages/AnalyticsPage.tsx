import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../app/routes';
import { ComponentSwitch } from '../shell/ComponentSwitch';
import { ABChart } from '../ui/ABChart';
import { SERIES_COLOR } from '../ui/ABChart';
import { Badge, Panel, Tabs, fmt } from '../ui/primitives';
import { allSweeps, analyticsCsv, atDesign, operatingCurves, outputsFor, sensitivity } from '../workspace/analytics';
import type { AnalyticsSource, OutputDef, ParamSweep, SensitivityRow } from '../workspace/analytics';
import { COMPONENT_LABEL } from '../workspace/designs';
import type { ComponentId } from '../workspace/designs';
import { useWorkspace } from '../workspace/useWorkspace';
import { DeltaCell } from './shared';
import './analytics.css';

/** Pick the source fields only, so memo keys don't depend on the store object. */
const sourceOf = (ws: AnalyticsSource): AnalyticsSource => ({
  caliper: ws.caliper,
  caliperInputs: ws.caliperInputs,
  plug: ws.plug,
  plugInputs: ws.plugInputs,
});

const unitText = (u: string) => (u === '–' ? '' : ` ${u}`);

/** Remembered while you move between pages. */
let lastOutput: Record<ComponentId, string> = { 'brake-caliper': 'stress', 'spark-plug': 'tip' };
let lastOnlyChanged = false;

/**
 * Analytics: every design parameter against every result, for design A and
 * design B, plus a sensitivity ranking and the operating-condition curves.
 * Everything is computed live from the Design Lab designs.
 */
export function AnalyticsPage() {
  const ws = useWorkspace();
  const c = ws.component;
  const src = sourceOf(ws);
  const key = JSON.stringify(src);
  const outputs = outputsFor(src, c);
  const [outputSel, setOutputSel] = useState(lastOutput);
  const [onlyChanged, setOnlyChanged] = useState(lastOnlyChanged);
  const outputKey = outputs.some((o) => o.key === outputSel[c]) ? outputSel[c] : outputs[0].key;
  const output = outputs.find((o) => o.key === outputKey)!;

  const sweeps = useMemo(() => allSweeps(src, c, outputKey), [key, c, outputKey]);
  const sens = useMemo(() => sensitivity(src, c, outputKey), [key, c, outputKey]);
  const curves = useMemo(() => operatingCurves(src, c), [key, c]);
  const shown = onlyChanged ? sweeps.filter((s) => s.changed) : sweeps;
  const changedCount = sweeps.filter((s) => s.changed).length;
  const revisions = c === 'brake-caliper' ? { A: ws.caliper.A.revision, B: ws.caliper.B.revision } : { A: ws.plug.A.revision, B: ws.plug.B.revision };

  const pickOutput = (k: string) => {
    lastOutput = { ...outputSel, [c]: k };
    setOutputSel(lastOutput);
  };

  const downloadCsv = () => {
    const blob = new Blob([analyticsCsv(src, c)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `autotwin-analytics-${c}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="page-sub">
            {COMPONENT_LABEL[c]} · every parameter against every result, design A vs design B · reduced-order estimates
          </div>
        </div>
        <div className="page-actions">
          <ComponentSwitch value={c} onChange={(v) => ws.setComponent(v)} />
          <button className="btn" onClick={() => navigate({ section: 'design-lab' })}>
            ○ Edit designs
          </button>
          <button className="btn" onClick={downloadCsv} title="Every curve on this page as one CSV file">
            ⇩ CSV
          </button>
          <button className="btn primary" onClick={() => navigate({ section: 'reports' })}>
            ▥ Build report →
          </button>
        </div>
      </div>

      <DesignPointPanel src={src} component={c} outputs={outputs} revisions={revisions} selected={outputKey} onSelect={pickOutput} />

      <Panel
        title={`Parameter sweeps · ${output.label}`}
        right={
          <div className="an-head-tools">
            <Tabs value={outputKey} onChange={pickOutput} options={outputs.map((o) => ({ id: o.key, label: o.label.replace(/ at .*| \(.*\)/, '') }))} />
          </div>
        }
      >
        <div className="an-toolbar">
          <span className="hint">
            Each chart moves one parameter across its full range; everything else stays at that design&apos;s own values.
            The dashed lines mark where A and B sit. Where the two curves lie on top of each other, A and B agree in
            everything else that matters to this result.
          </span>
          <label className="an-check">
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => {
                lastOnlyChanged = e.target.checked;
                setOnlyChanged(e.target.checked);
              }}
            />
            Only parameters that differ ({changedCount})
          </label>
        </div>
        {shown.length === 0 ? (
          <div className="hint" style={{ padding: '18px 0' }}>
            A and B have the same parameters, so the curves are identical. Change design B in the{' '}
            <button className="link-btn" onClick={() => navigate({ section: 'design-lab' })}>
              Design Lab
            </button>
            .
          </div>
        ) : (
          <div className="an-grid">
            {shown.map((s) => (
              <SweepChart key={s.param.key} s={s} revisions={revisions} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`Sensitivity · what moves ${output.label.toLowerCase()} most`} right={<Badge kind="estimated" />}>
        <Tornado rows={sens} output={output} />
      </Panel>

      <div className="section-label">Operating conditions</div>
      {curves.map((g) => (
        <Panel key={g.title} title={g.title} right={<Badge kind={g.source} />}>
          <div className="xp-meta">
            <span>{g.conditions}</span>
          </div>
          <div className="an-grid wide">
            {g.series.map((s) => (
              <ABChart
                key={s.title}
                title={s.title}
                unit={s.yUnit}
                points={s.points}
                labels={revisions}
                xLabel={s.xLabel}
                band={s.band}
                xFormat={(v) => (Math.abs(v) >= 100 ? fmt(v) : `${+v.toFixed(1)}`)}
                zeroBased={s.yUnit === 'km/h'}
                height={200}
              />
            ))}
          </div>
        </Panel>
      ))}
      <div className="hint">
        Brake curves use the default Experiment test conditions (100 km/h, 6 MPa) and the simplified brake dynamics; the
        others use the Design Lab load case. To record a run with your own conditions, use the{' '}
        <button className="link-btn" onClick={() => navigate({ section: 'experiment' })}>
          Experiment
        </button>{' '}
        page.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DesignPointPanel({
  src,
  component,
  outputs,
  revisions,
  selected,
  onSelect,
}: {
  src: AnalyticsSource;
  component: ComponentId;
  outputs: OutputDef[];
  revisions: { A: string; B: string };
  selected: string;
  onSelect: (k: string) => void;
}) {
  return (
    <Panel title="At the design point" right={<Badge kind="estimated" />}>
      <table className="data-table plain an-point">
        <thead>
          <tr>
            <th>Result</th>
            <th>Limit</th>
            <th className="r a">A · {revisions.A}</th>
            <th className="r b">B · {revisions.B}</th>
            <th className="r">B − A</th>
          </tr>
        </thead>
        <tbody>
          {outputs.map((o) => {
            const v = atDesign(src, component, o.key);
            const ok = (x: number) => !o.limit || ((o.limit.min === undefined || x >= o.limit.min) && (o.limit.max === undefined || x <= o.limit.max));
            return (
              <tr key={o.key} className={o.key === selected ? 'an-selected' : ''}>
                <td>
                  <button className="link-btn an-out" onClick={() => onSelect(o.key)} title="Plot this result against every parameter">
                    {o.label}
                  </button>
                  {o.unit !== '–' && <span className="muted"> ({o.unit})</span>}
                </td>
                <td className="muted">{o.limit?.label ?? '—'}</td>
                <td className={`r ${ok(v.A) ? '' : 'an-out-of-limit'}`}>{fmt(v.A, o.digits)}</td>
                <td className={`r ${ok(v.B) ? '' : 'an-out-of-limit'}`}>{fmt(v.B, o.digits)}</td>
                <DeltaCell a={v.A} b={v.B} digits={o.digits} lowerIsBetter={o.lowerIsBetter} percent />
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 6 }}>
        Red values are outside the limit. Click a result to plot it against every parameter below. The full PASS / NEEDS
        REVIEW / FAIL verdict, with review margins, is on the Design Lab and AI Insights pages.
      </div>
    </Panel>
  );
}

function SweepChart({ s, revisions }: { s: ParamSweep; revisions: { A: string; B: string } }) {
  const u = unitText(s.param.unit);
  const pd = s.param.digits;
  const title = s.changed
    ? `${s.param.label} · A ${fmt(s.at.A, pd)} → B ${fmt(s.at.B, pd)}${u}`
    : `${s.param.label} · ${fmt(s.at.A, pd)}${u} in both`;
  return (
    <div className={`an-cell ${s.changed ? 'changed' : ''}`}>
      <ABChart
        title={title}
        unit={s.output.unit === '–' ? '' : s.output.unit}
        points={s.points}
        labels={revisions}
        xLabel={`${s.param.label}${u ? `, ${s.param.unit}` : ''}`}
        xFormat={(v) => fmt(v, pd)}
        digits={s.output.digits}
        band={s.band}
        markers={s.at}
        height={190}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tornado: % change of the output for ±10 % of each parameter        */
/* ------------------------------------------------------------------ */

const ROW_H = 34;
const LABEL_W = 190;

function Tornado({ rows, output }: { rows: SensitivityRow[]; output: OutputDef }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = rows.slice(0, 10);
  const max = Math.max(1e-6, ...top.flatMap((r) => [r.A.lo, r.A.hi, r.B.lo, r.B.hi].map(Math.abs)));
  const plotW = Math.max(200, w - LABEL_W - 70);
  const cx = LABEL_W + plotW / 2;
  const sx = (v: number) => cx + (v / max) * (plotW / 2);
  const h = top.length * ROW_H + 30;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${fmt(v, Math.abs(v) < 10 ? 1 : 0)} %`;

  return (
    <div className="an-tornado" ref={wrap}>
      <div className="hint" style={{ marginBottom: 6 }}>
        Each parameter is moved 10 % up and down from each design&apos;s own value (one step for counts such as ribs and
        pistons). Solid bar: the parameter goes <b>up</b>; faint bar: it goes <b>down</b>. Longest bars first.
      </div>
      <svg width={w} height={h} role="img" aria-label={`Sensitivity of ${output.label} to each parameter, design A vs design B`}>
        <line x1={cx} x2={cx} y1={4} y2={h - 22} className="ab-cross" />
        {[-1, -0.5, 0.5, 1].map((f) => (
          <text key={f} x={sx(f * max)} y={h - 6} className="ab-tick" textAnchor="middle">
            {pct(f * max)}
          </text>
        ))}
        <text x={cx} y={h - 6} className="ab-tick" textAnchor="middle">
          0
        </text>
        {top.map((r, i) => {
          const y = i * ROW_H + 6;
          const label = r.param.step >= 1 && r.param.unit === '–' ? `${r.param.label} (±1)` : r.param.label;
          return (
            <g key={r.param.key}>
              <text x={LABEL_W - 10} y={y + ROW_H / 2} className="an-t-label" textAnchor="end" dominantBaseline="middle">
                {label}
              </text>
              {(['A', 'B'] as const).map((k, j) => {
                const by = y + 4 + j * 13;
                const e = r[k];
                const bar = (v: number, faint: boolean) => (
                  <rect
                    x={Math.min(sx(0), sx(v))}
                    y={by}
                    width={Math.max(1, Math.abs(sx(v) - sx(0)))}
                    height={11}
                    rx={2}
                    fill={SERIES_COLOR[k]}
                    opacity={faint ? 0.35 : 0.95}
                  />
                );
                return (
                  <g key={k}>
                    {bar(e.lo, true)}
                    {bar(e.hi, false)}
                    <text x={w - 4} y={by + 9} className="an-t-val" textAnchor="end">
                      {k} {pct(e.hi)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="abchart-legend an-legend">
        <span>
          <i style={{ borderColor: SERIES_COLOR.A }} />A
        </span>
        <span>
          <i style={{ borderColor: SERIES_COLOR.B }} />B
        </span>
        <span className="muted">values on the right: effect of the parameter going up</span>
      </div>
    </div>
  );
}
