import type { ReactNode } from 'react';
import type { SectionId } from '../app/routes';

/** Line icons for the sidebar, drawn on a 24px grid and stroked with currentColor. */
const PATHS: Record<SectionId, ReactNode> = {
  dashboard: (
    <path d="M3 10.5 12 3l9 7.5M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
  ),
  'design-lab': (
    <>
      <path d="M12 3v3M12 6l-6.5 14M12 6l6.5 14" />
      <circle cx="12" cy="6" r="1.8" />
      <path d="M7.2 16.5c3 1.4 6.6 1.4 9.6 0" />
    </>
  ),
  experiment: (
    <>
      <path d="M9 3h6M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3" />
      <path d="M7.3 14h9.4" />
    </>
  ),
  'digital-twin': (
    <>
      <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
      <path d="M4 7.4l8 4.6 8-4.6M12 12v9.2" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 17l5.5-5.5 4 4L21 7" />
      <path d="M15 7h6v6" />
    </>
  ),
  'ai-insights': (
    <>
      <path d="M11 3.5l1.6 4.4a2 2 0 0 0 1.2 1.2L18.2 10.7l-4.4 1.6a2 2 0 0 0-1.2 1.2L11 17.9l-1.6-4.4a2 2 0 0 0-1.2-1.2L3.8 10.7l4.4-1.6a2 2 0 0 0 1.2-1.2z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  reports: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
};

export function NavIcon({ id }: { id: SectionId }) {
  return (
    <svg
      className="at-nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[id]}
    </svg>
  );
}
