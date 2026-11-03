/**
 * The wheel's own A/B design store for the Design Lab. It's kept separate from
 * the workspace store, so the caliper and plug pages are untouched. Saved
 * in this browser only; it starts fresh if storage is blocked.
 */
import { useSyncExternalStore } from 'react';
import { SimStore } from '../../../core/SimStore.ts';
import { DESIGN_SPECS, sanitizeDesign } from '../wheel/drawing.ts';
import { WHEEL_BASELINE, WHEEL_LAB_DEFAULTS, estimateWheel, overallVerdict, wheelChecks } from './evaluate.ts';
import type { WheelEstimate, WheelLabInputs, WheelSlot, WheelVariant } from './evaluate.ts';
import type { RuleResult, Verdict } from '../../../workspace/validation.ts';

const KEY = 'autotwin.wheelLab.v1';

/**
 * Starting candidate: slimmer legs and arms, spokes 2 mm deeper at the rim to win
 * the bending stiffness back. About 180 g lighter and still passes; go thinner and
 * the cornering rig fails, which is the trade-off the lab is for.
 */
export const WHEEL_CANDIDATE: WheelVariant = {
  ...WHEEL_BASELINE,
  revision: 'AW-B rev 0.1 (slimmer spokes)',
  legWidthMm: 19,
  armWidthMm: 32,
  spokeDepthRimMm: 22,
};

interface Saved {
  active: boolean;
  A: WheelVariant;
  B: WheelVariant;
  inputs: WheelLabInputs;
}

export class WheelLabStore extends SimStore {
  /** True while the Design Lab shows the wheel instead of the caliper/plug workspace. */
  active = false;
  designs: Record<WheelSlot, WheelVariant> = { A: { ...WHEEL_BASELINE }, B: { ...WHEEL_CANDIDATE } };
  inputs: WheelLabInputs = { ...WHEEL_LAB_DEFAULTS };
  estimates!: Record<WheelSlot, WheelEstimate>;
  checks!: Record<WheelSlot, RuleResult[]>;
  verdicts!: Record<WheelSlot, Verdict>;

  constructor(load = true) {
    super();
    if (load) this.load();
    this.evaluate();
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.commit();
  }
  setDesign(slot: WheelSlot, patch: Partial<WheelVariant>) {
    const merged = { ...this.designs[slot], ...patch };
    this.designs[slot] = { ...merged, ...sanitizeDesign(merged) };
    this.commit();
  }
  setInputs(patch: Partial<WheelLabInputs>) {
    this.inputs = { ...this.inputs, ...patch };
    this.commit();
  }
  copyAToB() {
    this.designs.B = { ...this.designs.A, revision: this.designs.B.revision };
    this.commit();
  }
  resetSlot(slot: WheelSlot) {
    this.designs[slot] = slot === 'A' ? { ...WHEEL_BASELINE } : { ...WHEEL_CANDIDATE };
    this.commit();
  }
  resetInputs() {
    this.inputs = { ...WHEEL_LAB_DEFAULTS };
    this.commit();
  }

  /** Parameters that differ between A and B, for the diff table. */
  diffs() {
    const { A, B } = this.designs;
    const rows = [
      { label: 'Y-spokes', unit: '–', digits: 0, A: A.spokeCount, B: B.spokeCount },
      ...DESIGN_SPECS.map((s) => ({ label: s.label, unit: s.unit, digits: s.digits, A: A[s.key], B: B[s.key] })),
      { label: 'Junction Kt', unit: '–', digits: 2, A: A.kt, B: B.kt },
    ];
    return rows;
  }

  private evaluate() {
    const e = { A: estimateWheel(this.designs.A, this.inputs), B: estimateWheel(this.designs.B, this.inputs) };
    this.estimates = e;
    this.checks = { A: wheelChecks(this.designs.A, e.A, this.inputs), B: wheelChecks(this.designs.B, e.B, this.inputs) };
    this.verdicts = { A: overallVerdict(this.checks.A), B: overallVerdict(this.checks.B) };
  }

  private commit() {
    this.evaluate();
    this.save();
    this.emit();
  }

  private save() {
    try {
      const data: Saved = { active: this.active, A: this.designs.A, B: this.designs.B, inputs: this.inputs };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage blocked: keep working in memory */
    }
  }

  private load() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Saved>;
      const fix = (v: Partial<WheelVariant> | undefined, base: WheelVariant): WheelVariant => {
        const m = { ...base, ...(v ?? {}) };
        return { ...m, ...sanitizeDesign(m) };
      };
      this.active = !!d.active;
      this.designs = { A: fix(d.A, WHEEL_BASELINE), B: fix(d.B, WHEEL_CANDIDATE) };
      this.inputs = { ...WHEEL_LAB_DEFAULTS, ...(d.inputs ?? {}) };
    } catch {
      /* corrupt or blocked: start from the defaults */
    }
  }
}

let shared: WheelLabStore | null = null;
export function getWheelLab() {
  if (!shared) shared = new WheelLabStore();
  return shared;
}

/** The shared wheel lab, re-rendering on every change. */
export function useWheelLab() {
  const lab = getWheelLab();
  useSyncExternalStore(lab.subscribe, lab.getVersion);
  return lab;
}
