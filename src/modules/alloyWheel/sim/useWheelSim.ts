import { createContext, useContext } from 'react';
import { useStoreVersion } from '../../../core/useStoreVersion';
import type { WheelSim } from './wheelModel';
import type { BuildClock } from '../wheel/build';

export const WheelSimContext = createContext<WheelSim | null>(null);
export const BuildClockContext = createContext<BuildClock | null>(null);

export function useWheelSim(): WheelSim {
  const sim = useContext(WheelSimContext);
  if (!sim) throw new Error('useWheelSim must be used inside <WheelSimContext.Provider>');
  return sim;
}

/** Re-renders on every published update (~15 Hz while running). The 3D reads `sim.state` directly instead. */
export function useWheelSnapshot(): WheelSim {
  const sim = useWheelSim();
  useStoreVersion(sim);
  return sim;
}

export function useBuildClock(): BuildClock {
  const c = useContext(BuildClockContext);
  if (!c) throw new Error('useBuildClock must be used inside <BuildClockContext.Provider>');
  return c;
}

/* ------------------------------------------------------------------ */
/*  Stress colour scale, 0 → fatigue strength at 10⁷ cycles            */
/* ------------------------------------------------------------------ */
const STOPS: [number, [number, number, number]][] = [
  [0, [37, 99, 235]], //   blue-600
  [0.25, [6, 182, 212]], // cyan-500
  [0.5, [34, 197, 94]], // green-500
  [0.75, [234, 179, 8]], // yellow-500
  [1, [239, 68, 68]], //   red-500
];

/** Colour for a stress fraction u = σ / σ_ref, as 0..1 RGB. Values above 1 stay red. */
export function stressRGB(u: number, out: [number, number, number] = [0, 0, 0]) {
  const x = Math.max(0, Math.min(1, u));
  let i = 0;
  while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++;
  const [x0, c0] = STOPS[i];
  const [x1, c1] = STOPS[i + 1];
  const k = (x - x0) / (x1 - x0);
  for (let j = 0; j < 3; j++) out[j] = (c0[j] + (c1[j] - c0[j]) * k) / 255;
  return out;
}

export const stressCss = (u: number) => {
  const [r, g, b] = stressRGB(u);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

export const STRESS_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([x, c]) => `rgb(${c.join(',')}) ${x * 100}%`).join(', ')})`;
