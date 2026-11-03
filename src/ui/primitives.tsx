import type { ReactNode } from 'react';

export type BadgeKind = 'input' | 'derived' | 'model' | 'estimated' | 'theoretical' | 'demo' | 'drawing' | 'assumed';
const BADGE_TEXT: Record<BadgeKind, string> = {
  input: 'Input',
  derived: 'Derived',
  model: 'Model',
  estimated: 'Estimated',
  theoretical: 'Theoretical',
  demo: 'Demo fixture',
  drawing: 'Drawing',
  assumed: 'Assumed',
};
const BADGE_TIP: Record<BadgeKind, string> = {
  input: 'Value set by you',
  derived: 'Exact kinematic/unit relation of an input or model value',
  model: 'Output of the simplified illustrative model — not a validated measurement',
  estimated: 'Reduced-order estimate (lumped model) — trend indicator only',
  theoretical: 'Ideal relation (e.g. four-stroke N/120), not a measurement',
  demo: 'Placeholder value you can overwrite — not solver output or test data',
  drawing: 'Read directly off the reference drawing',
  assumed: 'Not dimensioned on the drawing, or read from an unclear view: an assumption you can change',
};

export function Badge({ kind, label }: { kind: BadgeKind; label?: string }) {
  return (
    <span className={`badge ${kind}`} title={BADGE_TIP[kind]}>
      {label ?? BADGE_TEXT[kind]}
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClass = 'panel-body',
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          {title && <div className="panel-title">{title}</div>}
          {right}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? 'active' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Number field with a slider underneath, like the Spark Plug dashboard. */
export function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  digits = 0,
  badge,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  badge?: ReactNode;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <div className="field-row">
        <label className="field-label">
          {label}
          {hint && <small>{hint}</small>}
        </label>
        {badge}
        <NumberInput value={value} digits={digits} onCommit={(v) => onChange(clamp(v))} label={String(label)} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={typeof label === 'string' ? label : undefined}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Number input that only commits on blur or Enter, so re-renders don't fight you while typing. */
export function NumberInput({
  value,
  digits = 0,
  onCommit,
  label,
}: {
  value: number;
  digits?: number;
  onCommit: (v: number) => void;
  label?: string;
}) {
  return (
    <input
      key={value.toFixed(digits)}
      className="num"
      inputMode="decimal"
      aria-label={label}
      defaultValue={value.toFixed(digits)}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
        else e.target.value = value.toFixed(digits);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).value = value.toFixed(digits);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Toggle({ label, on, onChange }: { label: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`switch ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
      />
    </div>
  );
}

export const fmt = (v: number, d = 0) => {
  if (!Number.isFinite(v)) return '—';
  // Don't show "-0.00" for values that round to zero.
  const r = Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v;
  return r.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
