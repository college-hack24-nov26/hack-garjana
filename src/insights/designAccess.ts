/**
 * Small helpers so the insight rules can treat both components the same way:
 * read a design, try a change on it, re-validate it, and describe a parameter.
 */
import {
  CALIPER_MATERIALS,
  CALIPER_PARAMS,
  ELECTRODE_MATERIALS,
  INSULATOR_MATERIALS,
  PLUG_PARAMS,
  findMaterial,
} from '../workspace/designs.ts';
import type { CaliperDesign, ComponentId, ParamSpec, PlugDesign, Slot } from '../workspace/designs.ts';
import { validateCaliper, validatePlug } from '../workspace/validation.ts';
import type { DesignValidation, ValidationSource } from '../workspace/validation.ts';

export type AnyDesign = CaliperDesign | PlugDesign;
type Choice = { id: string; name: string };

export interface ParamMeta {
  key: string;
  label: string;
  unit: string;
  /** Numeric parameters have a spec; material choices have options. */
  spec?: ParamSpec<string>;
  options?: Choice[];
}

const CHOICES: Record<ComponentId, Record<string, { label: string; options: Choice[] }>> = {
  'brake-caliper': { materialId: { label: 'Material', options: CALIPER_MATERIALS } },
  'spark-plug': {
    insulatorId: { label: 'Insulator', options: INSULATOR_MATERIALS },
    electrodeId: { label: 'Centre electrode', options: ELECTRODE_MATERIALS },
  },
};

export function paramMeta(component: ComponentId, key: string): ParamMeta {
  const choice = CHOICES[component][key];
  if (choice) return { key, label: choice.label, unit: '', options: choice.options };
  const specs = (component === 'brake-caliper' ? CALIPER_PARAMS : PLUG_PARAMS) as ParamSpec<string>[];
  const spec = specs.find((s) => s.key === key);
  return { key, label: spec?.label ?? key, unit: spec?.unit ?? '', spec };
}

export function formatParam(component: ComponentId, key: string, value: number | string): string {
  const meta = paramMeta(component, key);
  if (meta.options) return findMaterial(meta.options, String(value)).name;
  const digits = meta.spec?.digits ?? 2;
  const unit = meta.unit && meta.unit !== '–' ? ` ${meta.unit}` : '';
  return `${Number(value).toFixed(digits)}${unit}`;
}

export function getDesign(src: ValidationSource, component: ComponentId, slot: Slot): AnyDesign {
  return component === 'brake-caliper' ? src.caliper[slot] : src.plug[slot];
}

export function paramValue(design: AnyDesign, key: string): number | string {
  return (design as unknown as Record<string, number | string>)[key];
}

export function withPatch<T extends AnyDesign>(design: T, patch: Record<string, number | string>): T {
  return { ...design, ...patch } as T;
}

/** Validates a (possibly modified) design B the same way the workspace does. */
export function validateCandidate(src: ValidationSource, component: ComponentId, design: AnyDesign): DesignValidation {
  return component === 'brake-caliper'
    ? validateCaliper('B', design as CaliperDesign, src.caliperInputs, src.caliper.A)
    : validatePlug('B', design as PlugDesign, src.plugInputs);
}
