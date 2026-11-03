import { useEffect, useMemo, useState } from 'react';
import { useStoreVersion } from '../core/useStoreVersion';
import { workspace } from '../workspace/useWorkspace';
import { buildInsightContext } from './context.ts';
import { explainLocally } from './explain/localProvider.ts';
import { activeProvider, explainWithGuardrails } from './explain/provider.ts';
import type { GuardedExplanation } from './explain/provider.ts';
import { requiredCaveats } from './explain/guardrails.ts';
import type { InsightContext } from './types.ts';

/**
 * Everything the AI Insights page shows, recomputed whenever the workspace
 * changes. The local explanation is shown at once; if the active provider is
 * slower (a future backend model), its guarded answer replaces it when it lands.
 */
export function useInsights() {
  const version = useStoreVersion(workspace);
  const ctx = useMemo<InsightContext>(() => buildInsightContext(workspace), [version]);
  const provider = activeProvider();
  const instant = useMemo(() => {
    const e = explainLocally(ctx);
    return { ...e, caveats: requiredCaveats(ctx) };
  }, [ctx]);

  const [result, setResult] = useState<{ ctx: InsightContext; r: GuardedExplanation } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    explainWithGuardrails(provider, ctx, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setResult({ ctx, r });
      })
      .catch(() => {
        /* aborted: a newer context is already being explained */
      });
    return () => ac.abort();
  }, [ctx, provider]);

  const current = result && result.ctx === ctx ? result.r : null;
  return {
    ws: workspace,
    ctx,
    provider,
    explanation: current?.explanation ?? instant,
    pending: !current,
    fellBack: current?.fellBack ?? false,
    violations: current?.violations ?? [],
  };
}
