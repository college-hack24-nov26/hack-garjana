/**
 * The workspace: the A/B designs for each component, the engineering inputs
 * they're checked against, and the experiment runs recorded so far. Every page
 * outside the Digital Twin reads from this one object.
 *
 * It's saved to localStorage so a reload doesn't lose your work. That's only a
 * convenience in this browser: there's no backend, so nothing is shared or
 * kept anywhere else, and the app works the same if storage is blocked.
 */
import { SimStore } from '../core/SimStore.ts';
import {
  CALIPER_BASELINE,
  CALIPER_INPUT_DEFAULTS,
  PLUG_BASELINE,
  PLUG_INPUT_DEFAULTS,
} from './designs.ts';
import type { CaliperDesign, CaliperInputs, ComponentId, PlugDesign, PlugInputs, Slot } from './designs.ts';

export interface RunMetric {
  key: string;
  label: string;
  unit: string;
  A: number;
  B: number;
  digits: number;
  /** True when a smaller number is the better result. Null when neither direction is better. */
  lowerIsBetter: boolean | null;
}

export interface RunSeries {
  title: string;
  xLabel: string;
  yUnit: string;
  points: { x: number; A: number; B: number }[];
  /** Optional horizontal band to draw, e.g. the plug's heat-range window. */
  band?: { min: number; max: number; label: string };
}

export interface ExperimentRun {
  id: string;
  createdAt: number;
  component: ComponentId;
  kind: string;
  title: string;
  revisions: { A: string; B: string };
  /** Which badge the numbers carry: 'model' = simplified dynamics, 'estimated' = reduced-order estimate. */
  source: 'model' | 'estimated';
  conditions: string;
  metrics: RunMetric[];
  series: RunSeries[];
  feasible: { A: boolean; B: boolean };
  /**
   * Designs A and B exactly as they were tested, so the 3D view and the
   * "what changed" table match the numbers even after the Design Lab is edited.
   * Runs saved before this field existed don't have it.
   */
  designs?: Record<Slot, CaliperDesign> | Record<Slot, PlugDesign>;
}

export interface ActivityEntry {
  t: number;
  text: string;
}

interface Saved {
  version: 1;
  component: ComponentId;
  caliper: Record<Slot, CaliperDesign>;
  caliperInputs: CaliperInputs;
  plug: Record<Slot, PlugDesign>;
  plugInputs: PlugInputs;
  runs: ExperimentRun[];
  activity: ActivityEntry[];
}

const KEY = 'autotwin.workspace.v1';
const MAX_RUNS = 40;
const MAX_ACTIVITY = 30;

function freshCaliper(): Record<Slot, CaliperDesign> {
  return { A: { ...CALIPER_BASELINE }, B: { ...CALIPER_BASELINE, revision: 'BC-B rev 0.1' } };
}
function freshPlug(): Record<Slot, PlugDesign> {
  return { A: { ...PLUG_BASELINE }, B: { ...PLUG_BASELINE, revision: 'SP-B rev 0.1' } };
}

export class WorkspaceStore extends SimStore {
  component: ComponentId = 'brake-caliper';
  caliper = freshCaliper();
  caliperInputs: CaliperInputs = { ...CALIPER_INPUT_DEFAULTS };
  plug = freshPlug();
  plugInputs: PlugInputs = { ...PLUG_INPUT_DEFAULTS };
  runs: ExperimentRun[] = [];
  activity: ActivityEntry[] = [];
  /** Has localStorage been readable and writable this session? */
  persistent = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(load = true) {
    super();
    if (load) this.load();
  }

  setComponent(c: ComponentId) {
    if (c === this.component) return;
    this.component = c;
    this.changed();
  }

