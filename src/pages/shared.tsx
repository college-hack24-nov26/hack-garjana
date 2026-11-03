import { fmt } from '../ui/primitives';
import { pctChange } from '../workspace/metrics';
import { VERDICT_LABEL, resultDetail } from '../workspace/validation';
import type { RuleResult, Verdict } from '../workspace/validation';

const MARK: Record<Verdict, string> = { pass: '✓', review: '!', fail: '✕' };

/** PASS / NEEDS REVIEW / FAIL as a labelled chip (never colour alone). */
export function VerdictTag({ verdict, size = 'sm' }: { verdict: Verdict; size?: 'sm' | 'lg' }) {
  return (
    <span className={`vtag ${verdict} ${size}`}>
      <span aria-hidden="true">{MARK[verdict]}</span> {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** Compact list of rule results with their "value vs limit" detail. */
export function ChecksList({ title, results }: { title: string; results: RuleResult[] }) {
  return (
    <div className="checks">
      <div className="checks-title">{title}</div>
      {results.map((r) => (
        <div key={r.ruleId} className={`check ${r.status}`} title={r.reviewReason}>
          <span className="mark" aria-label={VERDICT_LABEL[r.status]}>
            {MARK[r.status]}
          </span>
          <span className="l">
            {r.label} <span className="muted">{r.requirement}</span>
          </span>
          <span className="d">{resultDetail(r)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * B − A as a table cell. With `lowerIsBetter` set, the change is coloured
 * green when B improves on A and red when it's worse; otherwise it stays neutral.
 */
export function DeltaCell({
  a,
  b,
  digits,
  lowerIsBetter = null,
  percent = false,
}: {
  a: number;
  b: number;
  digits: number;
  lowerIsBetter?: boolean | null;
  percent?: boolean;
}) {
  const d = b - a;
  if (Math.abs(d) < 0.5 * Math.pow(10, -digits)) return <td className="r delta same">—</td>;
  const better = lowerIsBetter === null ? null : lowerIsBetter ? d < 0 : d > 0;
  const cls = better === null ? 'neutral' : better ? 'better' : 'worse';
  const p = pctChange(a, b);
  return (
    <td className={`r delta ${cls}`}>
      {d > 0 ? '+' : ''}
      {fmt(d, digits)}
      {percent && p !== null && (
        <small>
          {' '}
          ({p > 0 ? '+' : ''}
          {fmt(p, 1)}%)
        </small>
      )}
    </td>
  );
}

/** Signed margin as text: "+12.4 % margin" or "10.3 % over". */
export function marginText(r: RuleResult) {
  const pct = Math.abs(r.margin * 100);
  if (r.margin < 0) return `${fmt(pct, 1)} % over`;
  return `${fmt(pct, 1)} % margin`;
}

export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
