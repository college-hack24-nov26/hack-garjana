import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SECTIONS, navigate, useRoute } from '../app/routes';
import type { SectionId, TwinModule } from '../app/routes';
import { recheckBackend, useBackend } from '../api/useBackend';
import { NavIcon } from './NavIcons';
import { SidebarArt } from './SidebarArt';
import { CommandPalette } from './CommandPalette';
import './shell.css';

/** Live connection to the FastAPI backend. Click to re-check. */
function BackendChip() {
  const b = useBackend();
  if (b.status === 'online') {
    const h = b.health;
    return (
      <button
        className="status-chip green"
        onClick={recheckBackend}
        title={`Backend connected: ${h.app} (${h.environment}), Python ${h.python}. Profiles: ${h.component_profiles.join(', ')}. LLM ${h.llm_configured ? 'configured' : 'not configured'}.`}
      >
        <span className="at-dot" aria-hidden="true" />
        Backend online
      </button>
    );
  }
  return (
    <button
      className={`status-chip ${b.status === 'offline' ? 'amber' : ''}`}
      onClick={recheckBackend}
      title={b.status === 'offline' ? `${b.error} Click to re-check.` : 'Checking backend…'}
    >
      <span className="at-dot" aria-hidden="true" />
      {b.status === 'offline' ? 'Backend offline' : 'Backend…'}
    </button>
  );
}

/** Navigation grouped by purpose. Ids missing from SECTIONS (routes.ts) are skipped. */
const NAV_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'Workspace', ids: ['dashboard'] },
  { label: 'Engineering', ids: ['design-lab', 'experiment', 'digital-twin'] },
  { label: 'Analysis', ids: ['analytics', 'ai-insights'] },
  { label: 'Output', ids: ['reports'] },
];

const TWIN_LABEL: Record<TwinModule, string> = {
  'brake-caliper': 'Brake Caliper',
  'spark-plug': 'Spark Plug',
  'alloy-wheel': 'Alloy Wheel',
};

const RAIL_KEY = 'autotwin.rail.collapsed';
function readRail(): boolean {
  try {
    const v = localStorage.getItem(RAIL_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* storage unavailable: fall back to the width default */
  }
  return typeof window !== 'undefined' && window.innerWidth < 1280;
}

/**
 * AutoTwin app shell.
 *  - One global navigation: a grouped left rail that collapses to icons
 *    (button, Ctrl+B, or automatically below 960px). No duplicate top nav.
 *  - A contextual top bar: where you are (section and twin module), honest
 *    status (twin playback is an illustrative animation, never a solver job;
 *    backend reachability), the command palette (Ctrl+K) and the user.
 */
export function AppShell({ children, active, running }: { children: ReactNode; active: SectionId; running: boolean }) {
  const route = useRoute();
  const [collapsed, setCollapsed] = useState(readRail);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  const rail = collapsed || narrow;
  const labelOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.label ?? id;
  const known = new Set<SectionId>(SECTIONS.map((s) => s.id));
  const groups = NAV_GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => known.has(id)) })).filter((g) => g.ids.length);
  // A section added to routes.ts later still gets a link even before it is grouped.
  const grouped = new Set(groups.flatMap((g) => g.ids));
  const extra = SECTIONS.filter((s) => !grouped.has(s.id)).map((s) => s.id);
  if (extra.length) groups.push({ label: 'More', ids: extra });

  return (
    <div className={`at-shell ${rail ? 'rail' : ''}`}>
      <aside className="at-side" aria-label="Sections">
        {!rail && <SidebarArt />}
        <a className="at-logo" href="#/dashboard" aria-label="AutoTwin home">
          {rail ? (
            <span className="at-mono-mark" aria-hidden="true">
              A<span>T</span>
            </span>
          ) : (
            <>
              <span className="at-wordmark">
                AUTO<span className="at-wordmark-accent">TWIN</span>
              </span>
              <span className="at-tagline">Precision Engineering Studio</span>
            </>
          )}
        </a>
        <nav className="at-nav" aria-label="Primary">
          {groups.map((g) => (
            <div className="at-nav-group" key={g.label} role="group" aria-label={g.label}>
              <div className="at-nav-label">{g.label}</div>
              {g.ids.map((id) => (
                <button
                  key={id}
                  className={id === active ? 'active' : ''}
                  aria-current={id === active ? 'page' : undefined}
                  title={rail ? labelOf(id) : undefined}
                  aria-label={rail ? labelOf(id) : undefined}
                  onClick={() => navigate({ section: id })}
                >
                  <NavIcon id={id} />
                  <span className="at-nav-text">{labelOf(id)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="at-side-foot">
          {!rail && (
            <>
              <div className="at-foot-name">AUTOTWIN</div>
              <div className="at-foot-ver">v0.1.0 · Virtual prototyping</div>
              <div className="at-foot-note">Live twins use simplified models; solver runs come from the backend.</div>
            </>
          )}
          {!narrow && (
            <button
              className="at-rail-toggle"
              onClick={toggleRail}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d={collapsed ? 'M11 8l2 2-2 2' : 'M13 8l-2 2 2 2'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {!rail && <span>Collapse sidebar</span>}
            </button>
          )}
        </div>
      </aside>
      <div className="at-content">
        <header className="topbar">
          <nav className="at-crumb" aria-label="Breadcrumb">
            <span className="at-crumb-root">AutoTwin</span>
            <span className="at-crumb-sep" aria-hidden="true">/</span>
            <span className={`at-crumb-page ${active === 'digital-twin' ? 'mid' : ''}`}>{labelOf(active)}</span>
            {active === 'digital-twin' && (
              <>
                <span className="at-crumb-sep" aria-hidden="true">/</span>
                <span className="at-crumb-page">{TWIN_LABEL[route.module]}</span>
              </>
            )}
          </nav>
          <div className="topbar-right">
            {active === 'digital-twin' && (
              <span
                className={`status-chip ${running ? 'green' : ''}`}
                title="Playback of the twin's simplified illustrative model in your browser. An animation, not a solver job."
              >
                <span className="at-dot" aria-hidden="true" />
                {running ? 'Playback running' : 'Playback paused'}
              </span>
            )}
            <BackendChip />
            <button
              className="at-search"
              onClick={() => window.dispatchEvent(new Event('autotwin:palette'))}
              aria-label="Open command palette (Ctrl+K)"
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="at-search-text">Jump to…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="at-user" title="Signed-in role">
              <span className="at-avatar" aria-hidden="true">RD</span>
              <span className="at-user-name">R&amp;D Engineer</span>
            </span>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      <CommandPalette onToggleRail={toggleRail} />
    </div>
  );
}
