import type { ComponentId } from '../workspace/designs';
import { ModuleSwitch } from './ModuleSwitch';

const WORKSPACE_COMPONENTS: readonly ComponentId[] = ['brake-caliper', 'spark-plug'];

/**
 * The Alloy Wheel | Brake Caliper | Spark Plug switch, bound to a workspace component.
 * The workspace (Design Lab, Experiment, Insights) models the caliper and plug; the
 * wheel so far exists only as a Digital Twin, so it shows disabled here.
 */
export function ComponentSwitch({ value, onChange }: { value: ComponentId; onChange: (c: ComponentId) => void }) {
  return (
    <ModuleSwitch<ComponentId>
      value={value}
      onChange={onChange}
      available={WORKSPACE_COMPONENTS}
      unavailableTitle="The alloy wheel is available as a Digital Twin only; the workspace doesn't model it yet"
    />
  );
}
