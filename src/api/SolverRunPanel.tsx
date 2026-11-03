import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Badge, NumberInput, Panel, SliderField, Toggle } from '../ui/primitives';
import type { Candidate, ComponentType, DisplayValue, StudyResult } from './types';
import { useBackend } from './useBackend';
import {
  cancelRun,
  isActive,
  resumeIfNeeded,
  selectComponent,
  setInput,
  solverStore,
  startRun,
  updateSettings,
} from './solverRun';
import type { MeshPreset } from './solverRun';
import './solver.css';

/** The workspace's component ids, mapped to the backend's profile types. */
const FROM_WORKSPACE: Record<string, ComponentType> = {
  'brake-caliper': 'brake_caliper',
  'spark-plug': 'spark_plug',
};

const TYPES: { id: ComponentType; label: string }[] = [
  { id: 'brake_caliper', label: 'Brake caliper' },
  { id: 'spark_plug', label: 'Spark plug' },
  { id: 'alloy_wheel', label: 'Alloy wheel' },
];

const STATUS: Record<string, { cls: 'pass' | 'fail' | 'review'; label: string }> = {
  feasible: { cls: 'pass', label: 'Feasible' },
  infeasible: { cls: 'fail', label: 'Infeasible' },
  geometry_invalid: { cls: 'fail', label: 'Invalid geometry' },
  mesh_failed: { cls: 'fail', label: 'Mesh failed' },
  solver_failed: { cls: 'fail', label: 'Solver failed' },
};

function fmtDV(v?: DisplayValue | null) {
  if (!v || !Number.isFinite(v.value)) return '—';
  const a = Math.abs(v.value);
  const d = a >= 100 ? 1 : a >= 1 ? 2 : 3;
  return `${v.value.toFixed(d)} ${v.unit}`;
}

/** The backend stores naive UTC timestamps ("2026-11-04T21:31:01"); read them as UTC, not local time. */
function parseUtc(t?: string | null) {
  if (!t) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}

