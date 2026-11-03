import { forwardRef, useMemo, useRef, useState } from 'react';
import { navigate } from '../app/routes';
import { ComponentSwitch } from '../shell/ComponentSwitch';
import { ABChart } from '../ui/ABChart';
import { Badge, Panel, fmt } from '../ui/primitives';
import { allSweeps } from '../workspace/analytics';
import { SECTION_LABEL, SECTION_ORDER, buildReport, countsText, defaultOptions, reportMarkdown } from '../workspace/report';
import type { ReportData, ReportOptions, SectionId } from '../workspace/report';
import type { ComponentId } from '../workspace/designs';
import { pctChange } from '../workspace/metrics';
import { VERDICT_LABEL } from '../workspace/validation';
import type { RuleResult } from '../workspace/validation';
import { useWorkspace } from '../workspace/useWorkspace';
import type { WorkspaceStore } from '../workspace/WorkspaceStore';
import { VerdictTag, fmtDateTime } from './shared';
import './analytics.css';

/** Options per component, kept while you move between pages. */
const remembered: Partial<Record<ComponentId, ReportOptions>> = {};

const unitText = (u: string) => (u === '–' ? '' : ` ${u}`);
const signedPct = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${fmt(p, Math.abs(p) < 10 ? 1 : 0)} %`);
const fileStem = (o: ReportOptions) =>
  `autotwin-report-${o.component}-${new Date().toISOString().slice(0, 10)}`;

function download(name: string, type: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The app's CSS as text, so a printed or saved copy of the sheet looks the same. */
function collectCss() {
  return [...document.styleSheets]
    .map((s) => {
      try {
        return [...s.cssRules].map((r) => r.cssText).join('\n');
      } catch {
        return ''; // cross-origin sheet (web fonts): the fallback font is fine
      }
    })
    .join('\n');
}

function standaloneHtml(sheet: HTMLElement, title: string) {
  const esc = title.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc}</title><style>${collectCss()}</style></head><body class="rp-standalone">${sheet.outerHTML}</body></html>`;
}

/**
 * Reports: pick what goes in, preview it as a printable sheet, then print /
 * save it as PDF or download it as HTML, Markdown or JSON.
 */
