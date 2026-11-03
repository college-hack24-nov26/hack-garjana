// Checks for the AI Insights chat, optimiser and 3D focus specs. No browser needed.
// Run with: npm run test:chat
import { WorkspaceStore } from '../src/workspace/WorkspaceStore.ts';
import { buildInsightContext } from '../src/insights/context.ts';
import { getDesign, validateCandidate, withPatch } from '../src/insights/designAccess.ts';
import { checkText } from '../src/insights/explain/guardrails.ts';
import { localReply, parseChanges } from '../src/insights/chat/engine.ts';
import { optimiseCandidate } from '../src/insights/chat/optimizer.ts';
import { ChatStore } from '../src/insights/chat/ChatStore.ts';
import { localChatProvider, replyWithGuardrails, sanitisePatch } from '../src/insights/chat/provider.ts';
import type { ChatProvider, ChatReply } from '../src/insights/chat/types.ts';
import { abFocus, buildFocus, defaultFocus, lerpDesign } from '../src/insights/focus/focusSpec.ts';
import type { CaliperDesign, PlugDesign } from '../src/workspace/designs.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

function ws(opts: { component?: 'brake-caliper' | 'spark-plug'; B?: Partial<CaliperDesign>; plugB?: Partial<PlugDesign> } = {}) {
  const w = new WorkspaceStore(false);
  if (opts.component) w.setComponent(opts.component);
  if (opts.B) w.setCaliper('B', opts.B);
  if (opts.plugB) w.setPlug('B', opts.plugB);
  return w;
}
const ask = (w: WorkspaceStore, q: string, plan = {}) => localReply(q, w, buildInsightContext(w), plan);
const hasAction = (r: ChatReply, kind: string) => (r.actions ?? []).some((a) => a.kind === kind);
const patchOf = (r: ChatReply) => {
  const a = (r.actions ?? []).find((x) => x.kind === 'apply' || x.kind === 'plan-add' || x.kind === 'preview');
  return a && 'patch' in a ? a.patch : {};
};

// 1. The optimiser chains fixes and its prediction is the truth.
{
  const failing = ws({ B: { materialId: 'a356-t6', bridgeMm: 18 } });
  const plan = optimiseCandidate(failing, 'brake-caliper');
  const after = validateCandidate(failing, 'brake-caliper', withPatch(getDesign(failing, 'brake-caliper', 'B'), plan.patch));
  check('caliper: optimiser reaches PASS', plan.verdictAfter === 'pass', plan.steps.map((s) => s.title).join(' → '));
  check('caliper: plan patch reproduces the predicted verdict', after.verdict === plan.verdictAfter);
  const hot = ws({ component: 'spark-plug', plugB: { noseLengthMm: 14, electrodeId: 'ni' } });
  const pp = optimiseCandidate(hot, 'spark-plug');
  check('plug: optimiser removes every FAIL', pp.verdictAfter !== 'fail', `${pp.verdictBefore} → ${pp.verdictAfter}: ${pp.steps.map((s) => s.title).join(' → ')}`);
  const clean = optimiseCandidate(ws(), 'brake-caliper');
  check('passing caliper: optimiser only offers the optional mass saving', clean.steps.length <= 1 && clean.verdictAfter === 'pass' && (clean.massKg!.after <= clean.massKg!.before));
}

// 2. Reading changes out of a question.
{
  const B = getDesign(ws(), 'brake-caliper', 'B') as unknown as Record<string, number | string>;
  check('"what if bridge thickness is 24 mm" → bridge 24', parseChanges('brake-caliper', 'what if bridge thickness is 24 mm', B).patch.bridgeMm === 24);
  check('"increase bridge by 2" → current + 2', parseChanges('brake-caliper', 'increase bridge by 2', B).patch.bridgeMm === 22);
  check('two changes in one question', (() => { const p = parseChanges('brake-caliper', 'set bridge to 24 and ribs to 3', B).patch; return p.bridgeMm === 24 && p.ribCount === 3; })());
  check('"switch to aluminium" → A356', parseChanges('brake-caliper', 'switch to aluminium', B).patch.materialId === 'a356-t6');
  const big = parseChanges('brake-caliper', 'what if bridge is 100', B);
  check('out-of-range value is clamped, with a note', big.patch.bridgeMm === 32 && big.notes.length === 1, big.notes[0]);
  const P = getDesign(ws(), 'spark-plug', 'B') as unknown as Record<string, number | string>;
  check('"increase tip length" (no number) steps the nose up', Number(parseChanges('spark-plug', 'increase tip length', P).patch.noseLengthMm) > 7.5);
  check('"use a copper core electrode" → ni-cu', parseChanges('spark-plug', 'use solid nickel', P).patch.electrodeId === 'ni' && parseChanges('spark-plug', 'use a copper core electrode', { ...P, electrodeId: 'ni' }).patch.electrodeId === 'ni-cu');
}

