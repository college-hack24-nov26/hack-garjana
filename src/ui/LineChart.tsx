import { useEffect, useRef, useState } from 'react';

/**
 * Canvas line chart used by both modules. One series, an optional dashed grey
 * reference line, a live marker, and a crosshair with tooltip on hover.
 */
export interface LineChartProps<T> {
  title: string;
  unit: string;
  color: string;
  data: T[];
  /** Change this whenever `data` changes, since the array may be updated in place. */
  version: number | string;
  x: (d: T) => number;
  y: (d: T) => number;
  xMax: number;
  xMin?: number;
  /** Gap between x ticks. Picked automatically if you leave it out. */
  xStep?: number;
  /** Tick label, e.g. v => `${v}s` or `${v}°`. */
  xTick: (v: number) => string;
  /** Tooltip x label, e.g. v => `t = 1.20 s`. */
  xTip: (v: number) => string;
  reference?: (d: T) => number;
  referenceLabel?: string;
  seriesLabel: string;
  digits?: number;
  /** The top of the y axis never goes below this. */
  minYMax: number;
  /** Fixed bottom of the y axis. Defaults to 0, or lower if the data goes negative. */
  yMin?: number;
  /** Live marker. Defaults to the last data point. */
  marker?: { x: number; y: number } | null;
  /** Value shown in the header. Defaults to the marker's value. */
  headValue?: number;
}

const GRID = 'rgba(148, 163, 184, 0.10)';
const ZERO = 'rgba(148, 163, 184, 0.28)';
const AXIS_TEXT = '#64748b';
const REF = '#94a3b8';
const PAD = { l: 42, r: 8, t: 8, b: 20 };

function niceStep(range: number, ticks: number) {
  const raw = Math.max(range, 1e-9) / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const yLabel = (v: number) =>
  Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`;

export function LineChart<T>(props: LineChartProps<T>) {
  const {
    title, unit, color, data, version, x, y, xMax, xMin = 0, xStep, xTick, xTip,
    reference, referenceLabel, seriesLabel, digits = 0, minYMax,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 300, h: 150 });

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- scales (used by both drawing and hover) ----
  let hi = minYMax;
  let lo = 0;
  for (const d of data) {
    const v = y(d);
    hi = Math.max(hi, v, reference ? reference(d) : -Infinity);
    lo = Math.min(lo, v, reference ? reference(d) : Infinity);
  }
  const yMin0 = props.yMin ?? lo;
  const yStep = niceStep(hi - yMin0, 4);
  const yMin = Math.floor(yMin0 / yStep) * yStep;
  const yMax = Math.ceil(hi / yStep) * yStep;
  const pw = Math.max(10, size.w - PAD.l - PAD.r);
  const ph = Math.max(10, size.h - PAD.t - PAD.b);
  const X = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin)) * pw;
  const Y = (v: number) => PAD.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

  const last = data.length ? data[data.length - 1] : null;
  const marker = props.marker === undefined ? (last ? { x: x(last), y: y(last) } : null) : props.marker;
  const hovered = hoverX !== null ? nearest(data, x, xMin + ((hoverX - PAD.l) / pw) * (xMax - xMin)) : null;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';

    // Grid and y labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = yMin; v <= yMax + yStep * 1e-6; v += yStep) {
      const yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < yStep * 1e-6 && yMin < 0 ? ZERO : GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, yy);
      ctx.lineTo(PAD.l + pw, yy);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.fillText(yLabel(v), PAD.l - 6, yy);
    }
    // x labels
    const step = xStep ?? niceStep(xMax - xMin, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = Math.ceil(xMin / step) * step; v <= xMax + step * 1e-6; v += step) {
      ctx.fillStyle = AXIS_TEXT;
      ctx.fillText(xTick(v), Math.min(Math.max(X(v), PAD.l + 8), PAD.l + pw - 12), PAD.t + ph + 6);
    }
    if (!data.length) return;

    // Reference line (dashed grey)
    if (reference) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = REF;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      data.forEach((d, i) => (i === 0 ? ctx.moveTo(X(x(d)), Y(reference(d))) : ctx.lineTo(X(x(d)), Y(reference(d)))));
      ctx.stroke();
      ctx.restore();
    }

    // Main line (2px) with a soft fill down to zero
    const base = Y(Math.max(yMin, 0));
    ctx.beginPath();
    data.forEach((d, i) => (i === 0 ? ctx.moveTo(X(x(d)), Y(y(d))) : ctx.lineTo(X(x(d)), Y(y(d)))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(X(x(data[data.length - 1])), base);
    ctx.lineTo(X(x(data[0])), base);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ph);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();

    const dot = (px: number, py: number) => {
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f182b';
      ctx.stroke();
    };
    if (marker) dot(X(marker.x), Y(marker.y));

    if (hovered) {
      const hx = X(x(hovered));
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, PAD.t);
      ctx.lineTo(hx, PAD.t + ph);
      ctx.stroke();
      dot(hx, Y(y(hovered)));
    }
  }, [version, size, hoverX, xMin, xMax, yMin, yMax, color, marker?.x, marker?.y]);

  const head = props.headValue ?? marker?.y ?? 0;

  return (
    <div className="panel chart">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-now">
          {head.toFixed(digits)}
          <small>{unit}</small>
        </span>
      </div>
      <div
        className="chart-canvas"
        ref={wrapRef}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          setHoverX(px >= PAD.l && px <= PAD.l + pw ? px : null);
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        <canvas ref={canvasRef} role="img" aria-label={`${title} chart`} />
        {hovered && (
          <div className="tooltip" style={{ left: X(x(hovered)), top: Math.max(14, Y(y(hovered)) - 8) }}>
            <div className="tt-t">{xTip(x(hovered))}</div>
            <div className="tt-v">
              {seriesLabel}: {y(hovered).toFixed(digits)} {unit}
            </div>
            {reference && (
              <div className="tt-t">
                {referenceLabel}: {reference(hovered).toFixed(digits)} {unit}
              </div>
            )}
          </div>
        )}
      </div>
      {reference && (
        <div className="chart-key">
          <span>
            <i style={{ borderColor: color }} />
            {seriesLabel}
          </span>
          <span>
            <i className="dash" style={{ borderColor: REF }} />
            {referenceLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function nearest<T>(data: T[], x: (d: T) => number, v: number): T | null {
  if (!data.length) return null;
  let lo = 0;
  let hi = data.length - 1;
  if (v >= x(data[hi])) return data[hi];
  if (v <= x(data[0])) return data[0];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x(data[mid]) < v) lo = mid;
    else hi = mid;
  }
  return Math.abs(x(data[lo]) - v) < Math.abs(x(data[hi]) - v) ? data[lo] : data[hi];
}
