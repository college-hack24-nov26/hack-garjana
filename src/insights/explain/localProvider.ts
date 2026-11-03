/**
 * Local explanation provider: fixed sentence templates filled with the numbers
 * from the InsightContext. Runs in the browser, offline, with no API key, and
 * gives the same text every time for the same designs.
 *
 * It is also the fallback: if a future model-based provider fails, or its text
 * is rejected by the guardrails, this is what the user sees.
 */
import { VERDICT_LABEL } from '../../workspace/validation.ts';
import type { RuleResult, Verdict } from '../../workspace/validation.ts';
import type { Explanation, ExplanationProvider, GroundedFact, InsightContext } from '../types.ts';
import { requiredCaveats } from './guardrails.ts';

const fact = (ctx: InsightContext, key: string) => ctx.facts.find((f) => f.key === key);
const fv = (f: GroundedFact | undefined, slot: 'A' | 'B') => (f ? `${f[slot].toFixed(f.digits)}${f.unit === '–' ? '' : ' ' + f.unit}` : '—');
const val = (r: { value: number }, digits: number, unit: string) => `${r.value.toFixed(digits)}${unit === '–' ? '' : ' ' + unit}`;
const lim = (r: RuleResult) => `${r.limit.toFixed(r.digits)}${r.unit === '–' ? '' : ' ' + r.unit}`;

/** One sentence on how the model gets this number. */
function howComputed(ctx: InsightContext, ruleId: string): string {
  switch (ruleId) {
    case 'cal.stress':
      return `The clamp force (${fv(fact(ctx, 'clampForce'), 'B')} per side on B) acts ${fv(fact(ctx, 'leverArm'), 'B')} from the bridge, so the bridge carries ${fv(fact(ctx, 'bridgeMoment'), 'B')}; stress = M·c / I with I = ${fv(fact(ctx, 'bridgeI'), 'B')}.`;
    case 'cal.fos':
      return `Factor of safety = yield strength (${fv(fact(ctx, 'yield'), 'B')} for B's material) ÷ peak stress (${fv(fact(ctx, 'stress'), 'B')}).`;
    case 'cal.mouth':
      return `The same bending moment rotates each half about the bridge: opening = 2·θ·slot depth, with θ = M·L / (2·E·I) and E = ${fv(fact(ctx, 'youngsModulus'), 'B')} for B's material.`;
    case 'cal.leg-wall':
    case 'cal.bridge-wall':
    case 'cal.rib-wall':
      return 'This is a direct geometric check of the wall against the thinnest wall the foundry can cast.';
    case 'cal.piston-fit':
      return 'The piston row needs each bore plus a 6 mm ligament between and outside the bores, and it must fit inside the body length.';
    case 'cal.clamp-balance':
      return `Clamp force = line pressure × piston area: ${fv(fact(ctx, 'clampForce'), 'A')} per side on A and ${fv(fact(ctx, 'clampForce'), 'B')} on B.`;
    case 'plug.tip-min':
    case 'plug.tip-max':
      return `The nose and electrode act as one fin heated by the gas and cooled at the shell seat: T_tip = T_gas − (T_gas − T_seat) / cosh(m·L). For B, m·L = ${fv(fact(ctx, 'mL'), 'B')}.`;
    case 'plug.tip-range':
      return `Same fin model at full load from 800 to 7000 rpm. Gas-side heat transfer rises with speed, so the hottest point is at top speed: ${fv(fact(ctx, 'tipMax'), 'B')} for B.`;
    case 'plug.tip-idle':
      return `Same fin model at idle, where gas-side heat transfer is lowest: ${fv(fact(ctx, 'tipIdle'), 'B')} for B.`;
    case 'plug.insulator-wall':
      return 'Wall = (nose Ø − electrode Ø) / 2.';
    default:
      return '';
  }
}

const STATUS_PHRASE: Record<Verdict, string> = {
  pass: 'inside the limit with margin',
  review: 'inside the limit but close enough to need review',
  fail: 'over the limit',
};

