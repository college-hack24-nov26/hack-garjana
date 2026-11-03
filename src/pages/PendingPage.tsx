import { SECTIONS } from '../app/routes';
import type { SectionId } from '../app/routes';
import { Panel } from '../ui/primitives';

/** Temporary page for sections that are still being built. */
export function PendingPage({ section }: { section: SectionId }) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? section;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{label}</h1>
          <div className="page-sub">In progress</div>
        </div>
      </div>
      <Panel>
        <div className="disclaimer">This section is still being built.</div>
      </Panel>
    </div>
  );
}
