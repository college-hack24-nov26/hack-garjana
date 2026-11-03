import { Children, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import './twinWorkspace.css';

type Side = 'left' | 'right';

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v === '1';
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

/**
 * Digital Twin layout: [left inspector] [3D stage] [right inspector].
 * Expects exactly three children in that order. Both inspectors can be
 * collapsed (they stay mounted, so their inputs keep their state) and the
 * choice is remembered per browser. "Focus stage" hides both at once.
 */
export function TwinWorkspace({
  children,
  leftLabel = 'Parameters',
  rightLabel = 'Telemetry',
}: {
  children: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const [left, right] = [readOpen('autotwin.twin.left', true), readOpen('autotwin.twin.right', true)];
  const [open, setOpen] = useState<Record<Side, boolean>>({ left, right });
  const set = useCallback((next: Record<Side, boolean>) => {
    setOpen(next);
    try {
      localStorage.setItem('autotwin.twin.left', next.left ? '1' : '0');
      localStorage.setItem('autotwin.twin.right', next.right ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  const [l, stage, r] = Children.toArray(children);
  const focused = !open.left && !open.right;

  return (
    <div className="tw-wrap">
      <div className="tw-bar" role="toolbar" aria-label="Workspace layout">
        <button
          className={`tw-toggle ${open.left ? 'on' : ''}`}
          aria-pressed={open.left}
          aria-controls="tw-left"
          onClick={() => set({ ...open, left: !open.left })}
          title={`${open.left ? 'Hide' : 'Show'} ${leftLabel.toLowerCase()} inspector`}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="2.5" y="3.5" width="5.5" height="13" rx="2" fill={open.left ? 'currentColor' : 'none'} opacity="0.55" />
          </svg>
          {leftLabel}
        </button>
        <button
          className={`tw-toggle ${focused ? 'on' : ''}`}
          aria-pressed={focused}
          onClick={() => set(focused ? { left: true, right: true } : { left: false, right: false })}
          title={focused ? 'Show both inspectors' : 'Hide both inspectors and give the model the full width'}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {focused ? 'Exit focus' : 'Focus stage'}
        </button>
        <button
          className={`tw-toggle ${open.right ? 'on' : ''}`}
          aria-pressed={open.right}
          aria-controls="tw-right"
          onClick={() => set({ ...open, right: !open.right })}
          title={`${open.right ? 'Hide' : 'Show'} ${rightLabel.toLowerCase()} inspector`}
        >
          {rightLabel}
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="12" y="3.5" width="5.5" height="13" rx="2" fill={open.right ? 'currentColor' : 'none'} opacity="0.55" />
          </svg>
        </button>
      </div>
      <div className={`workspace tw ${open.left ? '' : 'no-left'} ${open.right ? '' : 'no-right'}`}>
        <div className="tw-left" id="tw-left" hidden={!open.left}>
          {l}
        </div>
        <div className="tw-stage">{stage}</div>
        <div className="tw-right" id="tw-right" hidden={!open.right}>
          {r}
        </div>
      </div>
    </div>
  );
}
