/**
 * State for backend solver studies, kept outside React so a run keeps polling
 * while the user is on another page, and resumes after a reload.
 *
 * One study at a time. The backend does the real work (CadQuery geometry →
 * Gmsh mesh → scikit-fem solve → constraint checks); this module only submits
 * the request, polls the job and loads the stored result.
 */
import { ApiValidationError, api, pollJob } from './client';
import type { ComponentType, Job, Profile, StudyRequest, StudyResult, ValidationResponse } from './types';

export type MeshPreset = StudyRequest['mesh_preset'];

export interface RunSettings {
  materialId: string;
  /** Display-unit values, keyed by engineering input key (as the profile lists them). */
  inputs: Record<string, number>;
  /** Keys the user changed, so the UI can label the rest as demo fixtures. */
  edited: string[];
  candidateBudget: number;
  meshPreset: MeshPreset;
  verifyWinner: boolean;
  acceptDemoAssumptions: boolean;
}

export interface SolverState {
  componentType: ComponentType;
  profiles: Partial<Record<ComponentType, Profile>>;
  settings: Partial<Record<ComponentType, RunSettings>>;
  /** The job being watched (any component type). */
  job: Job | null;
  jobComponent: ComponentType | null;
  /** Last loaded study result per component type. */
  study: Partial<Record<ComponentType, StudyResult>>;
  submitting: boolean;
  error: string | null;
  validation: ValidationResponse | null;
}

const LS = {
  component: (t: ComponentType) => `autotwin.solver.component.${t}`,
  lastRun: (t: ComponentType) => `autotwin.solver.lastRun.${t}`,
  activeJob: 'autotwin.solver.activeJob',
};
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the run still works, it just won't resume after reload */
  }
};

let state: SolverState = {
  componentType: 'brake_caliper',
  profiles: {},
  settings: {},
  job: null,
  jobComponent: null,
  study: {},
  submitting: false,
  error: null,
  validation: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SolverState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const solverStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function defaultSettings(p: Profile): RunSettings {
  const inputs: Record<string, number> = {};
  for (const f of p.engineering_inputs) if (f.demo_default_display != null) inputs[f.key] = f.demo_default_display;
  return {
    materialId: p.materials[0]?.material_id ?? '',
    inputs,
    edited: [],
    candidateBudget: 3,
    meshPreset: 'screening',
    verifyWinner: false,
    acceptDemoAssumptions: false,
  };
}

const loading = new Set<ComponentType>();

/** Select a component type and make sure its profile and last stored result are loaded. */
export async function selectComponent(t: ComponentType) {
  set({ componentType: t, error: null, validation: null });
  if (state.profiles[t] || loading.has(t)) return;
  loading.add(t);
  try {
    const profile = await api.profile(t);
    set({
      profiles: { ...state.profiles, [t]: profile },
      settings: { ...state.settings, [t]: state.settings[t] ?? defaultSettings(profile) },
    });
    const runId = lsGet(LS.lastRun(t));
    if (runId && !state.study[t]) {
      try {
        const study = await api.study(runId);
        set({ study: { ...state.study, [t]: study } });
      } catch {
        lsSet(LS.lastRun(t), null); // the backend no longer has it (fresh database)
      }
    }
  } catch (err) {
    if (state.componentType === t) set({ error: (err as Error).message });
  } finally {
    loading.delete(t);
  }
}

export function updateSettings(t: ComponentType, patch: Partial<RunSettings>) {
  const cur = state.settings[t];
  if (!cur) return;
  set({ settings: { ...state.settings, [t]: { ...cur, ...patch } }, validation: null });
}

export function setInput(t: ComponentType, key: string, value: number) {
  const cur = state.settings[t];
  if (!cur) return;
  updateSettings(t, {
    inputs: { ...cur.inputs, [key]: value },
    edited: cur.edited.includes(key) ? cur.edited : [...cur.edited, key],
  });
}

/** The backend needs a project + component record per study. Reuse one per type. */
async function ensureComponent(p: Profile): Promise<string> {
  const saved = lsGet(LS.component(p.component_type));
  if (saved) {
    try {
      return (await api.component(saved)).id;
    } catch {
      /* gone (fresh database): create a new one */
    }
  }
  const project = await api.createProject(`${p.display_name} — Experiment solver runs`);
  const comp = await api.createComponent({
    project_id: project.id,
    component_type: p.component_type,
    design_mode: 'generate_new',
    name: `${p.display_name} (Experiment)`,
  });
  lsSet(LS.component(p.component_type), comp.id);
  return comp.id;
}

function buildRequest(p: Profile, s: RunSettings, componentId: string): StudyRequest {
  return {
    component_instance_id: componentId,
    material_id: s.materialId,
    objective_summary: p.summary,
    engineering_inputs: s.inputs,
    parameters: Object.fromEntries(p.parameters.map((x) => [x.name, x.default])),
    design_variables: [...p.design_variables],
    objectives: p.objectives.map((o) => o.objective_id),
    strategy: 'doe',
    candidate_budget: s.candidateBudget,
    population_size: 4,
    generations: 1,
    mesh_preset: s.meshPreset,
    verify_winner: s.verifyWinner,
    random_seed: 20261104,
    time_budget_seconds: null,
    confirm_demo_assumptions: s.acceptDemoAssumptions,
  };
}

let watching: AbortController | null = null;

async function watch(jobId: string, t: ComponentType) {
  watching?.abort();
  const ctrl = new AbortController();
  watching = ctrl;
  lsSet(LS.activeJob, JSON.stringify({ jobId, t }));
  try {
    const job = await pollJob(jobId, (j) => set({ job: j, jobComponent: t }), { signal: ctrl.signal, intervalMs: 2000 });
    lsSet(LS.activeJob, null);
    if (job.status === 'completed' && job.optimization_run_id) {
      const study = await api.study(job.optimization_run_id);
      lsSet(LS.lastRun(t), study.optimization_run_id);
      set({ study: { ...state.study, [t]: study } });
    } else if (job.status === 'failed') {
      set({ error: job.error ?? 'The study failed on the backend.' });
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') set({ error: (err as Error).message });
  } finally {
    if (watching === ctrl) watching = null;
  }
}

export async function startRun() {
  const t = state.componentType;
  const p = state.profiles[t];
  const s = state.settings[t];
  if (!p || !s || state.submitting) return;
  set({ submitting: true, error: null, validation: null });
  try {
    const componentId = await ensureComponent(p);
    const accepted = await api.startStudy(buildRequest(p, s, componentId));
    set({ job: null, jobComponent: t });
    void watch(accepted.job_id, t);
  } catch (err) {
    if (err instanceof ApiValidationError) set({ validation: err.response });
    else set({ error: (err as Error).message });
  } finally {
    set({ submitting: false });
  }
}

export async function cancelRun() {
  if (!state.job) return;
  try {
    await api.cancelJob(state.job.id);
  } catch (err) {
    set({ error: (err as Error).message });
  }
}

export function isActive(job: Job | null) {
  return !!job && (job.status === 'queued' || job.status === 'running');
}

/** Pick up a job that was still running when the page was reloaded. */
let resumed = false;
export function resumeIfNeeded() {
  if (resumed) return;
  resumed = true;
  const raw = lsGet(LS.activeJob);
  if (!raw) return;
  try {
    const { jobId, t } = JSON.parse(raw) as { jobId: string; t: ComponentType };
    void watch(jobId, t);
  } catch {
    lsSet(LS.activeJob, null);
  }
}
