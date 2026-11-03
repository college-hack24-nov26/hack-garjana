import type { ReactNode } from 'react';
import { SECTIONS, navigate } from '../app/routes';
import type { SectionId } from '../app/routes';
import { recheckBackend, useBackend } from '../api/useBackend';

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
      {b.status === 'offline' ? 'Backend offline' : 'Backend…'}
    </button>
  );
}

/**
 * AutoTwin app shell: top nav and sidebar, both driven by the hash route.
 * The status chips only say what's true: whether the sim is running, and
 * whether the solver backend is reachable right now.
 */
export function AppShell({ children, active, running }: { children: ReactNode; active: SectionId; running: boolean }) {
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/dashboard">
          <span className="brand-mark">A</span>
          AutoTwin
          <span className="brand-tag">R&amp;D</span>
        </a>
        <nav className="topnav" aria-label="Primary">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={s.id === active ? 'active' : ''}
              aria-current={s.id === active ? 'page' : undefined}
              onClick={() => navigate({ section: s.id })}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className={`status-chip ${running ? 'amber' : ''}`}>{running ? 'Sim running' : 'Sim idle'}</span>
          <BackendChip />
          <span className="user">R&amp;D Engineer</span>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={s.id === active ? 'active' : ''}
              aria-current={s.id === active ? 'page' : undefined}
              onClick={() => navigate({ section: s.id })}
            >
              <span className="icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
          <div className="spacer" />
          <div className="side-note">
            Simplified models and reduced-order estimates. Not solver-verified.
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
