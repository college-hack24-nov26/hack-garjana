/**
 * Local chat engine for AI Insights: answers questions about the verdict,
 * tries changes ("what if bridge is 24 mm?"), explains what a parameter does,
 * optimises B and prepares the final decision.
 *
 * It's rule-based and offline: it matches what you typed to a small set of
 * intents and answers with numbers from the same estimates and validation rules
 * as the rest of the page. No language model is involved, and it never makes a
 * number up.
 */
import type { CaliperDesign, ComponentId, ParamSpec } from '../../workspace/designs.ts';
import { caliperEstimate } from '../../workspace/estimators.ts';
import { VERDICT_LABEL, verdictRank } from '../../workspace/validation.ts';
import type { DesignValidation, RuleResult } from '../../workspace/validation.ts';
import type { InsightSource } from '../context.ts';
import { formatParam, getDesign, paramMeta, paramValue, validateCandidate, withPatch } from '../designAccess.ts';
import { explainLocally } from '../explain/localProvider.ts';
import { recommendOpportunity } from '../recommendations.ts';
import type { InsightContext } from '../types.ts';
import { describePatch, optimiseCandidate } from './optimizer.ts';
import type { Patch } from './optimizer.ts';
import type { ChatAction, ChatReply, ChatTable } from './types.ts';

const V = (v: keyof typeof VERDICT_LABEL) => VERDICT_LABEL[v];
const unit = (u: string) => (u === '–' ? '' : ` ${u}`);
const fmtR = (r: RuleResult) => `${r.value.toFixed(r.digits)}${unit(r.unit)}`;

/* ------------------------------------------------------------------ */
/*  What each parameter does, in one or two sentences                  */
/* ------------------------------------------------------------------ */

export const PARAM_EFFECT: Record<string, string> = {
  bridgeMm: 'A thicker bridge is stiffer and stronger: bending stress drops roughly with thickness squared and mouth opening with thickness cubed. Mass goes up.',
  legWallMm: 'The legs carry the pistons. This beam model treats them as rigid, so leg thickness mainly changes mass and the bridge span; it cannot judge leg bending.',
  bodyHeightMm: 'A taller body makes the disc slot deeper at the same depth fraction: more room for the pads, but a longer lever arm and more bending in the bridge.',
  slotDepthFrac: 'A deeper slot puts the pad force further from the bridge (more bending and opening); a shallower one can stop holding the full pad height.',
  bodyLengthMm: 'A longer body widens the bridge (lower stress, less opening) and leaves room for more or bigger pistons. Mass goes up.',
  discSlotMm: 'A wider slot lengthens the bridge span, so the caliper opens more under the same load.',
  ribCount: 'Ribs deepen the bridge section, so each one adds a lot of stiffness for little mass.',
  ribMm: 'Thicker ribs add section depth where the bridge works hardest.',
  pistonBoreMm: 'Bigger bores give more clamp force for the same line pressure: more brake torque, but more load on the bridge and a shift in brake balance.',
  pistonsPerSide: 'More pistons add piston area: more torque and more load on the bridge, and they need a longer body.',
  materialId: "Material sets density (mass), stiffness (mouth opening) and yield strength (factor of safety). Stress itself doesn't change with material in this model.",
  noseLengthMm: 'The main heat-range lever: a longer nose is a longer path to the cooled shell, so the tip runs hotter. That burns deposits off sooner at idle but brings it closer to pre-ignition at full load.',
  noseDiaMm: 'A wider nose leaves more ceramic around the electrode (a thicker insulator wall) and changes how much heat the nose collects and conducts.',
  electrodeDiaMm: 'A thicker centre electrode carries more heat to the seat, so the tip runs cooler, but it thins the insulator wall around it.',
  protrusionMm: 'More protrusion puts the firing end further into the hot gas, so it runs hotter and cleans itself sooner at light load.',
  electrodeId: 'A copper-cored electrode carries heat away far faster than solid nickel, so the tip runs cooler.',
  insulatorId: 'Higher-purity alumina conducts heat better, so the tip runs a little cooler.',
};

/* ------------------------------------------------------------------ */
/*  Understanding the question                                         */
/* ------------------------------------------------------------------ */

