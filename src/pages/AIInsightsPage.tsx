import { Fragment, useEffect, useState } from 'react';
import { navigate } from '../app/routes';
import { ComponentSwitch } from '../shell/ComponentSwitch';
import { Badge, Panel, SliderField } from '../ui/primitives';
import { getDesign, paramMeta, paramValue, validateCandidate } from '../insights/designAccess';
import type { AnyDesign } from '../insights/designAccess';
import { utilisation } from '../insights/findings';
import type { Finding, InsightContext, Recommendation } from '../insights/types';
import { useInsights } from '../insights/useInsights';
import { ChatPanel, ChatProviderChip } from '../insights/chat/ChatPanel';
import { chatStore } from '../insights/chat/instance';
import { describePatch } from '../insights/chat/optimizer';
import type { Patch } from '../insights/chat/optimizer';
import { FocusViewer } from '../insights/focus/FocusViewer';
import { buildFocus, defaultFocus } from '../insights/focus/focusSpec';
import type { FocusRequest } from '../insights/focus/focusSpec';
import type { CaliperDesign, ComponentId, PlugDesign, Slot } from '../workspace/designs';
import { VERDICT_LABEL } from '../workspace/validation';
import type { DesignValidation, RuleResult } from '../workspace/validation';
import type { WorkspaceStore } from '../workspace/WorkspaceStore';
import { VerdictTag, marginText } from './shared';

/**
 * AI Insights: why each design passes or fails, what drives it, and which
 * change to candidate B would fix it. Verdicts come from the validation engine;
 * the explanation text comes from the active provider (local rules here).
 */
