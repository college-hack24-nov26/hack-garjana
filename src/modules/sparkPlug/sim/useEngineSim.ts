import { createContext, useContext } from 'react';
import { useStoreVersion } from '../../../core/useStoreVersion';
import type { EngineSim } from './engineSim';

export const EngineSimContext = createContext<EngineSim | null>(null);

export function useEngineSim(): EngineSim {
  const sim = useContext(EngineSimContext);
  if (!sim) throw new Error('useEngineSim must be used inside <EngineSimContext.Provider>');
  return sim;
}

/** Re-renders when the sim publishes (about 15 times a second while running). The 3D parts read `sim.state` every frame instead. */
export function useEngineSnapshot(): EngineSim {
  const sim = useEngineSim();
  useStoreVersion(sim);
  return sim;
}
