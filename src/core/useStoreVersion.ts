import { useSyncExternalStore } from 'react';
import type { SimStore } from './SimStore';

/** Re-render the caller whenever `store` publishes. */
export function useStoreVersion(store: SimStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
