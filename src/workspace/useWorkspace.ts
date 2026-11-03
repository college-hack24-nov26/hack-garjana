import { useStoreVersion } from '../core/useStoreVersion';
import { WorkspaceStore } from './WorkspaceStore';

/** One workspace for the whole app. */
export const workspace = new WorkspaceStore();

if (import.meta.env.DEV) (window as unknown as { __workspace: WorkspaceStore }).__workspace = workspace;

/** Re-renders the caller whenever the workspace changes. */
export function useWorkspace() {
  useStoreVersion(workspace);
  return workspace;
}