  setCaliper(slot: Slot, patch: Partial<CaliperDesign>) {
    this.caliper = { ...this.caliper, [slot]: { ...this.caliper[slot], ...patch } };
    this.changed();
  }
  setPlug(slot: Slot, patch: Partial<PlugDesign>) {
    this.plug = { ...this.plug, [slot]: { ...this.plug[slot], ...patch } };
    this.changed();
  }
  setCaliperInputs(patch: Partial<CaliperInputs>) {
    this.caliperInputs = { ...this.caliperInputs, ...patch };
    this.changed();
  }
  setPlugInputs(patch: Partial<PlugInputs>) {
    this.plugInputs = { ...this.plugInputs, ...patch };
    this.changed();
  }

  /** Copy design A's geometry and material into B, keeping B's revision name. */
  copyAToB(c: ComponentId) {
    if (c === 'brake-caliper') this.setCaliper('B', { ...this.caliper.A, revision: this.caliper.B.revision });
    else this.setPlug('B', { ...this.plug.A, revision: this.plug.B.revision });
    this.log(`${c === 'brake-caliper' ? 'Caliper' : 'Plug'}: copied design A into B`);
  }

  resetSlot(c: ComponentId, slot: Slot) {
    if (c === 'brake-caliper') this.setCaliper(slot, freshCaliper()[slot]);
    else this.setPlug(slot, freshPlug()[slot]);
    this.log(`${c === 'brake-caliper' ? 'Caliper' : 'Plug'}: reset design ${slot} to the baseline`);
  }

  resetInputs(c: ComponentId) {
    if (c === 'brake-caliper') this.setCaliperInputs({ ...CALIPER_INPUT_DEFAULTS });
    else this.setPlugInputs({ ...PLUG_INPUT_DEFAULTS });
  }

  addRun(run: Omit<ExperimentRun, 'id' | 'createdAt'>) {
    const full: ExperimentRun = { ...run, id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
    this.runs = [full, ...this.runs].slice(0, MAX_RUNS);
    this.log(`Experiment: ${run.title} (${run.revisions.A} vs ${run.revisions.B})`, false);
    this.changed();
    return full;
  }
  removeRun(id: string) {
    this.runs = this.runs.filter((r) => r.id !== id);
    this.changed();
  }
  clearRuns() {
    this.runs = [];
    this.log('Cleared all experiment runs', false);
    this.changed();
  }

  log(text: string, emit = true) {
    this.activity = [{ t: Date.now(), text }, ...this.activity].slice(0, MAX_ACTIVITY);
    if (emit) this.changed();
  }

  /** Back to an empty workspace (baseline designs, default inputs, no runs). */
  resetAll() {
    this.caliper = freshCaliper();
    this.plug = freshPlug();
    this.caliperInputs = { ...CALIPER_INPUT_DEFAULTS };
    this.plugInputs = { ...PLUG_INPUT_DEFAULTS };
    this.runs = [];
    this.activity = [];
    this.log('Workspace reset to the baseline designs');
  }

  private changed() {
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 250);
  }

  private snapshot(): Saved {
    return {
      version: 1,
      component: this.component,
      caliper: this.caliper,
      caliperInputs: this.caliperInputs,
      plug: this.plug,
      plugInputs: this.plugInputs,
      runs: this.runs,
      activity: this.activity,
    };
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.snapshot()));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.persistent = true;
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Saved>;
      if (s.version !== 1) return;
      // Merge over the defaults so a field added later still gets a value.
      if (s.component === 'brake-caliper' || s.component === 'spark-plug') this.component = s.component;
      if (s.caliper) this.caliper = { A: { ...CALIPER_BASELINE, ...s.caliper.A }, B: { ...CALIPER_BASELINE, ...s.caliper.B } };
      if (s.plug) this.plug = { A: { ...PLUG_BASELINE, ...s.plug.A }, B: { ...PLUG_BASELINE, ...s.plug.B } };
      if (s.caliperInputs) this.caliperInputs = { ...CALIPER_INPUT_DEFAULTS, ...s.caliperInputs };
      if (s.plugInputs) this.plugInputs = { ...PLUG_INPUT_DEFAULTS, ...s.plugInputs };
      if (Array.isArray(s.runs)) this.runs = s.runs;
      if (Array.isArray(s.activity)) this.activity = s.activity;
    } catch {
      this.persistent = false;
    }
  }
}
