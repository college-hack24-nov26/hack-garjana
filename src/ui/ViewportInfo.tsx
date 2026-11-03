import type { ReactNode } from 'react';
import './viewportInfo.css';

/**
 * The "about this view" card in the top-left of a 3D viewport. It starts
 * closed as a small pill so it never covers the model; clicking the pill opens
 * the full description. Built on <details> so it is keyboard- and
 * screen-reader-friendly without any state.
 */
export function ViewportInfo({ children, label = 'Model info' }: { children: ReactNode; label?: string }) {
  return (
    <details className="vp-info vp-info-drop">
      <summary>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {label}
        <svg className="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="vp-info-body">{children}</div>
    </details>
  );
}
