/**
 * Engineering report for one component: design A vs design B, their checks,
 * the analytics and the recorded experiment runs. buildReport() gathers the
 * data once; the Reports page renders it as a printable sheet and
 * reportMarkdown() writes the same content as Markdown, so the two can't drift.
 *
 * Pure functions, no React, no backend: everything comes from the workspace.
 */
import { atDesign, outputsFor, sensitivity } from './analytics.ts';
import type { AnalyticsSource, OutputDef, SensitivityRow } from './analytics.ts';
import { COMPONENT_LABEL } from './designs.ts';
import type { ComponentId, Slot } from './designs.ts';
import { materialDiffs, parameterDiffs, pctChange } from './metrics.ts';
import { VERDICT_LABEL, validateBoth } from './validation.ts';
import type { DesignValidation, RuleResult, Verdict } from './validation.ts';
import type { ExperimentRun } from './WorkspaceStore.ts';

export type SectionId = 'summary' | 'changes' | 'designPoint' | 'checks' | 'sensitivity' | 'runs' | 'method';

export const SECTION_LABEL: Record<SectionId, string> = {
  summary: 'Summary and verdict',
  changes: 'What changed, A → B',
  designPoint: 'Results at the design point',
  checks: 'Design checks',
  sensitivity: 'Sensitivity',
  runs: 'Experiment runs',
  method: 'Method and limitations',
};

export const SECTION_ORDER: SectionId[] = ['summary', 'changes', 'designPoint', 'checks', 'sensitivity', 'runs', 'method'];

export interface ReportOptions {
  component: ComponentId;
  title: string;
  preparedBy: string;
  notes: string;
  sections: Record<SectionId, boolean>;
  /** Experiment runs to include (ids), in the order given. */
  runIds: string[];
}

export interface ReportSource extends AnalyticsSource {
  runs: ExperimentRun[];
}

export interface CheckRow {
  ruleId: string;
  label: string;
  requirement: string;
  unit: string;
  digits: number;
  A?: RuleResult;
  B?: RuleResult;
}

export interface ReportData {
  options: ReportOptions;
  componentLabel: string;
  generatedAt: number;
  revisions: Record<Slot, string>;
  validation: Record<Slot, DesignValidation>;
  headline: string[];
  changes: { label: string; unit: string; digits: number; A: number; B: number }[];
  materials: { label: string; A: string; B: string }[];
  designPoint: (OutputDef & { A: number; B: number })[];
  checks: CheckRow[];
  /** Main result the sensitivity is shown for. */
  sensitivityOutput: OutputDef;
  sensitivity: SensitivityRow[];
  runs: (ExperimentRun & { stale: boolean })[];
  method: string[];
  limitations: string[];
}

