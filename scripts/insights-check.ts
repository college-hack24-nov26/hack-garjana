// Checks for the AI Insights layers: validation engine, findings, recommendations,
// explanation guardrails and provider fallback. No browser needed.
// Run with: npm run test:insights
import { CALIPER_BASELINE, CALIPER_INPUT_DEFAULTS, PLUG_BASELINE, PLUG_INPUT_DEFAULTS } from '../src/workspace/designs.ts';
import type { CaliperDesign, PlugDesign } from '../src/workspace/designs.ts';
import { caliperEstimate } from '../src/workspace/estimators.ts';
import { validateCaliper, validatePlug } from '../src/workspace/validation.ts';
import { WorkspaceStore } from '../src/workspace/WorkspaceStore.ts';
import { buildInsightContext } from '../src/insights/context.ts';
import { attributeRules } from '../src/insights/findings.ts';
import { recommendFixes } from '../src/insights/recommendations.ts';
import { validateCandidate, withPatch, paramMeta } from '../src/insights/designAccess.ts';
import { explainLocally } from '../src/insights/explain/localProvider.ts';
import { guardExplanation } from '../src/insights/explain/guardrails.ts';
import { explainWithGuardrails } from '../src/insights/explain/provider.ts';
import type { Explanation, ExplanationProvider, InsightContext } from '../src/insights/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const rule = (v: ReturnType<typeof validateCaliper>, id: string) => v.results.find((r) => r.ruleId === id);

function workspaceWith(opts: { component?: 'brake-caliper' | 'spark-plug'; B?: Partial<CaliperDesign>; plugB?: Partial<PlugDesign> } = {}) {
  const ws = new WorkspaceStore(false);
  if (opts.component) ws.setComponent(opts.component);
  if (opts.B) ws.setCaliper('B', opts.B);
  if (opts.plugB) ws.setPlug('B', opts.plugB);
  return ws;
}

// 1. Validation engine: verdicts, margins, review bands.
{
  const inp = CALIPER_INPUT_DEFAULTS;
  const base = validateCaliper('A', CALIPER_BASELINE, inp);
  check('baseline caliper: PASS on every rule', base.verdict === 'pass' && base.counts.fail === 0 && base.counts.review === 0, `${base.results.length} rules`);
  check('no clamp-balance rule without a baseline', !rule(base, 'cal.clamp-balance'));

  const over = validateCaliper('A', CALIPER_BASELINE, { ...inp, allowableStressMPa: 90 });
  const s = rule(over, 'cal.stress')!;
  const est = caliperEstimate(CALIPER_BASELINE, inp);
  check('over the allowable: FAIL', s.status === 'fail' && over.verdict === 'fail');
  check('failure margin is negative and matches (limit − value)/limit', Math.abs(s.margin - (90 - est.peakStressMPa) / 90) < 1e-12, (s.margin * 100).toFixed(2) + ' %');
  check('excess = value − limit', Math.abs(s.excess - (est.peakStressMPa - 90)) < 1e-9, s.excess.toFixed(2) + ' MPa');

  const close = validateCaliper('A', CALIPER_BASELINE, { ...inp, allowableStressMPa: 110 });
  const c = rule(close, 'cal.stress')!;
  check('inside the limit but within 20 %: NEEDS REVIEW with a reason', c.status === 'review' && !!c.reviewReason && c.margin > 0);
  check('overall verdict takes the worst rule', close.verdict === 'review');

  const noRibs = validateCaliper('A', { ...CALIPER_BASELINE, ribCount: 0 }, inp);
  check('rib wall rule only applies with ribs', !rule(noRibs, 'cal.rib-wall'));

  const bigBore = validateCaliper('B', { ...CALIPER_BASELINE, pistonBoreMm: 44 }, inp, CALIPER_BASELINE);
  const bal = rule(bigBore, 'cal.clamp-balance')!;
  check('clamp force +34 % vs A: flagged NEEDS REVIEW, not FAIL', bal.status === 'review' && bal.margin < 0, bal.value.toFixed(1) + ' %');

  const weakLimit = validateCaliper('A', { ...CALIPER_BASELINE, materialId: 'a356-t6' }, { ...inp, minFoS: 2 });
  check('factor of safety uses the selected material yield', rule(weakLimit, 'cal.fos')!.value < rule(validateCaliper('A', CALIPER_BASELINE, inp), 'cal.fos')!.value);

  const shallow = validateCaliper('A', { ...CALIPER_BASELINE, slotDepthFrac: 0.45 }, inp);
  check('slot shallower than the pads fails', rule(shallow, 'cal.slot-depth')!.status === 'fail', rule(shallow, 'cal.slot-depth')!.value.toFixed(1) + ' mm');

  const plugA = validatePlug('A', PLUG_BASELINE, PLUG_INPUT_DEFAULTS);
  check('reference plug passes the operating point', rule(plugA, 'plug.tip-min')!.status === 'pass' && rule(plugA, 'plug.tip-max')!.status === 'pass');
  check('reference plug below self-cleaning at idle: NEEDS REVIEW, not FAIL', rule(plugA, 'plug.tip-idle')!.status === 'review' && plugA.verdict === 'review');
  const hot = validatePlug('B', { ...PLUG_BASELINE, noseLengthMm: 14, electrodeId: 'ni' }, PLUG_INPUT_DEFAULTS);
  check('long nose + solid nickel: hottest tip over 850 °C fails', rule(hot, 'plug.tip-range')!.status === 'fail', rule(hot, 'plug.tip-range')!.value.toFixed(0) + ' °C');
  const thinWall = validatePlug('B', { ...PLUG_BASELINE, electrodeDiaMm: 4.8 }, PLUG_INPUT_DEFAULTS);
  check('insulator wall below the minimum fails', rule(thinWall, 'plug.insulator-wall')!.status === 'fail');
}