// 3. Every intent answers, offers the right actions, and passes the guardrails.
{
  const scenarios: [string, WorkspaceStore][] = [
    ['caliper pass', ws()],
    ['caliper fail', ws({ B: { materialId: 'a356-t6', bridgeMm: 18 } })],
    ['caliper review', ws({ B: { pistonBoreMm: 44 } })],
    ['plug review', ws({ component: 'spark-plug' })],
    ['plug fail', ws({ component: 'spark-plug', plugB: { noseLengthMm: 14, electrodeId: 'ni' } })],
  ];
  const questions = [
    'hello',
    'why does B fail?',
    'why does it need review?',
    'what if bridge thickness is 24 mm?',
    'what if nose length is 10?',
    'increase tip length',
    'what does the rib count do?',
    'what does protrusion do?',
    'explain the mouth opening',
    'tell me about idle fouling',
    'compare A and B',
    'how heavy is it?',
    'optimise B for me',
    'is this FEA?',
    'are you an AI?',
    'what does needs review mean?',
    'what is margin?',
    'what are the limits?',
    'what should I do next?',
    'show my plan',
    'finalize the decision',
    'undo',
    'asdf qwerty',
  ];
  let clean = 0;
  let total = 0;
  const bad: string[] = [];
  for (const [name, w] of scenarios) {
    const ctx = buildInsightContext(w);
    for (const q of questions) {
      const r = localReply(q, w, ctx, {});
      total++;
      const v = checkText(ctx, r.text);
      if (r.text.trim() && v.length === 0) clean++;
      else bad.push(`${name} / ${q}: ${v.join('; ') || 'empty'}`);
    }
  }
  check(`all ${total} answers are non-empty and pass the guardrails`, clean === total, bad.slice(0, 3).join(' | '));

  const fail = ws({ B: { materialId: 'a356-t6', bridgeMm: 18 } });
  const r1 = ask(fail, 'what if bridge thickness is 24 mm?');
  check('what-if offers Show in 3D, Add to plan and Apply', hasAction(r1, 'preview') && hasAction(r1, 'plan-add') && hasAction(r1, 'apply'));
  check('what-if carries the exact change', patchOf(r1).bridgeMm === 24);
  check('what-if reports a before/after table', !!r1.table && r1.table.rows.length > 0);
  const r2 = ask(fail, 'optimise B for me');
  check('optimise offers the whole plan', hasAction(r2, 'plan-add') && Object.keys(patchOf(r2)).length > 0);
  const r3 = ask(fail, 'finalize the decision', { bridgeMm: 24 });
  check('finalize with a plan offers to apply and record', hasAction(r3, 'finalize') && /Predicted verdict/.test(r3.text));
  const r4 = ask(fail, 'is this FEA?');
  check('FEA question is answered honestly', /^No\./.test(r4.text) && /not from a finite-element solver/.test(r4.text));
  const r5 = ask(ws({ component: 'spark-plug' }), 'what does nose length do?');
  check('parameter question explains the effect with a table', /hotter/.test(r5.text) && !!r5.table && !hasAction(r5, 'apply'));
  const r6 = ask(fail, 'asdf qwerty');
  check('unknown question falls back with suggestions', /didn't catch that/.test(r6.text) && hasAction(r6, 'ask'));
}

// 4. Provider safety: bad answers and bad changes never get through.
{
  const w = ws({ B: { materialId: 'a356-t6', bridgeMm: 18 } });
  const ctx = buildInsightContext(w);
  const local = localChatProvider(() => w);
  const liar: ChatProvider = { id: 'test-liar', label: 'Test', deterministic: false, reply: async () => ({ text: 'Candidate B passes all checks and is certified.' }) };
  const r1 = await replyWithGuardrails(liar, { question: 'why does B fail?', ctx, history: [], plan: {} }, local);
  check('a reply that contradicts the verdict is replaced by the local answer', r1.fellBack && r1.violations.length >= 2 && !/certified/.test(r1.reply.text));
  const sneaky: ChatProvider = {
    id: 'test-sneaky',
    label: 'Test',
    deterministic: false,
    reply: async () => ({
      text: 'Try a thicker bridge.',
      actions: [
        { kind: 'apply', label: 'x', title: 'x', patch: { bridgeMm: 999, madeUp: 3, materialId: 'unobtainium' } },
        { kind: 'apply', label: 'y', title: 'y', patch: { bridgeMm: 24 } },
      ],
    }),
  };
  const r2 = await replyWithGuardrails(sneaky, { question: 'fix it', ctx, history: [], plan: {} }, local);
  check('out-of-range and unknown changes are dropped', (r2.reply.actions ?? []).length === 1 && patchOf(r2.reply).bridgeMm === 24);
  check('sanitisePatch keeps only valid values', JSON.stringify(sanitisePatch('spark-plug', { noseLengthMm: 10, electrodeId: 'ni', bogus: 1, noseDiaMm: 99 })) === JSON.stringify({ noseLengthMm: 10, electrodeId: 'ni' }));
  const broken: ChatProvider = { id: 'test-broken', label: 'Test', deterministic: false, reply: async () => { throw new Error('offline'); } };
  const r3 = await replyWithGuardrails(broken, { question: 'why?', ctx, history: [], plan: {} }, local);
  check('a provider error falls back to the local answer', r3.fellBack && r3.reply.text.length > 0);
}

// 5. Chat store: plan and decisions.
{
  const s = new ChatStore(false);
  s.addToPlan('brake-caliper', { bridgeMm: 24 });
  s.addToPlan('brake-caliper', { ribCount: 3 });
  s.removeFromPlan('brake-caliper', 'ribCount');
  check('plan merges and removes changes', JSON.stringify(s.plans['brake-caliper']) === JSON.stringify({ bridgeMm: 24 }) && Object.keys(s.plans['spark-plug']).length === 0);
  s.add({ role: 'user', text: 'why does B fail?', component: 'brake-caliper' });
  const d = s.recordDecision({ component: 'brake-caliper', revisionB: 'BC-B rev 0.1', changes: ['bridge thickness 18.0 mm → 24.0 mm'], verdictBefore: 'fail', verdictAfter: 'pass', counts: { pass: 9, review: 0, fail: 0 }, questions: s.questions('brake-caliper') });
  check('decision keeps the questions asked', s.decisions[0] === d && d.questions[0] === 'why does B fail?');
}

// 6. Focus specs for the 3D view.
{
  const w = ws({ component: 'spark-plug', plugB: { noseLengthMm: 14, electrodeId: 'ni' } });
  const ctx = buildInsightContext(w);
  const f = buildFocus(w, defaultFocus(ctx));
  check('default focus is the top recommendation, morphing', f.changed && f.keys.length > 0 && f.parts.length > 0, `${f.title} → parts ${f.parts.join(', ')}`);
  const nose = buildFocus(w, { title: 'nose', patch: { noseLengthMm: 10 } });
  check('nose length lights up the insulator nose', nose.parts.join() === 'nose' && nose.labels.from === 'Now');
  const half = lerpDesign(nose.from as PlugDesign, nose.to as PlugDesign, 0.5);
  check('halfway morph is halfway', Math.abs(half.noseLengthMm - 12) < 1e-9);
  const ab = abFocus(ws({ B: { materialId: 'a356-t6', bridgeMm: 18, ribCount: 3 } }), 'brake-caliper');
  check('A → B focus lists every changed parameter, material too', ['materialId', 'bridgeMm', 'ribCount'].every((k) => ab.keys.includes(k)) && ab.labels.to === 'B');
  check('A → B lights up the whole body for a material change', ab.parts.includes('body') && ab.parts.includes('bridge') && ab.parts.includes('ribs'));
  const same = buildFocus(ws(), defaultFocus(buildInsightContext(ws())));
  check('focus without a recommendation still points at a part', same.parts.length > 0);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
