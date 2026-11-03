import { useEffect, useState } from 'react';

/**
 * Hash routing for the whole workspace. Hash URLs need no server config and
 * survive a reload, and the app is small enough that a router library would be
 * overkill.
 *
 *   #/dashboard   #/design-lab   #/experiment   #/digital-twin/brake-caliper
 *   #/analytics   #/ai-insights  #/digital-twin/spark-plug
 *   #/reports                    #/digital-twin/alloy-wheel
 *
 * The older links #/brake-caliper and #/spark-plug still open the Digital Twin pages.
 */
export type SectionId =
  | 'dashboard'
  | 'design-lab'
  | 'experiment'
  | 'digital-twin'
  | 'analytics'
  | 'ai-insights'
  | 'reports';

export type TwinModule = 'alloy-wheel' | 'brake-caliper' | 'spark-plug';

export interface Route {
  section: SectionId;
  /** Only used by the Digital Twin section. */
  module: TwinModule;
}

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'design-lab', label: 'Design Lab', icon: '○' },
  { id: 'experiment', label: 'Experiment', icon: '◷' },
  { id: 'digital-twin', label: 'Digital Twin', icon: '◉' },
  { id: 'analytics', label: 'Analytics', icon: '▤' },
  { id: 'ai-insights', label: 'AI Insights', icon: '✦' },
  { id: 'reports', label: 'Reports', icon: '▥' },
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // Old module links from before the workspace existed.
  if (parts[0] === 'brake-caliper' || parts[0] === 'spark-plug') return { section: 'digital-twin', module: parts[0] };
  const section = SECTION_IDS.has(parts[0]) ? (parts[0] as SectionId) : 'dashboard';
  const module: TwinModule = parts[1] === 'spark-plug' || parts[1] === 'alloy-wheel' ? parts[1] : 'brake-caliper';
  return { section, module };
}

export function routeHash(r: Partial<Route> & { section: SectionId }) {
  return r.section === 'digital-twin' ? `#/digital-twin/${r.module ?? 'brake-caliper'}` : `#/${r.section}`;
}

export function navigate(r: Partial<Route> & { section: SectionId }) {
  const h = routeHash(r);
  if (window.location.hash !== h) window.location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      document.querySelector('.main')?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