const fmtNum = (v: number, d = 0) => {
  if (!Number.isFinite(v)) return '—';
  const r = Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v;
  return r.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const unitSuffix = (u: string) => (u === '–' || u === '' ? '' : ` ${u}`);
const signedPct = (p: number | null) => (p === null ? '' : `${p > 0 ? '+' : ''}${fmtNum(p, Math.abs(p) < 10 ? 1 : 0)} %`);

export function defaultOptions(c: ComponentId, runs: ExperimentRun[]): ReportOptions {
  return {
    component: c,
    title: `${COMPONENT_LABEL[c]}: design B vs design A`,
    preparedBy: '',
    notes: '',
    sections: { summary: true, changes: true, designPoint: true, checks: true, sensitivity: true, runs: true, method: true },
    runIds: runs.filter((r) => r.component === c).slice(0, 5).map((r) => r.id),
  };
}

/** Verdict counts as words: "9 PASS, 1 NEEDS REVIEW". */
export function countsText(v: DesignValidation) {
  return (['pass', 'review', 'fail'] as Verdict[])
    .filter((k) => v.counts[k] > 0)
    .map((k) => `${v.counts[k]} ${VERDICT_LABEL[k]}`)
    .join(', ');
}

export function buildReport(src: ReportSource, options: ReportOptions, now = Date.now()): ReportData {
  const c = options.component;
  const vsrc = { ...src, component: c };
  const validation = validateBoth(src, c);
  const designs = c === 'brake-caliper' ? src.caliper : src.plug;
  const revisions = { A: designs.A.revision, B: designs.B.revision };

  const changes = parameterDiffs(vsrc, c).filter((r) => Math.abs(r.B - r.A) > 1e-9);
  const materials = materialDiffs(vsrc, c).filter((m) => m.A !== m.B);
  const designPoint = outputsFor(src, c).map((o) => ({ ...o, ...atDesign(src, c, o.key) }));

  // One row per rule, A and B side by side.
  const byId = new Map<string, CheckRow>();
  for (const slot of ['A', 'B'] as Slot[]) {
    for (const r of validation[slot].results) {
      const row = byId.get(r.ruleId) ?? { ruleId: r.ruleId, label: r.label, requirement: r.requirement, unit: r.unit, digits: r.digits };
      row[slot] = r;
      byId.set(r.ruleId, row);
    }
  }

  const sensitivityOutput = outputsFor(src, c)[0];
  const sens = sensitivity(src, c, sensitivityOutput.key).slice(0, 6);

  const current = JSON.stringify(designs);
  const runs = options.runIds
    .map((id) => src.runs.find((r) => r.id === id))
    .filter((r): r is ExperimentRun => !!r && r.component === c)
    .map((r) => ({ ...r, stale: !!r.designs && JSON.stringify(r.designs) !== current }));

  // Headline: the verdicts, then the two biggest relative moves at the design point.
  const headline: string[] = [
    `Design A (${revisions.A}): ${VERDICT_LABEL[validation.A.verdict]} (${countsText(validation.A)}).`,
    `Design B (${revisions.B}): ${VERDICT_LABEL[validation.B.verdict]} (${countsText(validation.B)}).`,
  ];
  const n = changes.length + materials.length;
  if (n === 0) headline.push('A and B are identical, so every result is the same for both.');
  else {
    const moves = designPoint
      .map((d) => ({ d, p: pctChange(d.A, d.B) }))
      .filter((m) => m.p !== null && Math.abs(m.p) >= 0.5)
      .sort((x, y) => Math.abs(y.p!) - Math.abs(x.p!))
      .slice(0, 3)
      .map((m) => `${m.d.label.toLowerCase()} ${signedPct(m.p)}`);
    headline.push(
      `B differs from A in ${n} ${n === 1 ? 'setting' : 'settings'}` + (moves.length ? `; at the design point that moves ${moves.join(', ')}.` : '.'),
    );
  }

  const method =
    c === 'brake-caliper'
      ? [
          'Stress, mouth opening and factor of safety: a hand-calculation beam model of the bridge with rigid legs, loaded by the clamp force at the pad centre (reduced-order estimate).',
          'Stopping and heating runs: the simplified, lumped brake dynamics used by the Digital Twin (illustrative model).',
          'Sensitivity: one-at-a-time, each parameter ±10 % (±1 for counts) from each design’s own value.',
        ]
      : [
          'Tip temperature: the insulator nose and centre electrode treated as one fin heated by the gas and cooled at the shell seat (reduced-order estimate).',
          'Gas-side heat transfer scales with engine speed (exponent 0.8) and load; gas and seat temperatures are demo inputs.',
          'Sensitivity: one-at-a-time, each parameter ±10 % from each design’s own value.',
        ];
  const limitations = [
    'No finite-element solver was run for these numbers, and nothing here is validated against physical tests.',
    'Use the direction and relative size of the A → B change, not the absolute values.',
    'Limits and load cases are the values configured in the Design Lab; several defaults are demo fixtures.',
    'This report is not a certification and not a substitute for physical validation.',
  ];

  return {
    options,
    componentLabel: COMPONENT_LABEL[c],
    generatedAt: now,
    revisions,
    validation,
    headline,
    changes,
    materials,
    designPoint,
    checks: [...byId.values()],
    sensitivityOutput,
    sensitivity: sens,
    runs,
    method,
    limitations,
  };
}

/* ------------------------------------------------------------------ */
/*  Markdown                                                           */
/* ------------------------------------------------------------------ */

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
function mdTable(head: string[], rows: string[][]) {
  return [`| ${head.map(mdCell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');
}
const ruleVal = (r: RuleResult | undefined) => (r ? `${fmtNum(r.value, r.digits)}${unitSuffix(r.unit)} ${VERDICT_LABEL[r.status]}` : '—');
const dateText = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export function reportMarkdown(d: ReportData): string {
  const o = d.options;
  const s = o.sections;
  const out: string[] = [];
  out.push(`# ${o.title}`, '');
  out.push(`**Component:** ${d.componentLabel}  `);
  out.push(`**Design A (reference):** ${d.revisions.A}  `);
  out.push(`**Design B (candidate):** ${d.revisions.B}  `);
  out.push(`**Generated:** ${dateText(d.generatedAt)}  `);
  if (o.preparedBy.trim()) out.push(`**Prepared by:** ${o.preparedBy.trim()}  `);
  out.push('**Evidence level:** reduced-order estimates and simplified dynamics. Not FEA, not validated.', '');

  if (s.summary) {
    out.push('## Summary and verdict', '', ...d.headline.map((h) => `- ${h}`), '');
    if (o.notes.trim()) out.push('**Notes:** ' + o.notes.trim(), '');
  }
  if (s.changes) {
    out.push('## What changed, A → B', '');
    if (!d.changes.length && !d.materials.length) out.push('A and B are identical.', '');
    else {
      out.push(
        mdTable(
          ['Setting', 'A', 'B', 'B − A'],
          [
            ...d.materials.map((m) => [m.label, m.A, m.B, 'material']),
            ...d.changes.map((c) => [
              `${c.label}${c.unit === '–' ? '' : ` (${c.unit})`}`,
              fmtNum(c.A, c.digits),
              fmtNum(c.B, c.digits),
              `${c.B > c.A ? '+' : ''}${fmtNum(c.B - c.A, c.digits)} (${signedPct(pctChange(c.A, c.B))})`,
            ]),
          ],
        ),
        '',
      );
    }
  }
  if (s.designPoint) {
    out.push('## Results at the design point', '', '_Estimated (reduced-order)._', '');
    out.push(
      mdTable(
        ['Result', 'Limit', 'A', 'B', 'B − A'],
        d.designPoint.map((r) => [
          `${r.label}${r.unit === '–' ? '' : ` (${r.unit})`}`,
          r.limit?.label ?? '—',
          fmtNum(r.A, r.digits),
          fmtNum(r.B, r.digits),
          signedPct(pctChange(r.A, r.B)) || '—',
        ]),
      ),
      '',
    );
  }
  if (s.checks) {
    out.push('## Design checks', '');
    out.push(mdTable(['Check', 'Requirement', 'A', 'B'], d.checks.map((c) => [c.label, c.requirement, ruleVal(c.A), ruleVal(c.B)])), '');
    const reasons = d.checks.flatMap((c) => (['A', 'B'] as Slot[]).map((k) => c[k]).filter((r): r is RuleResult => !!r?.reviewReason).map((r) => `${c.label}: ${r.reviewReason}`));
    if (reasons.length) out.push('Review notes:', '', ...[...new Set(reasons)].map((r) => `- ${r}`), '');
  }
  if (s.sensitivity) {
    out.push(`## Sensitivity: ${d.sensitivityOutput.label}`, '', '_% change in the result when the parameter goes up / down by 10 % (±1 for counts)._', '');
    out.push(
      mdTable(
        ['Parameter', 'A up', 'A down', 'B up', 'B down'],
        d.sensitivity.map((r) => [r.param.label, signedPct(r.A.hi), signedPct(r.A.lo), signedPct(r.B.hi), signedPct(r.B.lo)]),
      ),
      '',
    );
  }
  if (s.runs) {
    out.push('## Experiment runs', '');
    if (!d.runs.length) out.push('No runs selected.', '');
    for (const r of d.runs) {
      out.push(`### ${r.title}`, '');
      out.push(`${dateText(r.createdAt)} · ${r.source === 'model' ? 'simplified model' : 'estimate'} · ${r.conditions}  `);
      out.push(`Tested: A ${r.revisions.A}, B ${r.revisions.B}${r.stale ? ' (the Design Lab has changed since this run)' : ''}`, '');
      out.push(
        mdTable(
          ['Result', 'A', 'B', 'B − A'],
          [
            ...r.metrics.map((m) => [
              `${m.label}${m.unit === '–' ? '' : ` (${m.unit})`}`,
              fmtNum(m.A, m.digits),
              fmtNum(m.B, m.digits),
              `${m.B > m.A ? '+' : ''}${fmtNum(m.B - m.A, m.digits)}`,
            ]),
            ['Feasible', r.feasible.A ? 'yes' : 'no', r.feasible.B ? 'yes' : 'no', ''],
          ],
        ),
        '',
      );
    }
  }
  if (s.method) {
    out.push('## Method and limitations', '', ...d.method.map((m) => `- ${m}`), '', ...d.limitations.map((l) => `- ${l}`), '');
  }
  return out.join('\n');
}
