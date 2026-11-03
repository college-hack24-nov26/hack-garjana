/** The module switcher in each page header, styled like AutoTwin's segmented control. */
export type ModuleId = 'alloy-wheel' | 'brake-caliper' | 'spark-plug';

export const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'alloy-wheel', label: 'Alloy Wheel' },
  { id: 'brake-caliper', label: 'Brake Caliper' },
  { id: 'spark-plug', label: 'Spark Plug' },
];

/**
 * `available` limits which modules can be picked (the others show disabled with
 * `unavailableTitle` as the tooltip). Leave it out to allow all three.
 */
export function ModuleSwitch<T extends ModuleId>({
  value,
  onChange,
  available,
  unavailableTitle = 'Not included in this build',
}: {
  value: T;
  onChange: (m: T) => void;
  available?: readonly T[];
  unavailableTitle?: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Component module">
      {MODULES.map((m) => {
        const ok = !available || (available as readonly ModuleId[]).includes(m.id);
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={value === m.id}
            className={value === m.id ? 'active' : ''}
            disabled={!ok}
            title={ok ? undefined : unavailableTitle}
            onClick={() => ok && onChange(m.id as T)}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