function ruleText(ctx: InsightContext, b: RuleResult): string {
  const a = ctx.validation.A.results.find((r) => r.ruleId === b.ruleId);
  const margin = b.margin < 0 ? `${Math.abs(b.margin * 100).toFixed(1)} % over` : `${(b.margin * 100).toFixed(1)} % margin`;
  const phrase = b.status === 'review' && b.margin < 0 ? 'past the limit, which this rule flags for review rather than failing' : STATUS_PHRASE[b.status];
  const parts = [
    b.why,
    howComputed(ctx, b.ruleId),
    `Candidate B: ${val(b, b.digits, b.unit)} against ${lim(b)}, ${phrase} (${margin}).` +
      (a ? ` Baseline A: ${val(a, a.digits, a.unit)} (${VERDICT_LABEL[a.status]}).` : ''),
  ];
  if (b.reviewReason) parts.push(b.reviewReason);
  const at = ctx.attributions[b.ruleId];
  if (at) {
    if (at.changes.length) {
      parts.push(`Changed from A and feeding this check: ${at.changes.map((c) => `${c.label.toLowerCase()} ${c.fromText} → ${c.toText}`).join('; ')}.`);
      const main = at.changes.find((c) => c.parameter === at.mainDriver);
      if (main) parts.push(`Putting ${main.label.toLowerCase()} back to ${main.fromText} alone gives ${main.revertedValue.toFixed(b.digits)}${b.unit === '–' ? '' : ' ' + b.unit} (${VERDICT_LABEL[main.revertedStatus]}).`);
    } else if (b.status !== 'pass') {
      parts.push('None of the parameters behind this check differ from A, so it comes from the shared geometry or the load case.');
    }
  }
  return parts.filter(Boolean).join(' ');
}

export function explainLocally(ctx: InsightContext): Explanation {
  const vb = ctx.validation.B;
  const va = ctx.validation.A;
  const total = vb.results.length;
  const fails = vb.results.filter((r) => r.status === 'fail');
  const reviews = vb.results.filter((r) => r.status === 'review');

  let headline: string;
  if (vb.verdict === 'fail') {
    headline = `Candidate B fails ${fails.length} of ${total} checks.${va.verdict === 'pass' ? ' Baseline A passes them.' : ''}`;
  } else if (vb.verdict === 'review') {
    headline = `Candidate B is inside every limit, but ${reviews.length} check${reviews.length > 1 ? 's need' : ' needs'} review.`;
  } else {
    headline = `Candidate B passes all ${total} checks with margin.`;
  }

  const paragraphs: string[] = [];
  if (fails.length) {
    paragraphs.push(
      'Failing: ' +
        fails.map((r) => `${r.label.toLowerCase()} (${val(r, r.digits, r.unit)} vs ${lim(r)}, ${Math.abs(r.margin * 100).toFixed(1)} % over)`).join('; ') +
        '.',
    );
  }
  if (reviews.length) {
    paragraphs.push('Needs review: ' + reviews.map((r) => `${r.label.toLowerCase()}: ${r.reviewReason ?? 'close to its limit.'}`).join(' '));
  }
  const firstOpen = [...fails, ...reviews][0];
  if (firstOpen) {
    const at = ctx.attributions[firstOpen.ruleId];
    const main = at?.changes.find((c) => c.parameter === at.mainDriver);
    if (main) {
      paragraphs.push(
        `The main cause is the change to ${main.label.toLowerCase()} (${main.fromText} → ${main.toText}): reverting it alone brings ${firstOpen.label.toLowerCase()} to ${main.revertedValue.toFixed(firstOpen.digits)}${firstOpen.unit === '–' ? '' : ' ' + firstOpen.unit} (${VERDICT_LABEL[main.revertedStatus]}).`,
      );
    }
  }
  const top = ctx.recommendations[0];
  if (top) {
    paragraphs.push(
      top.kind === 'opportunity'
        ? `${top.title}. Predicted verdict afterwards: ${VERDICT_LABEL[top.verdictAfter]}.`
        : `Smallest single change found: ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}. Predicted verdict afterwards: ${VERDICT_LABEL[top.verdictAfter]}.`,
    );
  } else if (vb.verdict !== 'pass') {
    paragraphs.push('No single change within the allowed parameter ranges clears it; try a combination in the Design Lab.');
  }
  paragraphs.push(
    `Baseline A (${ctx.revisions.A}): ${VERDICT_LABEL[va.verdict]}, with ${va.counts.pass} passing, ${va.counts.review} to review and ${va.counts.fail} failing.`,
  );

  const rules: Record<string, string> = {};
  for (const r of vb.results) rules[r.ruleId] = ruleText(ctx, r);

  // The card shows the predicted numbers itself; the text says why the lever works.
  const recommendations: Record<string, string> = {};
  for (const rec of ctx.recommendations) recommendations[rec.id] = rec.rationale;

  return {
    generator: 'local-rules',
    generatorLabel: 'Local rules',
    deterministic: true,
    headline,
    paragraphs,
    rules,
    recommendations,
    caveats: requiredCaveats(ctx),
    methodStatement: `${total} deterministic rules give PASS / NEEDS REVIEW / FAIL from reduced-order estimates and demo limits. Findings and recommendations come from the same rules; this text is filled into fixed templates in the browser (offline, no language model).`,
    generatedAt: Date.now(),
  };
}

export const localRulesProvider: ExplanationProvider = {
  id: 'local-rules',
  label: 'Local rules (offline)',
  deterministic: true,
  explain: async (ctx) => explainLocally(ctx),
};
