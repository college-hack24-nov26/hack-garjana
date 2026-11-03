/**
 * What the 3D focus view should show: design B now, design B with a change,
 * which parameters changed, and which parts of the model to light up.
 */
import type { ComponentId } from '../../workspace/designs.ts';
import { PARAM_EFFECT } from '../chat/engine.ts';
import type { Patch } from '../chat/optimizer.ts';
import type { InsightSource } from '../context.ts';
import { getDesign, paramMeta, withPatch } from '../designAccess.ts';
import type { AnyDesign } from '../designAccess.ts';
import { utilisation } from '../findings.ts';
import type { InsightContext } from '../types.ts';

export type PartId = 'insulator' | 'nose' | 'electrode' | 'tip' | 'bridge' | 'ribs' | 'legs' | 'slot' | 'pistons' | 'body';

export const PART_LABEL: Record<PartId, string> = {
  insulator: 'insulator',
  nose: 'insulator nose',
  electrode: 'centre electrode',
  tip: 'firing end',
  bridge: 'bridge',
  ribs: 'bridge ribs',
  legs: 'caliper legs',
  slot: 'disc slot and pads',
  pistons: 'pistons',
  body: 'caliper body',
};

const PARTS_OF: Record<string, PartId[]> = {
  noseLengthMm: ['nose'],
  noseDiaMm: ['nose'],
  electrodeDiaMm: ['electrode'],
  protrusionMm: ['tip'],
  electrodeId: ['electrode'],
  insulatorId: ['insulator', 'nose'],
  bridgeMm: ['bridge'],
  ribCount: ['ribs'],
  ribMm: ['ribs'],
  legWallMm: ['legs'],
  bodyHeightMm: ['legs', 'slot'],
  slotDepthFrac: ['slot'],
  bodyLengthMm: ['body'],
  discSlotMm: ['slot'],
  pistonBoreMm: ['pistons'],
  pistonsPerSide: ['pistons'],
  materialId: ['body'],
};

/** The model parts that a set of parameters changes (for highlighting). */
export function partsOf(keys: string[]): PartId[] {
  return [...new Set(keys.flatMap((k) => PARTS_OF[k] ?? []))];
}

export interface FocusRequest {
  title: string;
  patch: Patch;
  why?: string;
  /** Parameters to light up when there is no change to show. */
  highlight?: string[];
}

export interface FocusSpec {
  component: ComponentId;
  title: string;
  why?: string;
  from: AnyDesign;
  to: AnyDesign;
  /** Parameters that change (or are highlighted). */
  keys: string[];
  parts: PartId[];
  /** False when there is nothing to morph, only a part to point at. */
  changed: boolean;
  /** What the two ends of the morph are called, e.g. Now / Proposed or A / B. */
  labels: { from: string; to: string };
}

export function buildFocus(src: InsightSource, req: FocusRequest): FocusSpec {
  const component = src.component;
  const from = getDesign(src, component, 'B');
  const to = withPatch(from, req.patch);
  const changedKeys = Object.keys(req.patch).filter((k) => (from as unknown as Record<string, unknown>)[k] !== req.patch[k]);
  const keys = changedKeys.length ? changedKeys : (req.highlight ?? []);
  const parts = [...new Set(keys.flatMap((k) => PARTS_OF[k] ?? []))];
  return {
    component,
    title: req.title,
    why: req.why ?? (keys.length ? keys.map((k) => PARAM_EFFECT[k]).filter(Boolean).join(' ') : undefined),
    from,
    to,
    keys,
    parts,
    changed: changedKeys.length > 0,
    labels: { from: 'Now', to: 'Proposed' },
  };
}

/**
 * Design A morphing into design B, with everything that differs lit up and
 * labelled (materials included). Pass `designs` to show a stored pair, e.g. the
 * designs as they were when an experiment ran; otherwise the current A and B.
 */
export function abFocus(src: InsightSource, component: ComponentId = src.component, designs?: { A: AnyDesign; B: AnyDesign }): FocusSpec {
  const from = designs?.A ?? getDesign(src, component, 'A');
  const to = designs?.B ?? getDesign(src, component, 'B');
  const a = from as unknown as Record<string, unknown>;
  const b = to as unknown as Record<string, unknown>;
  const keys = Object.keys(b).filter((k) => k !== 'revision' && a[k] !== b[k]);
  return {
    component,
    title: `${a.revision as string} → ${b.revision as string}`,
    why: keys.length ? keys.slice(0, 2).map((k) => PARAM_EFFECT[k]).filter(Boolean).join(' ') : 'A and B are identical.',
    from,
    to,
    keys,
    parts: [...new Set(keys.flatMap((k) => PARTS_OF[k] ?? []))],
    changed: keys.length > 0,
    labels: { from: 'A', to: 'B' },
  };
}

/** The top recommendation, or else what drives the check closest to its limit. */
export function defaultFocus(ctx: InsightContext): FocusRequest {
  const rec = ctx.recommendations[0];
  if (rec) return { title: rec.title, patch: rec.patch, why: rec.rationale };
  const est = ctx.validation.B.results.filter((r) => r.basis === 'estimated');
  const gov = est.length ? est.reduce((m, r) => (utilisation(r) > utilisation(m) ? r : m)) : ctx.validation.B.results[0];
  const key = gov.parameters.find((p) => !!paramMeta(ctx.component, p).spec) ?? gov.parameters[0];
  return {
    title: `${gov.label}: what drives it`,
    patch: {},
    highlight: [key],
    why: PARAM_EFFECT[key],
  };
}

/** Design part-way between `from` (p = 0) and `to` (p = 1). Materials switch halfway. */
export function lerpDesign<T extends AnyDesign>(from: T, to: T, p: number): T {
  const a = from as unknown as Record<string, number | string>;
  const b = to as unknown as Record<string, number | string>;
  const out: Record<string, number | string> = { ...a };
  for (const k of Object.keys(b)) {
    const x = a[k];
    const y = b[k];
    out[k] = typeof x === 'number' && typeof y === 'number' ? x + (y - x) * p : p < 0.5 ? x : y;
  }
  return out as unknown as T;
}