export function ReportsPage() {
  const ws = useWorkspace();
  const c = ws.component;
  const [opts, setOptsState] = useState<ReportOptions>(() => remembered[c] ?? defaultOptions(c, ws.runs));
  const options = opts.component === c ? opts : (remembered[c] ?? defaultOptions(c, ws.runs));
  const setOpts = (patch: Partial<ReportOptions>) => {
    const next = { ...options, ...patch };
    remembered[c] = next;
    setOptsState(next);
  };
  const sheet = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');

  const data = buildReport(ws, options);
  const md = () => reportMarkdown(data);
  const componentRuns = ws.runs.filter((r) => r.component === c);

  const print = () => {
    if (!sheet.current) return;
    const w = window.open('', '_blank');
    if (!w) {
      setNotice('The browser blocked the print window. Allow pop-ups for this page, or use "Download HTML" and print that.');
      return;
    }
    w.document.open();
    w.document.write(standaloneHtml(sheet.current, options.title));
    w.document.close();
    w.focus();
    // Give the copied styles a moment to apply before the print dialog opens.
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="page-sub">Engineering report for design A vs design B · built from the workspace, no backend needed</div>
        </div>
        <div className="page-actions">
          <ComponentSwitch value={c} onChange={(v) => ws.setComponent(v)} />
          <button className="btn" onClick={() => navigate({ section: 'analytics' })}>
            ▤ Analytics
          </button>
        </div>
      </div>

      <div className="rp-grid">
        <div className="rp-side">
          <Panel title="Export">
            <div className="rp-exports">
              <button className="btn primary" onClick={print}>
                ⎙ Print / save as PDF
              </button>
              <button className="btn" onClick={() => sheet.current && download(`${fileStem(options)}.html`, 'text/html', standaloneHtml(sheet.current, options.title))}>
                ⇩ HTML
              </button>
              <button className="btn" onClick={() => download(`${fileStem(options)}.md`, 'text/markdown', md())}>
                ⇩ Markdown
              </button>
              <button className="btn" onClick={() => download(`${fileStem(options)}.json`, 'application/json', JSON.stringify(data, null, 2))}>
                ⇩ JSON
              </button>
            </div>
            {notice && <div className="note amber" style={{ marginTop: 8 }}>{notice}</div>}
            <div className="hint" style={{ marginTop: 8 }}>
              PDF: choose “Save as PDF” in the print dialog. JSON holds every number and curve in the report.
            </div>
          </Panel>

          <Panel title="Details">
            <label className="stack-field">
              <span>Title</span>
              <input className="text" value={options.title} maxLength={120} onChange={(e) => setOpts({ title: e.target.value })} />
            </label>
            <label className="stack-field">
              <span>Prepared by</span>
              <input className="text" value={options.preparedBy} maxLength={80} placeholder="Name or team" onChange={(e) => setOpts({ preparedBy: e.target.value })} />
            </label>
            <label className="stack-field">
              <span>Notes</span>
              <textarea
                className="text rp-notes"
                value={options.notes}
                maxLength={2000}
                rows={4}
                placeholder="Purpose of the change, decisions, next steps…"
                onChange={(e) => setOpts({ notes: e.target.value })}
              />
            </label>
          </Panel>

          <Panel title="Sections">
            {SECTION_ORDER.map((id) => (
              <label key={id} className="an-check rp-row">
                <input
                  type="checkbox"
                  checked={options.sections[id]}
                  onChange={(e) => setOpts({ sections: { ...options.sections, [id]: e.target.checked } })}
                />
                {SECTION_LABEL[id]}
              </label>
            ))}
          </Panel>

          <Panel
            title={`Experiment runs · ${options.runIds.filter((id) => componentRuns.some((r) => r.id === id)).length} of ${componentRuns.length}`}
            right={
              componentRuns.length > 0 && (
                <div className="panel-actions">
                  <button className="btn sm" onClick={() => setOpts({ runIds: componentRuns.map((r) => r.id) })}>
                    All
                  </button>
                  <button className="btn sm" onClick={() => setOpts({ runIds: [] })}>
                    None
                  </button>
                </div>
              )
            }
          >
            {componentRuns.length === 0 ? (
              <div className="hint">
                No runs for this component yet.{' '}
                <button className="link-btn" onClick={() => navigate({ section: 'experiment' })}>
                  Run one in Experiment
                </button>
                .
              </div>
            ) : (
              componentRuns.map((r) => (
                <label key={r.id} className="an-check rp-row rp-run">
                  <input
                    type="checkbox"
                    checked={options.runIds.includes(r.id)}
                    onChange={(e) =>
                      setOpts({
                        // Keep the history order (newest first) whatever order they're ticked in.
                        runIds: componentRuns.map((x) => x.id).filter((id) => (id === r.id ? e.target.checked : options.runIds.includes(id))),
                      })
                    }
                  />
                  <span>
                    {r.title}
                    <small>{fmtDateTime(r.createdAt)}</small>
                  </span>
                </label>
              ))
            )}
          </Panel>
        </div>

        <div className="rp-preview">
          <ReportSheet ref={sheet} data={data} ws={ws} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The sheet                                                          */
/* ------------------------------------------------------------------ */

const ruleCell = (r: RuleResult | undefined) =>
  r ? (
    <span className={`rp-rule ${r.status}`}>
      {fmt(r.value, r.digits)}
      {unitText(r.unit)} <span className={`vtag ${r.status}`}>{VERDICT_LABEL[r.status]}</span>
    </span>
  ) : (
    <span className="muted">—</span>
  );

const ReportSheet = forwardRef<HTMLDivElement, { data: ReportData; ws: WorkspaceStore }>(function ReportSheet({ data: d, ws }, ref) {
  const o = d.options;
  const on = (s: SectionId) => o.sections[s];
  const revisions = d.revisions;
  // Charts of the main result against each changed parameter.
  const sweeps = useMemo(
    () => (on('sensitivity') ? allSweeps(ws, o.component, d.sensitivityOutput.key).filter((s) => s.changed) : []),
    [JSON.stringify([ws.caliper, ws.plug, ws.caliperInputs, ws.plugInputs]), o.component, o.sections.sensitivity],
  );
  let n = 0;
  const h2 = (s: SectionId, text = SECTION_LABEL[s]) => (
    <h2>
      {++n}. {text}
    </h2>
  );

  return (
    <div className="report-sheet" ref={ref}>
      <header className="rp-header">
        <div className="rp-brand">AutoTwin · virtual prototyping report</div>
        <h1>{o.title || 'Untitled report'}</h1>
        <dl className="rp-meta">
          <dt>Component</dt>
          <dd>{d.componentLabel}</dd>
          <dt>Design A (reference)</dt>
          <dd>{revisions.A}</dd>
          <dt>Design B (candidate)</dt>
          <dd>{revisions.B}</dd>
          <dt>Generated</dt>
          <dd>{fmtDateTime(d.generatedAt)}</dd>
          {o.preparedBy.trim() && (
            <>
              <dt>Prepared by</dt>
              <dd>{o.preparedBy}</dd>
            </>
          )}
          <dt>Evidence level</dt>
          <dd>Reduced-order estimates and simplified dynamics. Not FEA, not validated.</dd>
        </dl>
      </header>

      {on('summary') && (
        <section className="rp-section">
          {h2('summary')}
          <div className="rp-verdicts">
            {(['A', 'B'] as const).map((k) => (
              <div key={k} className={`rp-verdict ${k === 'A' ? 'a' : 'b'}`}>
                <div className="rp-v-slot">Design {k}</div>
                <div className="rp-v-rev">{revisions[k]}</div>
                <VerdictTag verdict={d.validation[k].verdict} size="lg" />
                <div className="rp-v-counts">{countsText(d.validation[k])}</div>
              </div>
            ))}
          </div>
          <ul className="rp-list">{d.headline.slice(2).map((h) => <li key={h}>{h}</li>)}</ul>
          {o.notes.trim() && (
            <div className="rp-notes-out">
              <b>Notes.</b> {o.notes}
            </div>
          )}
        </section>
      )}

      {on('changes') && (
        <section className="rp-section">
          {h2('changes')}
          {d.changes.length + d.materials.length === 0 ? (
            <p>A and B are identical.</p>
          ) : (
            <table className="data-table plain">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th className="r">A</th>
                  <th className="r">B</th>
                  <th className="r">B − A</th>
                </tr>
              </thead>
              <tbody>
                {d.materials.map((m) => (
                  <tr key={m.label}>
                    <td>{m.label}</td>
                    <td colSpan={3} className="mat-diff">
                      {m.A} → {m.B}
                    </td>
                  </tr>
                ))}
                {d.changes.map((x) => (
                  <tr key={x.label}>
                    <td>
                      {x.label}
                      {x.unit !== '–' && <span className="muted"> ({x.unit})</span>}
                    </td>
                    <td className="r">{fmt(x.A, x.digits)}</td>
                    <td className="r">{fmt(x.B, x.digits)}</td>
                    <td className="r">
                      {x.B > x.A ? '+' : ''}
                      {fmt(x.B - x.A, x.digits)} <small>({signedPct(pctChange(x.A, x.B))})</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {on('designPoint') && (
        <section className="rp-section">
          {h2('designPoint')}
          <p className="rp-tag">
            <Badge kind="estimated" /> Reduced-order estimates at the Design Lab load case.
          </p>
          <table className="data-table plain">
            <thead>
              <tr>
                <th>Result</th>
                <th>Limit</th>
                <th className="r">A</th>
                <th className="r">B</th>
                <th className="r">B − A</th>
              </tr>
            </thead>
            <tbody>
              {d.designPoint.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.label}
                    {r.unit !== '–' && <span className="muted"> ({r.unit})</span>}
                  </td>
                  <td className="muted">{r.limit?.label ?? '—'}</td>
                  <td className="r">{fmt(r.A, r.digits)}</td>
                  <td className="r">{fmt(r.B, r.digits)}</td>
                  <td className="r">{signedPct(pctChange(r.A, r.B))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {on('checks') && (
        <section className="rp-section">
          {h2('checks')}
          <table className="data-table plain">
            <thead>
              <tr>
                <th>Check</th>
                <th>Requirement</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {d.checks.map((r) => (
                <tr key={r.ruleId}>
                  <td>{r.label}</td>
                  <td className="muted">{r.requirement}</td>
                  <td>{ruleCell(r.A)}</td>
                  <td>{ruleCell(r.B)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {on('sensitivity') && (
        <section className="rp-section">
          {h2('sensitivity', `Sensitivity: ${d.sensitivityOutput.label.toLowerCase()}`)}
          <p className="rp-tag">
            <Badge kind="estimated" /> % change in the result when each parameter goes up or down by 10 % (±1 for counts), from
            each design&apos;s own value.
          </p>
          <table className="data-table plain">
            <thead>
              <tr>
                <th>Parameter</th>
                <th className="r">A up</th>
                <th className="r">A down</th>
                <th className="r">B up</th>
                <th className="r">B down</th>
              </tr>
            </thead>
            <tbody>
              {d.sensitivity.map((r) => (
                <tr key={r.param.key}>
                  <td>{r.param.label}</td>
                  <td className="r">{signedPct(r.A.hi)}</td>
                  <td className="r">{signedPct(r.A.lo)}</td>
                  <td className="r">{signedPct(r.B.hi)}</td>
                  <td className="r">{signedPct(r.B.lo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sweeps.length > 0 && (
            <>
              <h3>{d.sensitivityOutput.label} against each changed parameter</h3>
              <div className="rp-charts">
                {sweeps.map((s) => (
                  <div className="rp-chart" key={s.param.key}>
                    <ABChart
                      title={`${s.param.label} · A ${fmt(s.at.A, s.param.digits)} → B ${fmt(s.at.B, s.param.digits)}${unitText(s.param.unit)}`}
                      unit={s.output.unit === '–' ? '' : s.output.unit}
                      points={s.points}
                      labels={revisions}
                      xLabel={`${s.param.label}${s.param.unit === '–' ? '' : `, ${s.param.unit}`}`}
                      xFormat={(v) => fmt(v, s.param.digits)}
                      digits={s.output.digits}
                      band={s.band}
                      markers={s.at}
                      height={180}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {on('runs') && (
        <section className="rp-section">
          {h2('runs')}
          {d.runs.length === 0 && <p>No runs selected.</p>}
          {d.runs.map((r) => (
            <div className="rp-run-block" key={r.id}>
              <h3>
                {r.title} <Badge kind={r.source} />
              </h3>
              <div className="rp-run-meta">
                {fmtDateTime(r.createdAt)} · {r.conditions} · tested A {r.revisions.A}, B {r.revisions.B}
              </div>
              {r.stale && <div className="rp-stale">The Design Lab designs have changed since this run.</div>}
              <table className="data-table plain">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th className="r">A</th>
                    <th className="r">B</th>
                    <th className="r">B − A</th>
                  </tr>
                </thead>
                <tbody>
                  {r.metrics.map((m) => (
                    <tr key={m.key}>
                      <td>
                        {m.label}
                        {m.unit !== '–' && <span className="muted"> ({m.unit})</span>}
                      </td>
                      <td className="r">{fmt(m.A, m.digits)}</td>
                      <td className="r">{fmt(m.B, m.digits)}</td>
                      <td className="r">
                        {m.B > m.A ? '+' : ''}
                        {fmt(m.B - m.A, m.digits)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Feasible</td>
                    <td className="r">{r.feasible.A ? '✓ yes' : '✕ no'}</td>
                    <td className="r">{r.feasible.B ? '✓ yes' : '✕ no'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div className="rp-charts">
                {r.series.map((s) => (
                  <div className="rp-chart" key={s.title}>
                    <ABChart
                      title={s.title}
                      unit={s.yUnit}
                      points={s.points}
                      labels={r.revisions}
                      xLabel={s.xLabel}
                      band={s.band}
                      xFormat={(v) => (Math.abs(v) >= 100 ? fmt(v) : `${+v.toFixed(1)}`)}
                      zeroBased={s.yUnit === 'km/h'}
                      height={180}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {on('method') && (
        <section className="rp-section">
          {h2('method')}
          <h3>Method</h3>
          <ul className="rp-list">{d.method.map((m) => <li key={m}>{m}</li>)}</ul>
          <h3>Limitations</h3>
          <ul className="rp-list">{d.limitations.map((m) => <li key={m}>{m}</li>)}</ul>
        </section>
      )}

      <footer className="rp-footer">
        Generated by AutoTwin from the browser workspace. Every number is labelled with where it came from; none is a
        solver result or a physical measurement.
      </footer>
    </div>
  );
});