// 2. Attribution: which changed parameter drives a failure.
{
  const ws = workspaceWith({ B: { materialId: 'a356-t6', bridgeMm: 18 } });
  const v = validateCandidate(ws, 'brake-caliper', ws.caliper.B);
  const mouth = rule(v, 'cal.mouth')!;
  check('aluminium + thinner bridge: mouth opening fails', mouth.status === 'fail', mouth.value.toFixed(3) + ' mm');
  const at = attributeRules(ws, 'brake-caliper', v)['cal.mouth'];
  check('both changed parameters are listed', at.changes.length === 2);
  check('material is the main driver', at.mainDriver === 'materialId', at.changes.map((c) => `${c.parameter} ${c.effect.toFixed(2)}`).join(', '));
}

// 3. Recommendations are re-validated and honest.
{
  const ws = workspaceWith({ B: { materialId: 'a356-t6', bridgeMm: 18 } });
  const v = validateCandidate(ws, 'brake-caliper', ws.caliper.B);
  const recs = recommendFixes(ws, 'brake-caliper', v);
  check('failing caliper gets recommendations', recs.length > 0, recs.map((r) => r.title).join(' | '));
  check('no recommendation creates a new FAIL elsewhere', recs.every((r) => {
    const after = validateCandidate(ws, 'brake-caliper', withPatch(ws.caliper.B, r.patch));
    return after.results.every((x) => x.status !== 'fail' || r.ruleIds.includes(x.ruleId) || rule(v, x.ruleId)?.status === 'fail');
  }));
  let consistent = true;
  let onGrid = true;
  let cleared = true;
  for (const r of recs) {
    const after = validateCandidate(ws, 'brake-caliper', withPatch(ws.caliper.B, r.patch));
    if (after.verdict !== r.verdictAfter) consistent = false;
    if (r.clears && !r.ruleIds.every((id) => rule(after, id)!.status === 'pass')) cleared = false;
    const spec = paramMeta('brake-caliper', r.parameter).spec;
    if (spec) {
      const value = Number(r.patch[r.parameter]);
      const k = value / spec.step;
      if (value < spec.min - 1e-9 || value > spec.max + 1e-9 || Math.abs(k - Math.round(k)) > 1e-6) onGrid = false;
    }
  }
  check('predicted verdict = actual verdict after applying', consistent);
  check('"clears" recommendations really clear their rules', cleared);
  check('recommended values sit in range and on the step grid', onGrid);
  check('the top recommendation removes every FAIL', recs[0].verdictAfter !== 'fail', `${recs[0].title} → ${recs[0].verdictAfter}`);

  const bal = workspaceWith({ B: { pistonBoreMm: 44 } });
  const vb = validateCandidate(bal, 'brake-caliper', bal.caliper.B);
  const fix = recommendFixes(bal, 'brake-caliper', vb).find((r) => r.ruleIds.includes('cal.clamp-balance'));
  check('clamp-balance fix moves the bore back toward A', !!fix && Number(fix.patch.pistonBoreMm) < 44 && fix.clears, fix ? fix.title : 'none');

  const plug = workspaceWith({ component: 'spark-plug', plugB: { noseLengthMm: 14, electrodeId: 'ni' } });
  const vp = validateCandidate(plug, 'spark-plug', plug.plug.B);
  const precs = recommendFixes(plug, 'spark-plug', vp);
  const nose = precs.find((r) => r.parameter === 'noseLengthMm');
  check('hot plug: shorter nose is recommended', !!nose && Number(nose.patch.noseLengthMm) < 14, nose ? nose.title : 'none');
  check('hot plug: top fix removes the FAIL', precs[0] && precs[0].verdictAfter !== 'fail', precs[0] ? `${precs[0].title} → ${precs[0].verdictAfter}` : 'none');

  const clean = workspaceWith();
  const ctx = buildInsightContext(clean);
  const opp = ctx.recommendations[0];
  check('passing caliper: no fixes, one optional mass saving', ctx.recommendations.length === 1 && opp.kind === 'opportunity', opp?.title);
  const afterOpp = validateCandidate(clean, 'brake-caliper', withPatch(clean.caliper.B, opp.patch));
  check('the mass saving keeps every check PASS', afterOpp.verdict === 'pass' && caliperEstimate(withPatch(clean.caliper.B, opp.patch), clean.caliperInputs).massKg < caliperEstimate(clean.caliper.B, clean.caliperInputs).massKg);
}

