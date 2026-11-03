/**
 * Guardrails for explanation text, applied to every provider (the local one
 * included) before anything is shown.
 *
 * An explanation may describe and rephrase. It may not:
 *   - claim certification, validation, guarantees, fatigue life, cost savings
 *     and the like (unless it is saying the opposite: "not certified" is fine);
 *   - contradict a verdict, e.g. say candidate B passes everything when the
 *     validation engine says NEEDS REVIEW or FAIL;
 *   - add keys for rules or recommendations that don't exist.
 * If it breaks a rule, the caller throws it away and shows the local text.
 */
import { VERDICT_LABEL } from '../../workspace/validation.ts';
import type { Verdict } from '../../workspace/validation.ts';
import type { Explanation, InsightContext } from '../types.ts';

const PROHIBITED: { re: RegExp; what: string }[] = [
  { re: /\bcertif(y|ied|ies|ication)\b/gi, what: 'certification claim' },
  { re: /\bhomologat\w*/gi, what: 'homologation claim' },
  { re: /\bproduction[- ]ready\b/gi, what: 'production-readiness claim' },
  { re: /\bguarantee(d|s)?\b/gi, what: 'guarantee' },
  { re: /\bvalidated\b/gi, what: 'validation claim' },
  { re: /\bfatigue life\b/gi, what: 'fatigue-life claim' },
  { re: /\breal[- ]time (digital )?twin\b/gi, what: 'real-time twin claim' },
  { re: /\b\d+(\.\d+)?\s*%\s*(cost|cheaper|saving|savings)\b/gi, what: 'percentage cost-saving claim' },
  { re: /\bsafe (for|to) (road|production|use|drive)\b/gi, what: 'safety claim' },
  { re: /\b(fea|finite[- ]element)[- ](verified|proven|confirmed)\b/gi, what: 'claim of finite-element verification' },
];

const NEGATED = /\b(not|no|never|without|isn't|aren't|cannot|can't|nor|neither|nothing|none)\b[^.!?]{0,40}$/i;

const SUBJECT: Record<'A' | 'B', RegExp> = {
  A: /\b(baseline|design)\s+A\b/i,
  B: /\b(candidate|design)\s+B\b/i,
};
const CLAIMS_ALL_PASS =
  /\b(pass(es|ed)?|meets?|satisf(y|ies)|clears?)\s+(all|every)\b|\ball\s+(the\s+)?(checks|limits|requirements)\s+(are\s+)?(passed|met|satisfied|pass)\b|\bno\s+(issues|problems|failures|concerns)\b/i;
/** A design-level claim ("candidate B fails …"), not a count ("0 failing"). */
const CLAIMS_FAIL = /\b(fails|failed)\b/i;
const HYPOTHETICAL = /\b(would|could|if|after|predicted|once)\b/i;

const LIMITS = { headline: 240, paragraph: 1500, paragraphs: 8, rule: 1500, caveat: 400, caveats: 8 };

export function requiredCaveats(ctx: InsightContext): string[] {
  return [
    'Verdicts come from fixed rules applied to reduced-order estimates and demo limits. They are not finite-element or test results.',
    ctx.component === 'brake-caliper'
      ? 'The beam estimate reads stress and mouth opening low, so a pass close to a limit is flagged for review.'
      : 'The fin model ignores radiation, contact resistance and the ground electrode, and the gas-side inputs are demo values.',
    'Recommendations are what-if results from the same estimates. Confirm any change with a solver run before relying on it.',
  ];
}

function prohibitedClaims(text: string): string[] {
  const found: string[] = [];
  for (const { re, what } of PROHIBITED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      if (!NEGATED.test(before)) found.push(`${what}: "${m[0]}"`);
    }
  }
  return found;
}

function verdictContradictions(text: string, verdict: Record<'A' | 'B', Verdict>): string[] {
  const found: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const subjects = (['A', 'B'] as const).filter((s) => SUBJECT[s].test(sentence));
    if (subjects.length !== 1 || HYPOTHETICAL.test(sentence)) continue;
    const s = subjects[0];
    if (CLAIMS_ALL_PASS.test(sentence) && verdict[s] !== 'pass') {
      found.push(`says design ${s} passes everything, but its verdict is ${VERDICT_LABEL[verdict[s]]}`);
    }
    const f = CLAIMS_FAIL.exec(sentence);
    if (f && verdict[s] === 'pass' && !NEGATED.test(sentence.slice(0, f.index))) {
      found.push(`says design ${s} fails, but its verdict is PASS`);
    }
  }
  return found;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Guardrail check for any single piece of text shown with a verdict (chat replies use this). */
export function checkText(ctx: InsightContext, text: string): string[] {
  const verdict = { A: ctx.validation.A.verdict, B: ctx.validation.B.verdict };
  return [...new Set([...prohibitedClaims(text), ...verdictContradictions(text, verdict)])];
}

/** Returns a cleaned explanation and the list of rule violations (empty = safe to show). */
export function guardExplanation(ctx: InsightContext, exp: Explanation): { explanation: Explanation; violations: string[] } {
  const violations: string[] = [];
  if (!exp || typeof exp !== 'object') return { explanation: exp, violations: ['not an explanation object'] };
  if (!isStr(exp.headline) || exp.headline.length > LIMITS.headline) violations.push('headline missing or too long');
  const paragraphs = Array.isArray(exp.paragraphs) ? exp.paragraphs.filter(isStr) : [];
  if (paragraphs.length > LIMITS.paragraphs || paragraphs.some((p) => p.length > LIMITS.paragraph)) violations.push('too many or too long paragraphs');

  // Only known rules and recommendations, as strings.
  const ruleIds = new Set([...ctx.validation.A.results, ...ctx.validation.B.results].map((r) => r.ruleId));
  const recIds = new Set(ctx.recommendations.map((r) => r.id));
  const pick = (src: unknown, allowed: Set<string>) => {
    const out: Record<string, string> = {};
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (allowed.has(k) && isStr(v)) {
          if (v.length > LIMITS.rule) violations.push(`text for ${k} is too long`);
          out[k] = v;
        }
      }
    }
    return out;
  };
  const rules = pick(exp.rules, ruleIds);
  const recommendations = pick(exp.recommendations, recIds);
  const caveats = (Array.isArray(exp.caveats) ? exp.caveats.filter(isStr) : []).slice(0, LIMITS.caveats);
  if (caveats.some((c) => c.length > LIMITS.caveat)) violations.push('caveat too long');

  const verdict = { A: ctx.validation.A.verdict, B: ctx.validation.B.verdict };
  const allText = [exp.headline, ...paragraphs, ...Object.values(rules), ...Object.values(recommendations), ...caveats].filter(isStr);
  for (const t of allText) {
    violations.push(...prohibitedClaims(t));
    violations.push(...verdictContradictions(t, verdict));
  }

  return {
    explanation: {
      generator: String(exp.generator ?? 'unknown'),
      generatorLabel: String(exp.generatorLabel ?? exp.generator ?? 'unknown'),
      deterministic: Boolean(exp.deterministic),
      headline: isStr(exp.headline) ? exp.headline : '',
      paragraphs,
      rules,
      recommendations,
      caveats,
      methodStatement: isStr(exp.methodStatement) ? exp.methodStatement : '',
      generatedAt: Number(exp.generatedAt) || Date.now(),
    },
    violations: [...new Set(violations)],
  };
}
