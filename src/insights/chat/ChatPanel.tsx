import { useEffect, useMemo, useRef, useState } from 'react';
import { useStoreVersion } from '../../core/useStoreVersion';
import { VerdictTag, fmtDateTime } from '../../pages/shared';
import { VERDICT_LABEL } from '../../workspace/validation';
import type { InsightSource } from '../context';
import { getDesign, validateCandidate, withPatch } from '../designAccess';
import type { FocusRequest } from '../focus/focusSpec';
import type { InsightContext } from '../types';
import { localReply } from './engine';
import { activeChatProvider, chatStore, localChat } from './instance';
import { describePatch } from './optimizer';
import type { Patch } from './optimizer';
import { replyWithGuardrails } from './provider';
import type { ChatAction, ChatMessage } from './types';
import '../insights.css';

export interface ChatHandlers {
  onPreview: (req: FocusRequest) => void;
  onApply: (patch: Patch, title: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onFinalize: () => void;
}

/**
 * Chat with the verdict: ask why, try changes, build a draft plan, finalize.
 * Answers come from the active chat provider (the local rule-based one here)
 * and pass the same guardrails as every explanation on the page.
 */
export function ChatPanel({ ctx, src, handlers }: { ctx: InsightContext; src: InsightSource; handlers: ChatHandlers }) {
  useStoreVersion(chatStore);
  const c = ctx.component;
  const msgs = chatStore.messages[c];
  const plan = chatStore.plans[c];
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const B = getDesign(src, c, 'B');
  const planKeys = Object.keys(plan);
  const planVerdict = planKeys.length ? validateCandidate(src, c, withPatch(B, plan)).verdict : null;
  const decisions = chatStore.decisions.filter((d) => d.component === c).slice(0, 3);
  const intro = useMemo<ChatMessage>(
    () => ({ id: 'intro', role: 'assistant', t: Date.now(), component: c, source: localChat.id, ...localReply('help', src, ctx, {}) }),
    // The intro only depends on which component is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c],
  );

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, chatStore.busy, c]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || chatStore.busy) return;
    setText('');
    chatStore.add({ role: 'user', text: question, component: c });
    chatStore.setBusy(true);
    try {
      const history = chatStore.messages[c].slice(-9, -1).map((m) => ({ role: m.role, text: m.text }));
      const g = await replyWithGuardrails(activeChatProvider(), { question, ctx, history, plan: chatStore.plans[c] }, localChat);
      chatStore.add({ role: 'assistant', component: c, source: g.providerId, ...g.reply });
    } catch {
      chatStore.add({ role: 'assistant', component: c, source: localChat.id, text: 'Something went wrong answering that. Please try again.' });
    } finally {
      chatStore.setBusy(false);
    }
  };

  const act = (a: ChatAction) => {
    switch (a.kind) {
      case 'ask':
        void send(a.question);
        break;
      case 'preview':
        handlers.onPreview({ title: a.title, patch: a.patch, why: a.why });
        break;
      case 'plan-add': {
        chatStore.addToPlan(c, a.patch);
        const merged = chatStore.plans[c];
        const v = validateCandidate(src, c, withPatch(B, merged)).verdict;
        chatStore.add({
          role: 'assistant',
          component: c,
          source: localChat.id,
          text: `Added to the draft plan: ${describePatch(c, B, a.patch).join('; ')}.\nWith everything in the plan, B is predicted ${VERDICT_LABEL[v]}. Nothing changes until you finalize.`,
          actions: [
            { kind: 'preview', label: 'Show the plan in 3D', title: 'Draft plan', patch: merged },
            { kind: 'ask', label: 'Finalize the decision', question: 'Finalize the decision' },
          ],
        });
        break;
      }
      case 'apply':
        handlers.onApply(a.patch, a.title);
        break;
      case 'finalize':
        handlers.onFinalize();
        break;
      case 'undo':
        handlers.onUndo();
        break;
    }
  };

  return (
    <div className="chat">
      {planKeys.length > 0 && (
        <div className="plan-box">
          <div className="plan-head">
            <b>Draft plan</b>
            {planVerdict && <VerdictTag verdict={planVerdict} />}
            <span className="hint">predicted for B, not applied yet</span>
          </div>
          {planKeys.map((k) => (
            <div className="plan-item" key={k}>
              <span>{describePatch(c, B, { [k]: plan[k] })[0]}</span>
              <button aria-label={`Remove ${k} from the plan`} title="Remove from plan" onClick={() => chatStore.removeFromPlan(c, k)}>
                ×
              </button>
            </div>
          ))}
          <div className="plan-actions">
            <button className="btn sm" onClick={() => handlers.onPreview({ title: 'Draft plan', patch: plan })}>
              Show in 3D
            </button>
            <button className="btn sm primary" onClick={handlers.onFinalize}>
              Finalize decision
            </button>
            <button className="btn sm" onClick={() => chatStore.clearPlan(c)}>
              Clear plan
            </button>
          </div>
        </div>
      )}

      <div className="chat-log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && <Message msg={intro} onAct={act} />}
        {msgs.map((m) => (
          <Message key={m.id} msg={m} onAct={act} />
        ))}
        {chatStore.busy && <div className="chat-typing">Working it out…</div>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={c === 'spark-plug' ? 'Ask, e.g. "what if nose length is 10 mm?"' : 'Ask, e.g. "what if bridge thickness is 24 mm?"'}
          aria-label="Ask about the verdict"
          maxLength={300}
        />
        <button className="btn primary" type="submit" disabled={!text.trim() || chatStore.busy}>
          Send
        </button>
      </form>

      <div className="plan-actions">
        <button className="btn sm" onClick={handlers.onUndo} disabled={!handlers.canUndo}>
          ↶ Undo last change to B
        </button>
        {msgs.length > 0 && (
          <button className="btn sm" onClick={() => chatStore.clear(c)}>
            Clear chat
          </button>
        )}
      </div>

      {decisions.length > 0 && (
        <div>
          <div className="sub-title">Decisions</div>
          <ul className="decisions">
            {decisions.map((d) => (
              <li key={d.id}>
                <span className="t">{fmtDateTime(d.t)}</span>
                {d.revisionB}: {VERDICT_LABEL[d.verdictBefore]} → <b>{VERDICT_LABEL[d.verdictAfter]}</b>
                {d.changes.length ? ` · ${d.changes.join('; ')}` : ' · no design changes'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Message({ msg, onAct }: { msg: ChatMessage; onAct: (a: ChatAction) => void }) {
  return (
    <div className={`msg ${msg.role}`}>
      <div className="msg-text">{msg.text}</div>
      {msg.table && (
        <div className="table-scroll">
          <table className="msg-table">
            <thead>
              <tr>
                {msg.table.head.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {msg.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg.actions && msg.actions.length > 0 && (
        <div className="msg-actions">
          {msg.actions.map((a, i) => (
            <button
              key={i}
              className={a.kind === 'ask' ? 'chip-btn' : a.kind === 'apply' || a.kind === 'finalize' ? 'btn sm primary' : 'btn sm'}
              onClick={() => onAct(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="msg-meta">
        {msg.role === 'user' ? 'You' : msg.source === 'local-rules' ? 'AutoTwin · local rules' : `AutoTwin · ${msg.source}`} · {fmtDateTime(msg.t)}
      </div>
    </div>
  );
}