// 4. Local explanations always pass their own guardrails.
{
  const scenarios: [string, WorkspaceStore][] = [
    ['caliper pass', workspaceWith()],
    ['caliper review', workspaceWith({ B: { pistonBoreMm: 44 } })],
    ['caliper fail', workspaceWith({ B: { materialId: 'a356-t6', bridgeMm: 18 } })],
    ['plug review', workspaceWith({ component: 'spark-plug' })],
    ['plug fail', workspaceWith({ component: 'spark-plug', plugB: { noseLengthMm: 14, electrodeId: 'ni' } })],
  ];
  for (const [name, ws] of scenarios) {
    const ctx = buildInsightContext(ws);
    const exp = explainLocally(ctx);
    const g = guardExplanation(ctx, exp);
    check(`local explanation is clean: ${name}`, g.violations.length === 0, g.violations.join('; ') || exp.headline);
    check(`every rule on B is explained: ${name}`, ctx.validation.B.results.every((r) => !!exp.rules[r.ruleId]));
  }
}

// 5. Guardrails catch what an explanation must never say.
{
  const failing = buildInsightContext(workspaceWith({ B: { materialId: 'a356-t6', bridgeMm: 18 } }));
  const passing = buildInsightContext(workspaceWith());
  const base = explainLocally(failing);
  const withText = (ctx: InsightContext, headline: string, extra: Partial<Explanation> = {}) => guardExplanation(ctx, { ...explainLocally(ctx), headline, ...extra });
  check('certification claim rejected', withText(failing, 'The caliper is certified for road use.').violations.length > 0);
  check('"not certified" is allowed', withText(failing, 'Candidate B fails and nothing here is certified.').violations.length === 0);
  check('"candidate B passes all checks" rejected when B fails', withText(failing, 'Candidate B passes all checks.').violations.length > 0);
  check('"candidate B fails" rejected when B passes', withText(passing, 'Candidate B fails the stress check.').violations.length > 0);
  check('hypotheticals are not verdict claims', withText(failing, 'Candidate B would pass all checks after a thicker bridge.').violations.length === 0);
  check('percentage cost-saving claim rejected', withText(failing, 'This saves 30 % cost.').violations.length > 0);
  const extraKeys = guardExplanation(failing, { ...base, rules: { ...base.rules, 'made.up': 'text' } });
  check('unknown rule keys are dropped', !('made.up' in extraKeys.explanation.rules) && extraKeys.violations.length === 0);
}

// 6. Provider fallback keeps the verdicts and the caveats.
{
  const ctx = buildInsightContext(workspaceWith({ B: { materialId: 'a356-t6', bridgeMm: 18 } }));
  const liar: ExplanationProvider = {
    id: 'test-liar',
    label: 'Test',
    deterministic: false,
    explain: async (c) => ({ ...explainLocally(c), generator: 'test-liar', headline: 'Candidate B passes all checks and is certified.' }),
  };
  const broken: ExplanationProvider = { id: 'test-broken', label: 'Test', deterministic: false, explain: async () => { throw new Error('timeout'); } };
  const good: ExplanationProvider = {
    id: 'test-good',
    label: 'Test',
    deterministic: false,
    explain: async (c) => ({ ...explainLocally(c), generator: 'test-good', headline: 'Candidate B fails on mouth opening; see the table.', caveats: [] }),
  };
  const r1 = await explainWithGuardrails(liar, ctx);
  check('bad provider answer is replaced by the local text', r1.fellBack && r1.explanation.generator === 'local-rules' && r1.violations.length >= 2, r1.violations.join('; '));
  const r2 = await explainWithGuardrails(broken, ctx);
  check('provider error falls back to the local text', r2.fellBack && r2.error === 'timeout' && r2.explanation.generator === 'local-rules');
  const r3 = await explainWithGuardrails(good, ctx);
  check('good provider answer is used', !r3.fellBack && r3.explanation.generator === 'test-good');
  check('required caveats are always present', r3.explanation.caveats.length >= 3);
  check('verdicts are untouched by any provider', ctx.validation.B.verdict === 'fail');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
