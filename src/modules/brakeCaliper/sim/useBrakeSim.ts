import { createContext, useContext } from 'react';
import { useStoreVersion } from '../../../core/useStoreVersion';
import type { BrakeSim } from './brakeModel';

export const BrakeSimContext = createContext<BrakeSim | null>(null);

export function useBrakeSim(): BrakeSim {
  const sim = useContext(BrakeSimContext);
  if (!sim) throw new Error('useBrakeSim must be used inside <BrakeSimContext.Provider>');
  return sim;
}

/**
 * Re-renders the component whenever the sim publishes an update (about 15
 * times a second while running, straight away after user actions).
 * The 3D parts don't use this. They read `sim.state` directly every frame.
 */
export function useSimSnapshot(): BrakeSim {
  const sim = useBrakeSim();
  useStoreVersion(sim);
  return sim;
}

/** Brake fluid colour for a pressure: amber at 0 MPa, orange at 5, red at 10 and up. Used by the 3D and the UI. */
export function pressureColor(mpa: number): string {
  const t = Math.max(0, Math.min(1, mpa / 10));
  const stops = [
    [250, 204, 21], // 0 MPa  amber-400
    [249, 115, 22], // 5 MPa  orange-500
    [220, 38, 38], //  10 MPa red-600
  ];
  const seg = t < 0.5 ? 0 : 1;
  const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const c = stops[seg].map((v, i) => Math.round(v + (stops[seg + 1][i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
