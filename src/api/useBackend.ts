import { useEffect, useState } from 'react';
import { api } from './client';
import type { Health } from './client';

export type BackendState =
  | { status: 'checking' }
  | { status: 'online'; health: Health }
  | { status: 'offline'; error: string };

const POLL_MS = 15_000;

/**
 * Live backend connection status, shared by every component that asks for it
 * so the app polls /api/health once, not once per caller.
 */
let current: BackendState = { status: 'checking' };
const listeners = new Set<(s: BackendState) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function check() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const health = await api.health(ctrl.signal);
    current = { status: 'online', health };
  } catch (err) {
    current = { status: 'offline', error: (err as Error).name === 'AbortError' ? 'Health check timed out' : (err as Error).message };
  } finally {
    clearTimeout(t);
  }
  listeners.forEach((l) => l(current));
  if (listeners.size) timer = setTimeout(check, POLL_MS);
}

export function recheckBackend() {
  clearTimeout(timer);
  void check();
}

export function useBackend(): BackendState {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) recheckBackend();
    else setState(current);
    return () => {
      listeners.delete(setState);
      if (!listeners.size) clearTimeout(timer);
    };
  }, []);
  return state;
}
