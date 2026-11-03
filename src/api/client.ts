/**
 * Typed client for the AutoTwin FastAPI backend (Backend/backend).
 *
 * In dev, requests go to the same origin under /api and Vite proxies them to
 * the backend (see vite.config.ts), so there is no CORS setup and no hard-coded
 * port in the browser. Set VITE_API_BASE to call a backend directly instead.
 *
 * A 422 with missing_fields / unconfirmed_assumptions is an engineering
 * validation response, not a crash. It is thrown as ApiValidationError so the UI
 * can show the engineer exactly what to supply.
 */
import type {
  Candidate,
  Capabilities,
  ComponentInstance,
  ComponentType,
  CostEstimate,
  CostInputs,
  EstimateRequest,
  EstimateResult,
  Explanation,
  Job,
  JobAccepted,
  Profile,
  Project,
  RequirementDraft,
  StudyRequest,
  StudyResult,
  ValidationResponse,
  VisualizationPayload,
} from './types';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiValidationError extends Error {
  readonly response: ValidationResponse;
  constructor(response: ValidationResponse) {
    super(response.message);
    this.name = 'ApiValidationError';
    this.response = response;
  }
}

/** The backend could not be reached at all (not started, wrong port). */
export class BackendUnreachableError extends Error {
  constructor() {
    super(
      'Cannot reach the AutoTwin backend. Start it from Backend/backend with: ' +
        '.venv\\Scripts\\python -m uvicorn app.main:app --port 8000',
    );
    this.name = 'BackendUnreachableError';
  }
}

function looksLikeValidation(data: unknown): data is ValidationResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    ('missing_fields' in data || 'unconfirmed_assumptions' in data || 'errors' in data)
  );
}

type Query = Record<string, string | number | boolean | null | undefined>;

async function request<T>(method: 'GET' | 'POST', path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${API_BASE}/api${path}${qs.size ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: opts.signal,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new BackendUnreachableError();
  }

  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data: unknown = isJson && text ? JSON.parse(text) : text;

  if (res.ok) return data as T;
  // Vite's proxy answers 502/504 when the backend process isn't running.
  if ((res.status === 502 || res.status === 504) && !isJson) throw new BackendUnreachableError();
  if (res.status === 422 && looksLikeValidation(data)) {
    throw new ApiValidationError({
      ok: false,
      message: data.message,
      missing_fields: data.missing_fields ?? [],
      errors: data.errors ?? [],
      unconfirmed_assumptions: data.unconfirmed_assumptions ?? [],
    });
  }
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  throw new Error(`${method} ${path} failed: HTTP ${res.status}`);
}

const get = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });

export interface Health {
  status: string;
  app: string;
  environment: string;
  python: string;
  platform: string;
  component_profiles: ComponentType[];
  llm_configured: boolean;
}

export const api = {
  health: (signal?: AbortSignal) => get<Health>('/health', undefined, signal),
  capabilities: (runBenchmarks = false) => get<Capabilities>('/capabilities', { run_benchmarks: runBenchmarks }),

  profiles: () => get<Profile[]>('/components/profiles'),
  profile: (componentType: ComponentType) => get<Profile>(`/components/profiles/${componentType}`),

  listProjects: () => get<Project[]>('/projects'),
  createProject: (name: string, description?: string) => post<Project>('/projects', { name, description }),
  listComponents: (projectId: string) => get<ComponentInstance[]>(`/projects/${projectId}/components`),
  createComponent: (body: { project_id: string; component_type: ComponentType; design_mode: string; name: string }) =>
    post<ComponentInstance>('/components', body),

  validateStudy: (req: StudyRequest) => post<Record<string, unknown>>('/studies/validate', req),
  startStudy: (req: StudyRequest) => post<JobAccepted>('/studies', req),
  listStudies: (componentInstanceId?: string) =>
    get<Array<Record<string, unknown>>>('/studies', { component_instance_id: componentInstanceId }),
  study: (runId: string) => get<StudyResult>(`/studies/${runId}`),

  job: (jobId: string) => get<Job>(`/jobs/${jobId}`),
  jobLog: (jobId: string) => get<string>(`/jobs/${jobId}/log`),
  cancelJob: (jobId: string) => post<Record<string, unknown>>(`/jobs/${jobId}/cancel`),

  candidate: (id: string) => get<Candidate>(`/candidates/${id}`),
  candidateDiagnostics: (id: string) => get<Record<string, unknown>>(`/candidates/${id}/diagnostics`),
  visualization: (id: string, deformationScale?: number) =>
    get<VisualizationPayload>(`/candidates/${id}/visualization`, { deformation_scale: deformationScale }),

  /** Reduced-order estimate for live slider feedback. Never a solver result. */
  estimatePreview: (req: EstimateRequest) => post<EstimateResult>('/estimate/preview', req),

  interpret: (text: string, componentType?: ComponentType) =>
    post<RequirementDraft>('/assistant/interpret', { text, component_type: componentType ?? null, use_llm: true }),
  assistantStatus: () => get<Record<string, unknown>>('/assistant/status'),
  explainCandidate: (id: string) => get<Explanation>(`/assistant/explain/candidate/${id}`),
  explainStudy: (runId: string) => get<Explanation>(`/assistant/explain/study/${runId}`),

  estimateCost: (inputs: CostInputs) => post<CostEstimate>('/cost/estimate', inputs),
  costTemplate: () => get<Record<string, unknown>>('/cost/template'),

  generateReport: (runId: string) => post<Record<string, unknown>>('/reports/generate', { optimization_run_id: runId }),
  reportMarkdown: (runId: string) => get<string>(`/reports/${runId}/markdown`),

  /** Backend asset paths start with /api/assets/...; this makes them loadable. */
  assetUrl: (path: string) => `${API_BASE}${path}`,
};

/** Poll a job until it finishes, reporting progress as it goes. */
export async function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  options: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<Job> {
  const interval = options.intervalMs ?? 1500;
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('polling aborted', 'AbortError');
    const job = await api.job(jobId);
    onUpdate(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job;
    await new Promise((r) => setTimeout(r, interval));
  }
}