function fmtDuration(s: number) {
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

function useSolver() {
  return useSyncExternalStore(solverStore.subscribe, solverStore.get);
}

/**
 * "Run on solver": sends a bounded design study to the AutoTwin backend and
 * shows what the finite-element solver actually returned. Self-contained, so
 * any page can mount it. Pass the workspace component to follow its selection.
 */
export function SolverRunPanel({ component }: { component?: string }) {
  const s = useSolver();
  const backend = useBackend();
  const online = backend.status === 'online';
  const t = s.componentType;
  const profile = s.profiles[t];
  const settings = s.settings[t];
  const study = s.study[t];
  const running = isActive(s.job);
  const runningHere = running && s.jobComponent === t;

  // Follow the page's component selection; the user can still pick another type here.
  useEffect(() => {
    const mapped = component ? FROM_WORKSPACE[component] : undefined;
    if (mapped && mapped !== solverStore.get().componentType) void selectComponent(mapped);
  }, [component]);

  // Load the profile once the backend is reachable (and re-try when it comes back).
  useEffect(() => {
    if (!online) return;
    resumeIfNeeded();
    void selectComponent(solverStore.get().componentType);
  }, [online, t]);

  const assumptions = profile?.demo_assumptions.filter((a) => a.requires_confirmation) ?? [];
  const usesDemo = !!profile && profile.engineering_inputs.some((f) => settings && f.key in settings.inputs && !settings.edited.includes(f.key));

  // Runtime estimate only from a measured run on this backend, never a guess.
  const estimate = useMemo(() => {
    const per = study?.summary.mean_solve_seconds;
    if (!settings || !per || study?.mesh_preset !== settings.meshPreset) return null;
    return (settings.candidateBudget + 1) * per;
  }, [study, settings]);

  return (
    <Panel
      className="solver-panel"
      title="Run on solver"
      right={
        <div className="solver-head-right">
          <select
            className="select"
            value={t}
            disabled={running}
            aria-label="Backend component profile"
            onChange={(e) => void selectComponent(e.target.value as ComponentType)}
          >
            {TYPES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {!online ? (
        <div className="note amber">
          <b>{backend.status === 'checking' ? 'Checking the backend…' : 'Backend offline.'}</b> Solver runs need the AutoTwin
          backend. Start it from <code>Backend\backend</code> with{' '}
          <code>.venv\Scripts\python -m uvicorn app.main:app --port 8000</code>.
        </div>
      ) : !profile || !settings ? (
        <div className="hint">{s.error ?? 'Loading the component profile…'}</div>
      ) : (
        <div className="solver-body">
          <div className="hint">
            <b>{profile.solver_name}.</b> {profile.method_statement}
          </div>

          <div className="solver-grid">
            <div className="solver-col">
              <div className="section-label">Engineering inputs</div>
              <div className="field">
                <div className="field-row">
                  <label className="field-label">Material</label>
                  <select
                    className="select"
                    value={settings.materialId}
                    disabled={running}
                    onChange={(e) => updateSettings(t, { materialId: e.target.value })}
                  >
                    {profile.materials.map((m) => (
                      <option key={m.material_id} value={m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {profile.engineering_inputs.map((f) => {
                const has = f.key in settings.inputs;
                const edited = settings.edited.includes(f.key);
                return (
                  <div className="field" key={f.key}>
                    <div className="field-row">
                      <label className="field-label" title={`${f.help_text} ${f.why_required}`}>
                        {f.label}
                        {!f.required && !/optional/i.test(f.label) && <small>optional</small>}
                      </label>
                      {has && <Badge kind={edited ? 'input' : 'demo'} />}
                      {has ? (
                        <NumberInput
                          value={settings.inputs[f.key]}
                          digits={Number.isInteger(settings.inputs[f.key]) ? 0 : 2}
                          label={f.label}
                          onCommit={(v) => setInput(t, f.key, v)}
                        />
                      ) : (
                        <button className="btn sm" disabled={running} onClick={() => setInput(t, f.key, 0)}>
                          Set
                        </button>
                      )}
                      <span className="unit">{f.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="solver-col">
              <div className="section-label">Study</div>
              <SliderField
                label="Generated candidates"
                hint="Plus the baseline. Design of experiments over the profile's design variables."
                value={settings.candidateBudget}
                min={1}
                max={10}
                step={1}
                onChange={(v) => updateSettings(t, { candidateBudget: Math.round(v) })}
              />
              <div className="field">
                <div className="field-row">
                  <label className="field-label">Mesh</label>
                  <select
                    className="select"
                    value={settings.meshPreset}
                    disabled={running}
                    onChange={(e) => updateSettings(t, { meshPreset: e.target.value as MeshPreset })}
                  >
                    {profile.mesh_presets.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="hint">{profile.mesh_presets.find((m) => m.key === settings.meshPreset)?.description}</div>
              </div>
              <Toggle
                label="Re-check the winner on a finer mesh"
                on={settings.verifyWinner}
                onChange={(v) => updateSettings(t, { verifyWinner: v })}
              />
              <div className="hint">
                {estimate
                  ? `Expected run time ≈ ${fmtDuration(estimate)} (from the last run's measured ${fmtDuration(study!.summary.mean_solve_seconds!)} per candidate${settings.verifyWinner ? ', plus the verification solve' : ''}).`
                  : 'Each candidate is a full 3D mesh and finite-element solve, so expect about a minute or more per candidate.'}
              </div>
            </div>
          </div>

          {usesDemo && assumptions.length > 0 && (
            <div className="solver-assume">
              <div className="section-label">Demo assumptions in use</div>
              <ul>
                {assumptions.map((a) => (
                  <li key={a.key}>{a.statement}</li>
                ))}
              </ul>
              <Toggle
                label="I accept these labelled demo assumptions for this run"
                on={settings.acceptDemoAssumptions}
                onChange={(v) => updateSettings(t, { acceptDemoAssumptions: v })}
              />
            </div>
          )}

          {s.validation && (
            <div className="note amber">
              <b>{s.validation.message}</b>
              <ul>
                {s.validation.missing_fields.map((f) => (
                  <li key={f.field}>
                    {f.label}: {f.why_required}
                  </li>
                ))}
                {s.validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {/* Already listed just above when the demo-assumption block is showing. */}
                {!(usesDemo && assumptions.length > 0) &&
                  s.validation.unconfirmed_assumptions.map((a) => <li key={a.key}>{a.statement}</li>)}
              </ul>
            </div>
          )}
          {s.error && <div className="note amber">{s.error}</div>}

          <div className="solver-actions">
            {running ? (
              <button className="btn danger" onClick={() => void cancelRun()}>
                Cancel run
              </button>
            ) : (
              <button className="btn primary" disabled={s.submitting} onClick={() => void startRun()}>
                {s.submitting ? 'Submitting…' : `Run ${settings.candidateBudget + 1} designs on the solver`}
              </button>
            )}
            {running && !runningHere && (
              <span className="hint">A {TYPES.find((x) => x.id === s.jobComponent)?.label.toLowerCase()} study is running.</span>
            )}
          </div>

          {s.job && (running || s.job.status !== 'completed') && <JobProgress />}
          {study && <StudyView study={study} />}
        </div>
      )}
    </Panel>
  );
}

function JobProgress() {
  const { job } = useSolver();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!job) return null;
  const started = parseUtc(job.started_at ?? job.created_at);
  const end = job.completed_at ? parseUtc(job.completed_at) : now;
  const elapsed = Number.isFinite(started) ? (end - started) / 1000 : null;
  return (
    <div className="solver-job">
      <div className="solver-job-row">
        <span className={`vtag ${job.status === 'failed' ? 'fail' : job.status === 'cancelled' ? 'review' : 'pass'}`}>{job.status}</span>
        <span>{job.message ?? job.stage}</span>
        {elapsed != null && elapsed >= 0 && <span className="muted">{fmtDuration(elapsed)}</span>}
      </div>
      <div className="solver-bar">
        <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
    </div>
  );
}

function StudyView({ study }: { study: StudyResult }) {
  const sm = study.summary;
  // Constraint columns from the first candidate that has a verdict for them.
  const constraints = useMemo(() => {
    const first = study.candidates.find((c) => c.constraint_results.length);
    return first?.constraint_results.map((r) => ({ id: r.constraint_id, label: r.label ?? r.metric })) ?? [];
  }, [study]);
  const massKey = study.candidates.find((c) => c.display_metrics.mass_kg)?.display_metrics.mass_kg ? 'mass_kg' : null;

  return (
    <div className="solver-study">
      <div className="solver-study-head">
        <div>
          <div className="section-label">Solver result</div>
          <div className="hint">
            {study.solver_name} · {study.mesh_preset} mesh · {sm.candidates_evaluated} solved, {sm.candidates_feasible} feasible,{' '}
            {sm.candidates_failed} failed
            {sm.total_seconds ? ` · ${fmtDuration(sm.total_seconds)}` : ''}
            {study.completed_at ? ` · finished ${new Date(parseUtc(study.completed_at)).toLocaleString()}` : ''}
          </div>
        </div>
      </div>
      {study.recommendation && (
        <div className={`note ${study.recommended_candidate_id ? '' : 'amber'}`}>{study.recommendation.statement}</div>
      )}

      {study.candidates.length === 0 ? (
        <div className="note amber">
          This run has no evaluated designs (status: {study.status}
          {study.termination_reason ? `, ${study.termination_reason}` : ''}).
        </div>
      ) : (
      <div className="table-scroll">
        <table className="data-table plain solver-table">
          <thead>
            <tr>
              <th>Design</th>
              <th>Status</th>
              {massKey && <th className="r">Mass</th>}
              {constraints.map((c) => (
                <th key={c.id} className="r">
                  {c.label}
                </th>
              ))}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {study.candidates.map((c) => (
              <CandidateRow
                key={c.candidate_id}
                c={c}
                constraints={constraints}
                massKey={massKey}
                recommended={c.candidate_id === study.recommended_candidate_id}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}

      {study.mesh_convergence.performed && <div className="hint">{study.mesh_convergence.statement}</div>}
      {study.warnings.length > 0 && (
        <details className="solver-warn">
          <summary>{study.warnings.length} solver warning{study.warnings.length === 1 ? '' : 's'}</summary>
          <ul>
            {study.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="disclaimer">
        Virtual-prototyping predictions under the configured model. Not a certification and not a substitute for physical validation.
      </div>
    </div>
  );
}

function CandidateRow({
  c,
  constraints,
  massKey,
  recommended,
}: {
  c: Candidate;
  constraints: { id: string; label: string }[];
  massKey: string | null;
  recommended: boolean;
}) {
  const st = STATUS[c.status] ?? { cls: 'review' as const, label: c.status.replace(/_/g, ' ') };
  const notes = c.failure_reason ? [c.failure_reason] : c.infeasibility_reasons;
  return (
    <tr className={recommended ? 'solver-rec' : ''}>
      <td>
        {c.is_baseline ? 'Baseline' : `Candidate ${c.index}`}
        {recommended && <span className="vtag pass solver-rec-tag">Recommended</span>}
      </td>
      <td>
        <span className={`vtag ${st.cls}`}>{st.label}</span>
      </td>
      {massKey && <td className="r">{fmtDV(c.display_metrics[massKey])}</td>}
      {constraints.map((k) => {
        const r = c.constraint_results.find((x) => x.constraint_id === k.id);
        if (!r) return <td key={k.id} className="r muted">—</td>;
        const lim = r.limit ?? r.upper ?? r.lower;
        return (
          <td key={k.id} className={`r ${r.passed === false ? 'solver-fail' : ''}`} title={`${r.description}${lim ? ` (limit ${fmtDV(lim)})` : ''}`}>
            {fmtDV(r.value)} {r.passed === true ? '✓' : r.passed === false ? '✗' : ''}
          </td>
        );
      })}
      <td className="solver-notes">{notes.join('; ') || (c.solve_time_seconds ? `solved in ${fmtDuration(c.solve_time_seconds)}` : '')}</td>
    </tr>
  );
}
