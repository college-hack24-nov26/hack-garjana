import { useEffect, useRef, useState } from 'react';

/**
 * Two-series line chart for design A vs design B (SVG, no chart library).
 *
 * A is amber, B is cyan. These two shades were checked for the dark surface:
 * lightness band, chroma, colour-blind and normal-vision separation all pass.
 * Text stays in the normal text colours; the coloured marks carry identity.
 * Hover anywhere on the plot for a crosshair and both values.
 */
export const SERIES_COLOR = { A: '#c2800f', B: '#1d9bd8' } as const;

export interface ABPoint {
  x: number;
  A: number;
  B: number;
}

export interface ABChartProps {
  title: string;
  unit: string;
  points: ABPoint[];
  labels: { A: string; B: string };
  xLabel: string;
  xFormat?: (v: number) => string;
  digits?: number;
  /** Shaded horizontal band, e.g. the spark plug's heat-range window. */
  band?: { min: number; max: number; label: string };
  /** Dashed vertical lines at x, e.g. where design A and design B sit on a parameter sweep. */
  markers?: { A?: number; B?: number };
  /** Force the y axis to include zero. */
  zeroBased?: boolean;
  height?: number;
}

const PAD = { l: 46, r: 14, t: 10, b: 30 };

function niceStep(range: number, ticks: number) {
  const raw = Math.max(range, 1e-9) / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const tickText = (v: number) => (Math.abs(v) >= 10000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(3)}`);

export function ABChart({
  title,
  unit,
  points,
  labels,
  xLabel,
  xFormat = (v) => `${+v.toFixed(2)}`,
  digits = 1,
  band,
  zeroBased = false,
  height = 220,
  markers,
}: ABChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div className="abchart" ref={wrap}>
        <div className="abchart-title">{title}</div>
        <div className="hint">Not enough points to plot.</div>
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let lo = Math.min(...points.map((p) => Math.min(p.A, p.B)));
  let hi = Math.max(...points.map((p) => Math.max(p.A, p.B)));
  if (band) {
    lo = Math.min(lo, band.min);
    hi = Math.max(hi, band.max);
  }
  if (zeroBased) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  const yLo = Math.floor(lo / step) * step;
  const yHi = Math.ceil(hi / step) * step;

  const pw = w - PAD.l - PAD.r;
  const ph = height - PAD.t - PAD.b;
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * pw;
  const sy = (v: number) => PAD.t + (1 - (v - yLo) / (yHi - yLo)) * ph;
  const path = (k: 'A' | 'B') => points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p[k]).toFixed(1)}`).join('');

  const yTicks: number[] = [];
  for (let v = yLo; v <= yHi + step * 1e-6; v += step) yTicks.push(v);
  const xStep = niceStep(x1 - x0, Math.max(3, Math.floor(pw / 90)));
  const xTicks: number[] = [];
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1 + xStep * 1e-6; v += xStep) xTicks.push(v);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const xv = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - xv) < Math.abs(points[best].x - xv)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="abchart" ref={wrap}>
      <div className="abchart-head">
        <div className="abchart-title">{title}</div>
        <div className="abchart-legend" aria-label="Legend">
          <span>
            <i style={{ borderColor: SERIES_COLOR.A }} />A · {labels.A}
          </span>
          <span>
            <i style={{ borderColor: SERIES_COLOR.B }} />B · {labels.B}
          </span>
          {band && (
            <span>
              <i className="band" />
              {band.label}
            </span>
          )}
        </div>
      </div>
      <svg width={w} height={height} role="img" aria-label={`${title}: design A vs design B against ${xLabel}`}>
        {band && (
          <rect
            x={PAD.l}
            width={pw}
            y={sy(Math.min(band.max, yHi))}
            height={Math.max(0, sy(Math.max(band.min, yLo)) - sy(Math.min(band.max, yHi)))}
            className="ab-band"
          />
        )}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={w - PAD.r} y1={sy(v)} y2={sy(v)} className="ab-grid" />
            <text x={PAD.l - 6} y={sy(v) + 3.5} className="ab-tick" textAnchor="end">
              {tickText(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={height - PAD.b + 14} className="ab-tick" textAnchor="middle">
            {xFormat(v)}
          </text>
        ))}
        <text x={PAD.l + pw / 2} y={height - 3} className="ab-axis" textAnchor="middle">
          {xLabel}
        </text>
        <text x={4} y={PAD.t + 2} className="ab-axis" dominantBaseline="hanging">
          {unit}
        </text>
        <path d={path('A')} fill="none" stroke={SERIES_COLOR.A} strokeWidth={2} strokeLinejoin="round" />
        <path d={path('B')} fill="none" stroke={SERIES_COLOR.B} strokeWidth={2} strokeLinejoin="round" />
        {/* Direct labels at the line ends, in text colour beside the coloured mark. */}
        {markers &&
          (['A', 'B'] as const).map((k) => {
            const mx = markers[k];
            if (mx === undefined || mx < x0 || mx > x1) return null;
            // When A and B sit at the same x, offset B's tag so both stay readable.
            const same = markers.A !== undefined && markers.B !== undefined && Math.abs(markers.A - markers.B) < 1e-9;
            return (
              <g key={`m${k}`} pointerEvents="none">
                <line x1={sx(mx)} x2={sx(mx)} y1={PAD.t} y2={PAD.t + ph} stroke={SERIES_COLOR[k]} strokeDasharray="4 3" strokeWidth={1.25} />
                <text x={sx(mx) + 3} y={PAD.t + 10 + (same && k === 'B' ? 12 : 0)} className="ab-end" style={{ fill: SERIES_COLOR[k] }}>
                  {k}
                </text>
              </g>
            );
          })}
        <text x={sx(last.x) - 4} y={sy(last.A) - 6} className="ab-end" textAnchor="end">
          A
        </text>
        <text x={sx(last.x) - 4} y={sy(last.B) - 6} className="ab-end" textAnchor="end">
          B
        </text>
        {hp && (
          <g pointerEvents="none">
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={PAD.t} y2={PAD.t + ph} className="ab-cross" />
            <circle cx={sx(hp.x)} cy={sy(hp.A)} r={4.5} fill={SERIES_COLOR.A} className="ab-dot" />
            <circle cx={sx(hp.x)} cy={sy(hp.B)} r={4.5} fill={SERIES_COLOR.B} className="ab-dot" />
          </g>
        )}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={pw}
          height={ph}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div
          className="tooltip ab-tip"
          style={{ left: Math.min(Math.max(sx(hp.x), 90), w - 90), top: PAD.t + 28 }}
        >
          <div className="tt-t">
            {xLabel}: {xFormat(hp.x)}
          </div>
          <div>
            <span className="swatch" style={{ background: SERIES_COLOR.A }} />A{' '}
            <span className="tt-v">
              {hp.A.toFixed(digits)} {unit}
            </span>
          </div>
          <div>
            <span className="swatch" style={{ background: SERIES_COLOR.B }} />B{' '}
            <span className="tt-v">
              {hp.B.toFixed(digits)} {unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