const SYNONYMS: Record<ComponentId, [string, string][]> = {
  'brake-caliper': [
    ['bridge thickness', 'bridgeMm'], ['bridge', 'bridgeMm'],
    ['leg wall thickness', 'legWallMm'], ['leg wall', 'legWallMm'], ['leg thickness', 'legWallMm'], ['legs', 'legWallMm'], ['leg', 'legWallMm'],
    ['body height', 'bodyHeightMm'], ['height', 'bodyHeightMm'],
    ['slot depth fraction', 'slotDepthFrac'], ['slot depth', 'slotDepthFrac'], ['depth fraction', 'slotDepthFrac'],
    ['body length', 'bodyLengthMm'], ['caliper length', 'bodyLengthMm'], ['length', 'bodyLengthMm'],
    ['disc slot width', 'discSlotMm'], ['slot width', 'discSlotMm'], ['disc slot', 'discSlotMm'],
    ['rib thickness', 'ribMm'], ['rib width', 'ribMm'],
    ['rib count', 'ribCount'], ['number of ribs', 'ribCount'], ['ribs', 'ribCount'], ['rib', 'ribCount'],
    ['pistons per side', 'pistonsPerSide'], ['piston count', 'pistonsPerSide'], ['number of pistons', 'pistonsPerSide'], ['pistons', 'pistonsPerSide'],
    ['piston bore', 'pistonBoreMm'], ['piston diameter', 'pistonBoreMm'], ['piston size', 'pistonBoreMm'], ['bore', 'pistonBoreMm'], ['piston', 'pistonBoreMm'],
    ['material', 'materialId'], ['aluminium', 'materialId'], ['aluminum', 'materialId'], ['a356', 'materialId'], ['6061', 'materialId'],
    ['cast iron', 'materialId'], ['ductile iron', 'materialId'], ['iron', 'materialId'],
  ],
  'spark-plug': [
    ['insulator nose length', 'noseLengthMm'], ['nose length', 'noseLengthMm'], ['tip length', 'noseLengthMm'], ['insulator length', 'noseLengthMm'],
    ['nose diameter', 'noseDiaMm'], ['nose dia', 'noseDiaMm'], ['nose ø', 'noseDiaMm'], ['nose width', 'noseDiaMm'],
    ['nose', 'noseLengthMm'],
    ['electrode diameter', 'electrodeDiaMm'], ['electrode dia', 'electrodeDiaMm'], ['electrode ø', 'electrodeDiaMm'], ['electrode size', 'electrodeDiaMm'], ['electrode thickness', 'electrodeDiaMm'],
    ['electrode material', 'electrodeId'], ['copper core', 'electrodeId'], ['copper', 'electrodeId'], ['solid nickel', 'electrodeId'], ['nickel', 'electrodeId'],
    ['firing-end protrusion', 'protrusionMm'], ['firing end protrusion', 'protrusionMm'], ['protrusion', 'protrusionMm'], ['projection', 'protrusionMm'],
    ['insulator material', 'insulatorId'], ['alumina', 'insulatorId'], ['ceramic', 'insulatorId'],
    ['electrode', 'electrodeDiaMm'],
  ],
};

const RULE_WORDS: Record<string, string[]> = {
  'cal.stress': ['stress', 'von mises'],
  'cal.fos': ['factor of safety', 'safety factor', 'fos', 'yield'],
  'cal.mouth': ['mouth', 'opening', 'spread'],
  'cal.piston-fit': ['fit the pistons', 'piston row', 'room for the pistons'],
  'cal.slot-depth': ['pad height', 'pads fit', 'hold the pads'],
  'cal.clamp-balance': ['clamp', 'balance', 'pedal'],
  'plug.tip-min': ['self-clean', 'self clean', 'fouling', 'foul', 'too cold'],
  'plug.tip-max': ['pre-ignition', 'preignition', 'too hot', 'operating point'],
  'plug.tip-range': ['hottest', 'top speed', 'full load', '7000'],
  'plug.tip-idle': ['idle'],
  'plug.insulator-wall': ['insulator wall', 'puncture', 'crack', 'ceramic wall'],
};

