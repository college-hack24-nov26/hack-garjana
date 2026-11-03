import { useEffect, useRef, useState } from 'react';
import { ABLabViewer } from '../insights/focus/FocusViewer';
import { paramMeta } from '../insights/designAccess';
import { Badge, Panel } from '../ui/primitives';
import type { ComponentId } from '../workspace/designs';
import { useWorkspace } from '../workspace/useWorkspace';
import './lab3d.css';

/** Remembered while you move between pages. */
let shownPref = true;

/** The parameter that differs between two snapshots of the A/B pair (the one just edited). */
function editedKey(prev: string | null, next: string): string | null {
  if (!prev) return null;
  const p = JSON.parse(prev) as Record<'A' | 'B', Record<string, unknown>>;
  const n = JSON.parse(next) as Record<'A' | 'B', Record<string, unknown>>;
  for (const slot of ['B', 'A'] as const) {
    for (const k of Object.keys(n[slot])) if (k !== 'revision' && p[slot][k] !== n[slot][k]) return k;
  }
  return null;
}

/**
 * Design Lab 3D: design A and design B side by side. When you move a slider,
 * both models zoom to the part that parameter shapes, so the change is easy
 * to see. Reduced-order geometry built from the Design Lab parameters.
 */
export function LabAB3D() {
  const ws = useWorkspace();
  const c: ComponentId = ws.component;
  const designs = c === 'brake-caliper' ? ws.caliper : ws.plug;
  const snapshot = JSON.stringify(designs);
  const prev = useRef<{ c: ComponentId; snap: string } | null>(null);
  const [focus, setFocus] = useState<{ c: ComponentId; key: string } | null>(null);
  const [shown, setShown] = useState(shownPref);

  useEffect(() => {
    const before = prev.current && prev.current.c === c ? prev.current.snap : null;
    const k = editedKey(before, snapshot);
    if (k) setFocus({ c, key: k });
    prev.current = { c, snap: snapshot };
  }, [c, snapshot]);

  const focusKey = focus && focus.c === c ? focus.key : null;
  const right = (
    <div className="panel-actions">
      <Badge kind="estimated" label="Parametric geometry" />
      <button
        className="btn sm"
        onClick={() => {
          shownPref = !shown;
          setShown(!shown);
        }}
      >
        {shown ? 'Hide 3D' : 'Show 3D'}
      </button>
    </div>
  );
  const title = focusKey ? `3D · A vs B · ${paramMeta(c, focusKey).label}` : '3D · A vs B';

  return (
    <Panel className={`lab3d-panel ${shown ? '' : 'collapsed'}`} title={title} right={right}>
      {shown ? (
        <>
          <ABLabViewer src={ws} component={c} designs={designs} focusKey={focusKey} />
          <div className="hint lab3d-hint">
            Move any slider below: both models zoom to the part it changes and show its value. Drag either view to look
            around; the other follows, so A and B are always compared at the same scale. The caliper&apos;s mouth
            opening is drawn ×60.
          </div>
        </>
      ) : (
        <div className="hint">3D view hidden.</div>
      )}
    </Panel>
  );
}
