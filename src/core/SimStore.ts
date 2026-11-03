/**
 * Small base class for each module's sim. The 3D driver updates the sim in
 * place every frame. React only re-renders when emit() is called, which is
 * throttled to about 15 times a second while running and immediate for user
 * actions.
 */
export class SimStore {
  running = false;
  private listeners = new Set<() => void>();
  private version = 0;
  private lastEmit = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  protected emit(throttled = false) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (throttled && this.running && now - this.lastEmit < 66) return;
    this.lastEmit = now;
    this.version++;
    this.listeners.forEach((l) => l());
  }
}