const UP = /\b(increase|raise|add|more|thicker|longer|bigger|larger|wider|deeper|taller|up)\b/;
const DOWN = /\b(decrease|reduce|lower|less|thinner|shorter|smaller|narrower|shallower|down|cut)\b/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findParams(component: ComponentId, text: string) {
  const found: { key: string; index: number; syn: string }[] = [];
  const taken: [number, number][] = [];
  const sorted = [...SYNONYMS[component]].sort((a, b) => b[0].length - a[0].length);
  for (const [syn, key] of sorted) {
    const re = new RegExp(`(^|[^a-z0-9])${esc(syn)}(?=$|[^a-z0-9])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      const end = start + syn.length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      found.push({ key, index: start, syn });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function findRule(component: ComponentId, text: string): string | null {
  const prefix = component === 'brake-caliper' ? 'cal.' : 'plug.';
  for (const [id, words] of Object.entries(RULE_WORDS)) {
    if (!id.startsWith(prefix)) continue;
    if (words.some((w) => text.includes(w))) return id;
  }
  return null;
}

function choiceFromText(key: string, t: string): string | null {
  if (key === 'materialId') {
    if (/6061|billet|wrought/.test(t)) return '6061-t6';
    if (/alumin|a356/.test(t)) return 'a356-t6';
    if (/iron|gjs|ductile/.test(t)) return 'gjs-400-18';
  }
  if (key === 'electrodeId') {
    if (/copper/.test(t)) return 'ni-cu';
    if (/solid|nickel/.test(t)) return 'ni';
  }
  if (key === 'insulatorId') {
    if (/99/.test(t)) return 'al2o3-995';
    if (/\b95\b/.test(t)) return 'al2o3-95';
  }
  return null;
}

function snap(spec: ParamSpec<string>, v: number) {
  const clamped = Math.min(spec.max, Math.max(spec.min, v));
  return Number((Math.round(clamped / spec.step) * spec.step).toFixed(Math.max(spec.digits, 2)));
}

interface ParsedChange {
  patch: Patch;
  notes: string[];
  /** True when the user asked for a concrete change (a number or a direction). */
  concrete: boolean;
}

/** Reads every "parameter → value" the question asks for, clause by clause. */
export function parseChanges(component: ComponentId, text: string, current: Record<string, number | string>): ParsedChange {
  const patch: Patch = {};
  const notes: string[] = [];
  let concrete = false;
  const clauses = text.split(/\band\b|,|;|\bplus\b|\balso\b/);
  for (const clause of clauses) {
    for (const hit of findParams(component, clause)) {
      if (hit.key in patch) continue;
      const meta = paramMeta(component, hit.key);
      if (meta.options) {
        const id = choiceFromText(hit.key, clause);
        if (id && id !== current[hit.key]) {
          patch[hit.key] = id;
          concrete = true;
        }
        continue;
      }
      const spec = meta.spec!;
      const cur = Number(current[hit.key]);
      const after = clause.slice(hit.index + hit.syn.length);
      const by = after.match(/\bby\s+(\d+(?:\.\d+)?)\s*(%)?/);
      const num = after.match(/(-?\d+(?:\.\d+)?)/);
      let target: number | null = null;
      if (by) {
        const n = parseFloat(by[1]);
        const delta = by[2] ? (cur * n) / 100 : n;
        target = DOWN.test(clause) && !UP.test(clause) ? cur - delta : cur + delta;
      } else if (num) {
        target = parseFloat(num[1]);
      } else if (UP.test(clause) || DOWN.test(clause)) {
        const stepAmt = Math.max(spec.step, Math.round(((spec.max - spec.min) * 0.1) / spec.step) * spec.step);
        target = cur + (DOWN.test(clause) && !UP.test(clause) ? -stepAmt : stepAmt);
      }
      if (target === null || !Number.isFinite(target)) continue;
      concrete = true;
      const v = snap(spec, target);
      if (Math.abs(v - target) > spec.step / 2 + 1e-9) {
        notes.push(`${spec.label} is limited to ${spec.min}–${spec.max}${unit(spec.unit)} here, so I used ${v.toFixed(spec.digits)}${unit(spec.unit)}.`);
      }
      if (v !== cur) patch[hit.key] = v;
      else notes.push(`${spec.label} is already ${v.toFixed(spec.digits)}${unit(spec.unit)}.`);
    }
  }
  return { patch, notes, concrete };
}

/* ------------------------------------------------------------------ */
/*  Building answers                                                   */
/* ------------------------------------------------------------------ */

function suggestions(component: ComponentId, ctx: InsightContext, plan: Patch): ChatAction[] {
  const out: ChatAction[] = [];
  const vb = ctx.validation.B.verdict;
  if (vb !== 'pass') out.push({ kind: 'ask', label: vb === 'fail' ? 'Why does B fail?' : 'Why does B need review?', question: vb === 'fail' ? 'Why does B fail?' : 'Why does B need review?' });
  const top = ctx.recommendations[0];
  if (top) {
    const to = top.patch[top.parameter];
    const meta = paramMeta(component, top.parameter);
    const q = meta.options ? `What if I use ${formatParam(component, top.parameter, to)}?` : `What if ${meta.label.toLowerCase()} is ${to}?`;
    out.push({ kind: 'ask', label: q, question: q });
  }
  if (vb !== 'pass') out.push({ kind: 'ask', label: 'Optimise B for me', question: 'Optimise B for me' });
  if (vb === 'pass' || Object.keys(plan).length) out.push({ kind: 'ask', label: 'Finalize the decision', question: 'Finalize the decision' });
  return out.slice(0, 3);
}

function changeActions(title: string, patch: Patch, why?: string): ChatAction[] {
  return [
    { kind: 'preview', label: 'Show in 3D', title, patch, why },
    { kind: 'plan-add', label: 'Add to plan', title, patch },
    { kind: 'apply', label: 'Apply to B now', title, patch },
  ];
}

function ruleRows(before: DesignValidation, after: DesignValidation, keys: string[]): string[][] {
  const rows: string[][] = [];
  for (const r of after.results) {
    const b = before.results.find((x) => x.ruleId === r.ruleId);
    const touched = r.parameters.some((p) => keys.includes(p));
    if (!touched && b?.status === r.status) continue;
    rows.push([r.label, b ? fmtR(b) : '—', fmtR(r), `${r.kind === 'max' ? '≤' : '≥'} ${r.limit.toFixed(r.digits)}${unit(r.unit)}`, `${b ? V(b.status) : '—'} → ${V(r.status)}`]);
  }
  return rows;
}

function whatIf(src: InsightSource, ctx: InsightContext, parsed: ParsedChange, plan: Patch): ChatReply {
  const c = src.component;
  const B = getDesign(src, c, 'B');
  const before = ctx.validation.B;
  const designAfter = withPatch(B, parsed.patch);
  const after = validateCandidate(src, c, designAfter);
  const changes = describePatch(c, B, parsed.patch);
  const keys = Object.keys(parsed.patch);
  const lines = [`If candidate B's ${changes.join(' and ')}: verdict ${V(before.verdict)} → ${V(after.verdict)}.`];
  if (verdictRank(after.verdict) > verdictRank(before.verdict)) lines.push('That makes things worse, so I would not take this change on its own.');
  else if (after.verdict === 'pass' && before.verdict !== 'pass') lines.push('That clears every open check.');
  lines.push(...parsed.notes);
  lines.push(...keys.map((k) => PARAM_EFFECT[k]).filter(Boolean));
  const rows = ruleRows(before, after, keys);
  if (c === 'brake-caliper') {
    const m0 = caliperEstimate(B as CaliperDesign, src.caliperInputs).massKg;
    const m1 = caliperEstimate(designAfter as CaliperDesign, src.caliperInputs).massKg;
    rows.push(['Mass', `${m0.toFixed(3)} kg`, `${m1.toFixed(3)} kg`, '—', `${m1 >= m0 ? '+' : '−'}${Math.abs(m1 - m0).toFixed(3)} kg`]);
  }
  const title = changes.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('; ');
  return {
    text: lines.join('\n'),
    table: rows.length ? { head: ['Check', 'B now', 'B after', 'Limit', 'Status'], rows } : undefined,
    actions: [...changeActions(title, parsed.patch, keys.map((k) => PARAM_EFFECT[k]).join(' ')), ...suggestions(c, ctx, plan).slice(0, 1)],
  };
}

function paramEffect(src: InsightSource, ctx: InsightContext, key: string, plan: Patch): ChatReply {
  const c = src.component;
  const B = getDesign(src, c, 'B');
  const meta = paramMeta(c, key);
  const now = paramValue(B, key);
  const lines = [`${meta.label}: ${formatParam(c, key, now)} on candidate B.`, PARAM_EFFECT[key] ?? ''];
  let table: ChatTable | undefined;
  const actions: ChatAction[] = [];
  if (meta.spec) {
    const s = meta.spec;
    const d = Math.max(s.step, Math.round(((s.max - s.min) * 0.1) / s.step) * s.step);
    const lo = snap(s, Number(now) - d);
    const hi = snap(s, Number(now) + d);
    const vLo = validateCandidate(src, c, withPatch(B, { [key]: lo }));
    const vHi = validateCandidate(src, c, withPatch(B, { [key]: hi }));
    const rows: string[][] = [];
    for (const r of ctx.validation.B.results) {
      if (!r.parameters.includes(key)) continue;
      const a = vLo.results.find((x) => x.ruleId === r.ruleId);
      const b = vHi.results.find((x) => x.ruleId === r.ruleId);
      rows.push([r.label, a ? `${fmtR(a)} · ${V(a.status)}` : '—', `${fmtR(r)} · ${V(r.status)}`, b ? `${fmtR(b)} · ${V(b.status)}` : '—']);
    }
    if (rows.length) {
      table = { head: ['Check', `at ${lo}${unit(s.unit)}`, `now ${Number(now).toFixed(s.digits)}${unit(s.unit)}`, `at ${hi}${unit(s.unit)}`], rows };
    }
    lines.push(`Range in this model: ${s.min}–${s.max}${unit(s.unit)}.`);
    if (hi !== Number(now)) actions.push(...changeActions(`${s.label} ${Number(now).toFixed(s.digits)} → ${hi.toFixed(s.digits)}${unit(s.unit)}`, { [key]: hi }, PARAM_EFFECT[key]).slice(0, 1));
    if (lo !== Number(now)) actions.push(...changeActions(`${s.label} ${Number(now).toFixed(s.digits)} → ${lo.toFixed(s.digits)}${unit(s.unit)}`, { [key]: lo }, PARAM_EFFECT[key]).slice(0, 1));
    actions.forEach((a, i) => {
      if (a.kind === 'preview') a.label = i === 0 ? `Show ${hi}${unit(s.unit)} in 3D` : `Show ${lo}${unit(s.unit)} in 3D`;
    });
  } else if (meta.options) {
    const rows: string[][] = [];
    for (const o of meta.options) {
      const v = validateCandidate(src, c, withPatch(B, { [key]: o.id }));
      rows.push([o.name + (o.id === now ? ' (now)' : ''), V(v.verdict), `${v.counts.fail} fail, ${v.counts.review} review`]);
      if (o.id !== now) actions.push({ kind: 'preview', label: `Show ${o.name} in 3D`, title: `Switch ${meta.label.toLowerCase()} to ${o.name}`, patch: { [key]: o.id }, why: PARAM_EFFECT[key] });
    }
    table = { head: ['Option', 'B verdict', 'Open checks'], rows };
  }
  return { text: lines.filter(Boolean).join('\n'), table, actions: [...actions.slice(0, 2), ...suggestions(c, ctx, plan).slice(0, 1)] };
}

function explainVerdict(ctx: InsightContext, plan: Patch): ChatReply {
  const e = explainLocally(ctx);
  const actions: ChatAction[] = [];
  for (const rec of ctx.recommendations.slice(0, 2)) actions.push({ kind: 'preview', label: `Show: ${rec.title}`, title: rec.title, patch: rec.patch, why: rec.rationale });
  if (ctx.recommendations[0]) actions.push({ kind: 'plan-add', label: 'Add the top fix to plan', title: ctx.recommendations[0].title, patch: ctx.recommendations[0].patch });
  return { text: [e.headline, ...e.paragraphs.slice(0, 3)].join('\n'), actions: [...actions, ...suggestions(ctx.component, ctx, plan).filter((a) => a.kind === 'ask' && !a.question.startsWith('Why')).slice(0, 1)] };
}

function explainRule(ctx: InsightContext, ruleId: string, plan: Patch): ChatReply {
  const e = explainLocally(ctx);
  const r = ctx.validation.B.results.find((x) => x.ruleId === ruleId) ?? ctx.validation.A.results.find((x) => x.ruleId === ruleId);
  if (!r) return { text: 'That check does not apply to these designs.', actions: suggestions(ctx.component, ctx, plan) };
  const actions: ChatAction[] = [];
  const rec = ctx.recommendations.find((x) => x.ruleIds.includes(ruleId));
  if (rec) actions.push(...changeActions(rec.title, rec.patch, rec.rationale).slice(0, 2));
  return {
    text: `${r.label} (${r.requirement}), candidate B ${V(r.status)}.\n${e.rules[ruleId] ?? r.why}`,
    actions: [...actions, ...suggestions(ctx.component, ctx, plan).slice(0, 1)],
  };
}

function recommendations(ctx: InsightContext, plan: Patch): ChatReply {
  if (!ctx.recommendations.length) {
    return {
      text: ctx.validation.B.verdict === 'pass' ? 'Candidate B passes every check with margin, so there is nothing to fix.' : 'No single change within the parameter ranges clears the open checks. Try "Optimise B for me" to chain several changes.',
      actions: suggestions(ctx.component, ctx, plan),
    };
  }
  const lines = ctx.recommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r.title}, then B is ${V(r.verdictAfter)}. ${r.rationale}`);
  const actions: ChatAction[] = ctx.recommendations.slice(0, 3).map((r) => ({ kind: 'preview', label: `Show #${ctx.recommendations.indexOf(r) + 1} in 3D`, title: r.title, patch: r.patch, why: r.rationale }) as ChatAction);
  return { text: `Best single changes, each re-checked through the same rules:\n${lines.join('\n')}`, actions: [...actions, { kind: 'plan-add', label: 'Add #1 to plan', title: ctx.recommendations[0].title, patch: ctx.recommendations[0].patch }] };
}

function optimise(src: InsightSource, ctx: InsightContext): ChatReply {
  const c = src.component;
  const plan = optimiseCandidate(src, c);
  if (!plan.steps.length) {
    return { text: `${plan.note}\nCandidate B stays ${V(plan.verdictAfter)}.`, actions: suggestions(c, ctx, {}) };
  }
  const lines = [`Best combination I found within these estimates, step by step:`];
  plan.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.title} → ${V(s.verdictAfter)}`));
  lines.push(`Verdict ${V(plan.verdictBefore)} → ${V(plan.verdictAfter)}. ${plan.note}`);
  if (plan.massKg) lines.push(`Mass ${plan.massKg.before.toFixed(3)} → ${plan.massKg.after.toFixed(3)} kg.`);
  lines.push('This is optimal only within these reduced-order estimates and demo limits; confirm it with a solver run.');
  const title = `Optimised plan (${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''})`;
  return {
    text: lines.join('\n'),
    actions: [
      { kind: 'preview', label: 'Show the plan in 3D', title, patch: plan.patch, why: 'All the steps above, applied together.' },
      { kind: 'plan-add', label: 'Use as my plan', title, patch: plan.patch },
      { kind: 'ask', label: 'Finalize the decision', question: 'Finalize the decision' },
    ],
  };
}

function compare(ctx: InsightContext, plan: Patch): ChatReply {
  const rows = ctx.facts
    .filter((f) => f.source !== 'input')
    .slice(0, 7)
    .map((f) => [f.label, `${f.A.toFixed(f.digits)}${unit(f.unit)}`, `${f.B.toFixed(f.digits)}${unit(f.unit)}`]);
  return {
    text: [`Baseline A: ${V(ctx.validation.A.verdict)}. Candidate B: ${V(ctx.validation.B.verdict)}.`, ...ctx.findings.slice(1, 4).map((f) => f.text)].join('\n'),
    table: { head: ['Quantity', 'A', 'B'], rows },
    actions: suggestions(ctx.component, ctx, plan),
  };
}

function mass(src: InsightSource, ctx: InsightContext, plan: Patch): ChatReply {
  if (src.component !== 'brake-caliper') {
    return {
      text: "The plug model doesn't estimate mass. Its trade-off is heat range: hot enough at idle to burn deposits off, cool enough at full load to stay clear of pre-ignition.",
      actions: suggestions(src.component, ctx, plan),
    };
  }
  const a = caliperEstimate(src.caliper.A, src.caliperInputs).massKg;
  const b = caliperEstimate(src.caliper.B, src.caliperInputs).massKg;
  const lines = [`Mass: baseline A ${a.toFixed(3)} kg, candidate B ${b.toFixed(3)} kg (${b <= a ? '−' : '+'}${Math.abs(((b - a) / a) * 100).toFixed(1)} %).`];
  const actions: ChatAction[] = [];
  const opp = recommendOpportunity(src, 'brake-caliper', ctx.validation.B);
  if (opp) {
    lines.push(`${opp.title}. Every check still passes afterwards.`);
    actions.push(...changeActions(opp.title, opp.patch, opp.rationale));
  } else if (ctx.validation.B.verdict !== 'pass') {
    lines.push('Fix the open checks first; then I can look for a mass saving that keeps every check passing.');
  } else {
    lines.push('No wall can come down another step without a check moving to NEEDS REVIEW.');
  }
  return { text: lines.join('\n'), actions: [...actions, ...suggestions('brake-caliper', ctx, plan).slice(0, 1)] };
}

function planSummary(src: InsightSource, plan: Patch): { lines: string[]; after: DesignValidation | null } {
  const c = src.component;
  const B = getDesign(src, c, 'B');
  if (!Object.keys(plan).length) return { lines: [], after: null };
  const after = validateCandidate(src, c, withPatch(B, plan));
  return { lines: describePatch(c, B, plan), after };
}

function finalize(src: InsightSource, ctx: InsightContext, plan: Patch): ChatReply {
  const { lines, after } = planSummary(src, plan);
  const text: string[] = [];
  if (after) {
    text.push(`Your draft plan changes ${lines.length} parameter${lines.length > 1 ? 's' : ''}: ${lines.join('; ')}.`);
    text.push(`Predicted verdict for B after the plan: ${V(after.verdict)} (now ${V(ctx.validation.B.verdict)}).`);
    if (after.verdict === 'fail') text.push('It would still fail; you can record the decision anyway and it will be marked as failing.');
    text.push('Finalizing applies the plan to candidate B and records the decision with its verdict and your questions.');
  } else {
    text.push(`There's no draft plan, so finalizing records candidate B as it is: ${V(ctx.validation.B.verdict)}.`);
    if (ctx.validation.B.verdict !== 'pass') text.push('Consider "Optimise B for me" or a what-if first.');
  }
  return {
    text: text.join('\n'),
    actions: [
      { kind: 'finalize', label: after ? 'Finalize: apply plan and record' : 'Finalize: record B as it is' },
      ...(after ? [{ kind: 'preview', label: 'Show the plan in 3D', title: 'Draft plan', patch: plan } as ChatAction] : []),
    ],
  };
}