export function AIInsightsPage() {
  const { ws, ctx, provider, explanation, fellBack, violations } = useInsights();
  const c = ctx.component;
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<{ component: ComponentId; title: string; design: AnyDesign }[]>([]);
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const undoable = undoStack.filter((u) => u.component === c);

  // A different component starts from its own default focus.
  useEffect(() => setFocusReq(null), [c]);

  const setB = (patch: Record<string, number | string>) => {
    if (c === 'brake-caliper') ws.setCaliper('B', patch as Partial<CaliperDesign>);
    else ws.setPlug('B', patch as Partial<PlugDesign>);
  };
  const remember = (title: string) =>
    setUndoStack((s) => [...s, { component: c, title, design: getDesign(ws, c, 'B') }].slice(-10));
  const tell = (text: string, withUndo = false) =>
    chatStore.add({ role: 'assistant', component: c, source: 'local-rules', text, actions: withUndo ? [{ kind: 'undo', label: 'Undo' }] : [] });

  const applyPatch = (patch: Patch, title: string, fromChat = false) => {
    if (!Object.keys(patch).length) return;
    remember(title);
    setB(patch);
    ws.log(`AI Insights: applied "${title}" to candidate B`);
    const v = validateCandidate(ws, c, getDesign(ws, c, 'B'));
    if (fromChat) {
      tell(`Applied to candidate B: ${title}.${NL}B is now ${VERDICT_LABEL[v.verdict]} (${v.counts.pass} pass, ${v.counts.review} review, ${v.counts.fail} fail).`, true);
    }
    setFocusReq(null);
  };
  const apply = (rec: Recommendation) => applyPatch(rec.patch, rec.title);
  const undoLast = () => {
    const last = undoable[undoable.length - 1];
    if (!last) {
      tell('There is nothing to undo.');
      return;
    }
    setB(last.design as unknown as Record<string, number | string>);
    setUndoStack((s) => {
      const i = s.lastIndexOf(last);
      return s.filter((_, j) => j !== i);
    });
    ws.log(`AI Insights: undid "${last.title}"`);
    tell(`Undone: ${last.title}. B is back to how it was before that change.`);
  };

  const finalize = () => {
    const plan = chatStore.plans[c];
    const before = getDesign(ws, c, 'B');
    const vBefore = validateCandidate(ws, c, before);
    const changes = describePatch(c, before, plan);
    if (changes.length) {
      remember('Finalize decision');
      setB(plan);
    }
    const vAfter = validateCandidate(ws, c, getDesign(ws, c, 'B'));
    chatStore.recordDecision({
      component: c,
      revisionB: before.revision,
      changes,
      verdictBefore: vBefore.verdict,
      verdictAfter: vAfter.verdict,
      counts: vAfter.counts,
      questions: chatStore.questions(c).slice(-8),
    });
    chatStore.clearPlan(c);
    ws.log(`AI Insights: decision recorded for ${before.revision} (${VERDICT_LABEL[vAfter.verdict]})`);
    tell(
      [
        `Decision recorded for ${before.revision}.`,
        changes.length ? `Applied: ${changes.join('; ')}.` : 'No design changes.',
        `Verdict ${VERDICT_LABEL[vBefore.verdict]} → ${VERDICT_LABEL[vAfter.verdict]} (${vAfter.counts.pass} pass, ${vAfter.counts.review} review, ${vAfter.counts.fail} fail).`,
        vAfter.verdict === 'fail'
          ? 'Open failures remain; they are listed in the validation table.'
          : 'Next step: confirm the finalized design with a solver run before relying on it.',
      ].join(NL),
      changes.length > 0,
    );
    setFocusReq(null);
  };

  const spec = buildFocus(ws, focusReq ?? defaultFocus(ctx));

  const rows = ruleRows(ctx);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Insights</h1>
          <div className="page-sub">
            {ctx.componentLabel} · verdicts: deterministic rules on estimated values · explanations: {provider.label}
          </div>
        </div>
        <div className="page-actions">
          <ComponentSwitch value={c} onChange={(v) => ws.setComponent(v)} />
          <button className="btn" onClick={() => navigate({ section: 'design-lab' })}>
            ○ Edit in Design Lab
          </button>
        </div>
      </div>

      <div className="ai-top">
        <VerdictCard slot="A" v={ctx.validation.A} />
        <VerdictCard slot="B" v={ctx.validation.B} />
        <Panel
          className="ai-summary"
          title="Summary"
          right={<span className="chip" title={explanation.methodStatement}>{explanation.generatorLabel}</span>}
        >
          <div className="ai-headline">{explanation.headline}</div>
          {explanation.paragraphs.map((p, i) => (
            <p className="ai-p" key={i}>
              {p}
            </p>
          ))}
          {fellBack && (
            <div className="note amber" style={{ marginTop: 8 }}>
              The explanation provider&apos;s answer was not used{violations.length ? ` (${violations.join('; ')})` : ''}. Showing the
              local explanation instead.
            </div>
          )}
        </Panel>
      </div>

      <div className="ai-work">
        <Panel
          title="See the change in 3D"
          right={<span className="chip">{spec.changed ? `${spec.labels.from} ⇄ ${spec.labels.to}` : 'highlight'}</span>}
        >
          <FocusViewer spec={spec} src={ws} />
        </Panel>
        <Panel title="Ask AutoTwin" right={<ChatProviderChip />}>
          <ChatPanel
            ctx={ctx}
            src={ws}
            handlers={{
              onPreview: setFocusReq,
              onApply: (patch, title) => applyPatch(patch, title, true),
              onUndo: undoLast,
              canUndo: undoable.length > 0,
              onFinalize: finalize,
            }}
          />
        </Panel>
      </div>

      <Panel
        title="Validation, parameter by parameter"
        right={
          <div className="panel-actions">
            <Badge kind="estimated" />
            <Badge kind="demo" label="Demo limits" />
          </div>
        }
      >
        <div className="table-scroll">
          <table className="data-table ai-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Requirement</th>
                <th className="r a">A</th>
                <th className="r b">B</th>
                <th className="r">Limit</th>
                <th>A</th>
                <th>B</th>
                <th className="r">B margin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, a, b }) => {
                const ref = (b ?? a)!;
                const isOpen = openRule === id;
                return (
                  <Fragment key={id}>
                    <tr className={`ai-row ${b?.status ?? ''}`} onClick={() => setOpenRule(isOpen ? null : id)}>
                      <td>{ref.label}</td>
                      <td className="muted">{ref.requirement}</td>
                      <td className="r">{a ? fmtVal(a) : '—'}</td>
                      <td className="r">{b ? fmtVal(b) : '—'}</td>
                      <td className="r">{fmtLimit(ref)}</td>
                      <td>{a ? <VerdictTag verdict={a.status} /> : <span className="muted">n/a</span>}</td>
                      <td>{b ? <VerdictTag verdict={b.status} /> : <span className="muted">n/a</span>}</td>
                      <td className={`r margin ${b?.status ?? ''}`}>{b ? marginText(b) : '—'}</td>
                      <td className="r">
                        <button
                          className="link-btn"
                          aria-expanded={isOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenRule(isOpen ? null : id);
                          }}
                        >
                          {isOpen ? 'hide' : 'why?'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="ai-explain-row">
                        <td colSpan={9}>
                          <RuleDetail ctx={ctx} id={id} text={explanation.rules[id]} result={ref} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Demo limits in use: {ctx.loadCase}. Change them under Load case &amp; limits in the Design Lab.
        </div>
      </Panel>

      <div className="ai-grid">
        <Panel
          title="Recommended changes to candidate B"
          right={
            undoable.length ? (
              <button className="btn sm" onClick={undoLast} title={`Undo: ${undoable[undoable.length - 1].title}`}>
                ↶ Undo last change
              </button>
            ) : undefined
          }
        >
          {ctx.recommendations.length === 0 ? (
            <div className="hint">
              {ctx.validation.B.verdict === 'pass'
                ? 'Candidate B passes every check with margin, so there is nothing to fix.'
                : 'No single change within the allowed parameter ranges clears the open checks. Try a combination in the Design Lab.'}
            </div>
          ) : (
            <div className="recs">
              {ctx.recommendations.map((rec) => (
                <RecCard
                  key={rec.id}
                  rec={rec}
                  text={explanation.recommendations[rec.id]}
                  onApply={() => apply(rec)}
                  onPreview={() => setFocusReq({ title: rec.title, patch: rec.patch, why: rec.rationale })}
                  onPlan={() => {
                    chatStore.addToPlan(c, rec.patch);
                    tell(`Added to the draft plan: ${rec.title}. Nothing changes until you finalize.`);
                  }}
                />
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            Each suggestion is searched in the parameter&apos;s own step size and re-checked through the same estimates and
            rules, so the predicted verdicts are computed. They are still estimates.
          </div>
        </Panel>

        <div className="ai-side">
          <Panel title="Findings" right={<span className="chip">rule-based</span>}>
            <ul className="findings">
              {ctx.findings.map((f) => (
                <FindingItem key={f.id} f={f} />
              ))}
            </ul>
          </Panel>
          <TweakPanel ws={ws} ctx={ctx} />
        </div>
      </div>

      <Panel title="How these insights are made">
        <ol className="pipeline">
          <li>
            <b>Validation engine</b>
            <span>
              Fixed rules compare each estimated value with its limit and set every PASS, NEEDS REVIEW and FAIL. Same
              design, same verdict, every time. The Design Lab and Dashboard use the same rules.
            </span>
          </li>
          <li>
            <b>Rule-based insights</b>
            <span>
              Findings, which changed parameter drives a failure, and what-if recommendations, all computed from the same
              estimates and rules.
            </span>
          </li>
          <li>
            <b>Explanation · {provider.label}</b>
            <span>
              Turns the two layers above into readable text. It cannot change a verdict, and every answer passes guardrails
              that reject prohibited claims and contradictions. A language-model provider can be added later behind the
              AutoTwin backend, with its API key kept on the server.
            </span>
          </li>
        </ol>
        <div className="sub-title">Caveats</div>
        <ul className="caveats">
          {explanation.caveats.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <div className="hint">{explanation.methodStatement}</div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ruleRows(ctx: InsightContext) {
  const ids: string[] = [];
  for (const r of [...ctx.validation.B.results, ...ctx.validation.A.results]) if (!ids.includes(r.ruleId)) ids.push(r.ruleId);
  return ids.map((id) => ({
    id,
    a: ctx.validation.A.results.find((r) => r.ruleId === id),
    b: ctx.validation.B.results.find((r) => r.ruleId === id),
  }));
}

const NL = String.fromCharCode(10);
const unitSuffix = (u: string) => (u === '–' ? '' : ` ${u}`);
const fmtVal = (r: RuleResult) => `${r.value.toFixed(r.digits)}${unitSuffix(r.unit)}`;
const fmtLimit = (r: RuleResult) => `${r.kind === 'max' ? '≤' : '≥'} ${r.limit.toFixed(r.digits)}${unitSuffix(r.unit)}`;

function VerdictCard({ slot, v }: { slot: Slot; v: DesignValidation }) {
  return (
    <Panel className={`verdict-card slot-${slot.toLowerCase()} ${v.verdict}`}>
      <div className="vc-top">
        <span className="slot-title">{slot === 'A' ? 'Baseline A' : 'Candidate B'}</span>
        <span className="vc-rev">{v.revision}</span>
      </div>
      <VerdictTag verdict={v.verdict} size="lg" />
      <div className="vc-counts">
        {v.counts.pass} pass · {v.counts.review} review · {v.counts.fail} fail
      </div>
      <div className="vc-badges">
        <Badge kind="estimated" />
        <Badge kind="demo" label="Demo limits" />
      </div>
    </Panel>
  );
}

function RuleDetail({ ctx, id, text, result }: { ctx: InsightContext; id: string; text?: string; result: RuleResult }) {
  const at = ctx.attributions[id];
  return (
    <div className="rule-detail">
      <p>{text ?? result.why}</p>
      <div className="rule-meta">
        <span>
          <b>Driven by:</b> {result.parameters.map((p) => paramMeta(ctx.component, p).label.toLowerCase()).join(', ')}
        </span>
        <span>
          <b>Limit from:</b> {result.limitSource}
        </span>
        <span>
          <b>Value from:</b> {result.basis === 'estimated' ? 'reduced-order estimate' : result.basis === 'geometric' ? 'design geometry' : 'comparison with design A'}
        </span>
      </div>
      {at && at.changes.length > 0 && (
        <table className="data-table plain attrib">
          <thead>
            <tr>
              <th>Changed from A</th>
              <th>A → B</th>
              <th className="r">This check with only that put back</th>
            </tr>
          </thead>
          <tbody>
            {at.changes.map((ch) => (
              <tr key={ch.parameter} className={ch.parameter === at.mainDriver ? 'main' : ''}>
                <td>
                  {ch.label}
                  {ch.parameter === at.mainDriver && <span className="chip main-chip">main driver</span>}
                </td>
                <td>
                  <span className="a-txt">{ch.fromText}</span> → <span className="b-txt">{ch.toText}</span>
                </td>
                <td className="r">
                  {ch.revertedValue.toFixed(result.digits)}
                  {unitSuffix(result.unit)} · {VERDICT_LABEL[ch.revertedStatus]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecCard({
  rec,
  text,
  onApply,
  onPreview,
  onPlan,
}: {
  rec: Recommendation;
  text?: string;
  onApply: () => void;
  onPreview: () => void;
  onPlan: () => void;
}) {
  return (
    <div className={`rec ${rec.kind}`}>
      <div className="rec-head">
        <span className="rec-title">{rec.title}</span>
        <span className="rec-after">
          B after: <VerdictTag verdict={rec.verdictAfter} />
        </span>
      </div>
      {rec.predicted.length > 0 && (
        <ul className="rec-pred">
          {rec.predicted.map((p) => (
            <li key={p.ruleId}>
              {p.label}: {p.before.value.toFixed(p.digits)} → <b>{p.after.value.toFixed(p.digits)}</b>
              {unitSuffix(p.unit)} <span className="muted">({VERDICT_LABEL[p.before.status]} → {VERDICT_LABEL[p.after.status]})</span>
            </li>
          ))}
        </ul>
      )}
      {rec.sideEffects.length > 0 && <div className="rec-side">Also: {rec.sideEffects.join(' · ')}</div>}
      <div className="rec-why">{text ?? rec.rationale}</div>
      <div className="rec-actions">
        <button className="btn sm primary" onClick={onApply}>
          Apply to candidate B
        </button>
        <button className="btn sm" onClick={onPreview}>
          Show in 3D
        </button>
        <button className="btn sm" onClick={onPlan}>
          Add to plan
        </button>
        {!rec.clears && rec.kind === 'fix' && <span className="hint">Improves it but doesn&apos;t fully clear it on its own.</span>}
      </div>
    </div>
  );
}

const TONE_MARK: Record<Finding['tone'], string> = { good: '✓', info: '•', warn: '!', bad: '✕' };

function FindingItem({ f }: { f: Finding }) {
  return (
    <li className={`finding ${f.tone}`}>
      <span className="mark" aria-hidden="true">
        {TONE_MARK[f.tone]}
      </span>
      <span>{f.text}</span>
    </li>
  );
}

/** Sliders for the parameters behind B's open checks (or the governing check when all pass). */
function TweakPanel({ ws, ctx }: { ws: WorkspaceStore; ctx: InsightContext }) {
  const c = ctx.component;
  const open = ctx.validation.B.results.filter((r) => r.status !== 'pass');
  const basis = open.length
    ? open
    : [ctx.validation.B.results.filter((r) => r.basis === 'estimated').reduce((m, r) => (utilisation(r) > utilisation(m) ? r : m))];
  const keys = [...new Set(basis.flatMap((r) => r.parameters))].slice(0, 6);
  const B = getDesign(ws, c, 'B');
  const set = (key: string, v: number | string) => {
    if (c === 'brake-caliper') ws.setCaliper('B', { [key]: v } as Partial<CaliperDesign>);
    else ws.setPlug('B', { [key]: v } as Partial<PlugDesign>);
  };
  return (
    <Panel title="Tweak candidate B" right={<span className="hint">{open.length ? 'behind the open checks' : 'behind the governing check'}</span>}>
      <div className="slot-b">
        {keys.map((key) => {
          const meta = paramMeta(c, key);
          const value = paramValue(B, key);
          if (meta.options) {
            return (
              <label className="stack-field" key={key}>
                <span>{meta.label}</span>
                <select className="select" value={String(value)} onChange={(e) => set(key, e.target.value)}>
                  {meta.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          const s = meta.spec!;
          return (
            <SliderField
              key={key}
              label={s.label}
              value={Number(value)}
              min={s.min}
              max={s.max}
              step={s.step}
              digits={s.digits}
              unit={s.unit === '–' ? undefined : s.unit}
              onChange={(v) => set(key, v)}
            />
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Changes go straight into candidate B and every check re-runs instantly.
      </div>
    </Panel>
  );
}
