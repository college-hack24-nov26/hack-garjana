/**
 * "Build from drawing": a short visual sequence that assembles the wheel in
 * the order the drawing describes it. It's purely an animation, with no
 * simulation in it; the wheel holds still while it plays.
 */
import { SimStore } from '../../../core/SimStore.ts';

export type BuildPart = 'rim' | 'hub' | 'spokes' | 'bolts' | 'cap' | 'tyre';

export const BUILD_STEPS: { id: BuildPart; t0: number; t1: number; title: string; ref: string }[] = [
  { id: 'rim', t0: 0.3, t1: 2.6, title: 'Revolve the rim profile', ref: 'Detail B · Ø520 × 256 · 60° well walls' },
  { id: 'hub', t0: 2.6, t1: 3.8, title: 'Hub boss and mounting pad', ref: 'Section A-A · Ø180 / Ø140 · 50 deep · face 70 in' },
  { id: 'spokes', t0: 3.8, t1: 6.6, title: 'Y-spokes', ref: 'Front view · fork R165 · legs 90 apart · R15 blends · faces 10° / 15°' },
  { id: 'bolts', t0: 6.6, t1: 8.0, title: 'Bolt holes and wheel bolts', ref: '5× Ø10 ↧55 · ⌴Ø20 ↧10 · 72° pitch' },
  { id: 'cap', t0: 8.0, t1: 8.8, title: 'Centre cap', ref: 'Detail C · Ø60 (generic emblem)' },
  { id: 'tyre', t0: 8.8, t1: 10.4, title: 'Mount and inflate the tyre', ref: 'Illustrative 275/35 section, not on the drawing' },
];

export const BUILD_DURATION = 11;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 0..1 progress of one part at build time t. */
export function partProgress(id: BuildPart, t: number) {
  const s = BUILD_STEPS.find((b) => b.id === id)!;
  return smooth((t - s.t0) / (s.t1 - s.t0));
}

/** Staggered 0..1 progress of item k of n within a part (spokes, bolts). */
export function itemProgress(id: BuildPart, t: number, k: number, n: number) {
  const s = BUILD_STEPS.find((b) => b.id === id)!;
  const x = (t - s.t0) / (s.t1 - s.t0); // 0..1 over the step
  const span = 1 / (0.6 * n + 0.4);
  return smooth((x - k * 0.6 * span) / span);
}

export function currentStep(t: number) {
  return BUILD_STEPS.find((b) => t >= b.t0 && t < b.t1) ?? (t < BUILD_STEPS[0].t0 ? BUILD_STEPS[0] : null);
}

/** Clock for the build sequence. At rest it sits at the end, so everything is drawn. */
export class BuildClock extends SimStore {
  t = BUILD_DURATION;

  get active() {
    return this.running;
  }
  start() {
    this.t = 0;
    this.running = true;
    this.emit();
  }
  stop() {
    this.t = BUILD_DURATION;
    this.running = false;
    this.emit();
  }
  advance(dt: number) {
    if (!this.running) return;
    this.t = Math.min(BUILD_DURATION, this.t + Math.min(dt, 0.1));
    if (this.t >= BUILD_DURATION) {
      this.running = false;
      this.emit();
    } else this.emit(true);
  }
}