function help(component: ComponentId): ChatReply {
  const examples =
    component === 'brake-caliper'
      ? ['Why does B fail?', 'What if bridge thickness is 24 mm?', 'What does the rib count do?', 'Optimise B for me', 'Compare A and B', 'Finalize the decision']
      : ['Why does B need review?', 'What if nose length is 10 mm?', 'Use a copper core electrode', 'What does protrusion do?', 'Optimise B for me', 'Finalize the decision'];
  return {
    text: `I answer from the same estimates and rules as this page, offline and with no language model. Ask why a check fails, try a change ("what if …"), ask what a parameter does, let me optimise B, then finalize. Changes stay a draft plan until you finalize.`,
    actions: examples.map((q) => ({ kind: 'ask', label: q, question: q }) as ChatAction).slice(0, 6),
  };
}

const GLOSSARY = {
  review:
    'NEEDS REVIEW means the value is inside its limit but closer than the estimate’s own uncertainty, or the rule only flags it for an engineer. It is not a failure: it says "check this with a better model before trusting the margin".',
  margin:
    'Margin is how far a value sits from its limit, as a share of the limit. +25 % means a quarter of the limit to spare; a negative margin means the limit is exceeded by that much.',
  fea: 'No. These verdicts come from reduced-order hand-calculation estimates checked against demo limits, not from a finite-element solver or tests, and nothing here is validated against measurements. Use them to compare A and B and to see which way a change pushes the design; confirm the final design with a solver run.',
  ai: 'This assistant is rule-based: it answers from the same estimates and rules as the rest of the page, offline, with no language model. A model could be connected later through the AutoTwin backend, but it would only phrase answers; verdicts would still come from the rules.',
};

/** The local, rule-based answer to one question. */
export function localReply(question: string, src: InsightSource, ctx: InsightContext, plan: Patch): ChatReply {
  const c = src.component;
  const t = question.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  if (!t) return help(c);
  if (/^(hi|hello|hey|yo)\b|\bhelp\b|what can you|how do i use/.test(t)) return help(c);
  if (/\b(undo|revert|go back)\b/.test(t)) return { text: 'This undoes the last change applied to candidate B from AI Insights.', actions: [{ kind: 'undo', label: 'Undo last change' }] };
  if (/\b(finali[sz]e|lock (it|in)|commit|decide|decision|go with (this|it|that)|confirm|sign off)\b/.test(t)) return finalize(src, ctx, plan);
  if (/\b(optimi[sz]e|optimal|best (design|solution|combination|option)|auto[- ]?fix|fix (it|everything|all|b)|make (it|b) pass)\b/.test(t)) return optimise(src, ctx);
  if (/\b(my |the |current |draft )?plan\b/.test(t) && !/\bexplain\b/.test(t)) {
    const { lines, after } = planSummary(src, plan);
    return after
      ? { text: `Draft plan: ${lines.join('; ')}.\nPredicted verdict for B: ${V(after.verdict)}.`, actions: [{ kind: 'preview', label: 'Show the plan in 3D', title: 'Draft plan', patch: plan }, { kind: 'ask', label: 'Finalize the decision', question: 'Finalize the decision' }] }
      : { text: 'The draft plan is empty. Add changes with "Add to plan", or ask me to optimise B.', actions: suggestions(c, ctx, plan) };
  }

  const B = getDesign(src, c, 'B') as unknown as Record<string, number | string>;
  const parsed = parseChanges(c, t, B);
  const askingAbout = /\b(what does|what do|effect|affect|influence|how does|how do|role of|impact|what is)\b/.test(t);
  if (Object.keys(parsed.patch).length && (parsed.concrete || !askingAbout)) return whatIf(src, ctx, parsed, plan);
  if (parsed.notes.length && !Object.keys(parsed.patch).length) return { text: parsed.notes.join('\n'), actions: suggestions(c, ctx, plan) };

  if (/\b(fea|finite|accurate|accuracy|trust|reliable|validated|real result|solver|certif)\w*/.test(t)) return { text: GLOSSARY.fea, actions: suggestions(c, ctx, plan) };
  if (/\b(llm|gpt|gemini|language model|chatgpt|are you (an )?ai|real ai)\b/.test(t)) return { text: GLOSSARY.ai, actions: suggestions(c, ctx, plan) };
  if (/needs? review|review mean|what is review/.test(t)) return { text: GLOSSARY.review, actions: suggestions(c, ctx, plan) };
  if (/\bmargin\b/.test(t)) return { text: GLOSSARY.margin, actions: suggestions(c, ctx, plan) };
  if (/\b(limits?|load case|requirements?)\b/.test(t)) return { text: `Limits in force (demo values, editable in the Design Lab): ${ctx.loadCase}.`, actions: suggestions(c, ctx, plan) };
  if (/\b(compare|comparison|difference|differ|vs|versus|a and b)\b/.test(t)) return compare(ctx, plan);
  if (/\b(mass|weight|heavy|lighter|heavier|weigh)\b/.test(t)) return mass(src, ctx, plan);

  const ruleId = findRule(c, t);
  if (ruleId && /\b(why|what|explain|how|tell|mean)\b/.test(t)) return explainRule(ctx, ruleId, plan);
  const params = findParams(c, t);
  if (params.length) return paramEffect(src, ctx, params[0].key, plan);
  if (ruleId) return explainRule(ctx, ruleId, plan);
  if (/\b(fix|improve|recommend|suggest|should i|next step|how (do|can) i)\b/.test(t)) return recommendations(ctx, plan);
  if (/\b(why|fail|failing|review|wrong|problem|issue|verdict|status|pass)\b/.test(t)) return explainVerdict(ctx, plan);

  return {
    text: "I didn't catch that. I can explain the verdict, try a change, say what a parameter does, compare A and B, optimise B, or record the decision. For example:",
    actions: help(c).actions,
  };
}
