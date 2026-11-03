/**
 * Decorative illustration for the bottom of the sidebar: a wheel corner
 * (tyre, twin-spoke alloy rim, drilled brake disc, fixed caliper) drawn as a
 * blueprint. The wheel turns slowly while the caliper stays put, and the
 * spin stops for users who prefer reduced motion.
 */
const C = 150; // centre of the 300×300 view box

const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};

/** Closed band between two radii, from angle a0 to a1 (degrees, clockwise from +x). */
function bandPath(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

const TREAD = Array.from({ length: 60 }, (_, i) => i * 6);
const HOLES = [62, 71, 80].flatMap((r, ring) => Array.from({ length: 16 }, (_, i) => polar(r, i * 22.5 + ring * 7.5)));
const SPOKES = [0, 72, 144, 216, 288];
const LUGS = SPOKES.map((a) => polar(19, a + 36 - 90));

export function SidebarArt() {
  return (
    <svg className="at-art" viewBox="0 0 300 300" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="at-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.45" />
          <stop offset="70%" stopColor="#1d4ed8" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="at-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dbe7f7" />
          <stop offset="45%" stopColor="#7d93b4" />
          <stop offset="100%" stopColor="#24344f" />
        </linearGradient>
        <linearGradient id="at-tyre" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e2a40" />
          <stop offset="100%" stopColor="#090f1c" />
        </linearGradient>
        <radialGradient id="at-disc" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#8a9ab3" />
          <stop offset="60%" stopColor="#4a5a74" />
          <stop offset="100%" stopColor="#273449" />
        </radialGradient>
        <linearGradient id="at-caliper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fdba74" />
          <stop offset="55%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#9a3412" />
        </linearGradient>
      </defs>

      <circle cx={C} cy={C} r="150" fill="url(#at-glow)" />

      {/* Tyre, rim barrel and brake disc: spin together */}
      <g className="at-spin">
        <circle cx={C} cy={C} r="138" fill="url(#at-tyre)" stroke="#2b3b58" strokeWidth="1.2" />
        {TREAD.map((a) => {
          const [x0, y0] = polar(131, a);
          const [x1, y1] = polar(138, a);
          return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#33445f" strokeWidth="2.2" />;
        })}
        <circle cx={C} cy={C} r="122" fill="none" stroke="#1b2740" strokeWidth="1" />
        <circle cx={C} cy={C} r="111" fill="#0a1222" stroke="url(#at-metal)" strokeWidth="7" />
        <circle cx={C} cy={C} r="104" fill="none" stroke="#3b4d6b" strokeWidth="0.8" />
        <circle cx={C} cy={C} r="90" fill="url(#at-disc)" stroke="#94a3b8" strokeOpacity="0.5" strokeWidth="0.8" />
        {HOLES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.1" fill="#111a2c" />
        ))}
        <circle cx={C} cy={C} r="52" fill="#1a2539" stroke="#55667f" strokeWidth="1" />
      </g>

      {/* Fixed caliper, between the disc and the spokes */}
      <path d={bandPath(66, 98, -78, -22)} fill="url(#at-caliper)" stroke="#fed7aa" strokeOpacity="0.55" strokeWidth="0.8" />
      <path d={bandPath(74, 90, -70, -30)} fill="none" stroke="#7c2d12" strokeOpacity="0.55" strokeWidth="1" />

      {/* Spokes and hub: spin in step with the disc */}
      <g className="at-spin">
        {SPOKES.map((a) => (
          <g key={a} transform={`rotate(${a} ${C} ${C})`}>
            <path
              d={`M${C - 8} ${C - 28} L${C - 17} ${C - 107} Q${C} ${C - 113} ${C + 17} ${C - 107} L${C + 8} ${C - 28} Z`}
              fill="url(#at-metal)"
              stroke="#0b1324"
              strokeWidth="0.8"
            />
            <path d={`M${C - 1.6} ${C - 40} L${C - 7} ${C - 100} L${C + 7} ${C - 100} L${C + 1.6} ${C - 40} Z`} fill="#0a1222" />
          </g>
        ))}
        <circle cx={C} cy={C} r="31" fill="url(#at-metal)" stroke="#0b1324" strokeWidth="1" />
        <circle cx={C} cy={C} r="25" fill="none" stroke="#24344f" strokeWidth="1" />
        {LUGS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.4" fill="#0f1a2e" stroke="#a5b4cb" strokeWidth="1" />
        ))}
        <circle cx={C} cy={C} r="9" fill="#0d1628" stroke="#38bdf8" strokeWidth="1.2" />
      </g>

      {/* Blueprint overlay */}
      <g className="at-blueprint" fill="none" stroke="#38bdf8">
        <circle cx={C} cy={C} r="146" strokeOpacity="0.35" strokeDasharray="2 5" />
        <line x1={C} y1="2" x2={C} y2="298" strokeOpacity="0.16" strokeDasharray="6 4" />
        <line x1="2" y1={C} x2="298" y2={C} strokeOpacity="0.16" strokeDasharray="6 4" />
        <polyline points="213,82 244,40 296,40" strokeOpacity="0.75" />
        <polyline points="222,178 262,206 296,206" strokeOpacity="0.75" />
      </g>
      <circle cx="213" cy="82" r="2.6" fill="#38bdf8" />
      <circle cx="222" cy="178" r="2.6" fill="#38bdf8" />
      <text className="at-callout" x="296" y="35" textAnchor="end">Caliper</text>
      <text className="at-callout" x="296" y="201" textAnchor="end">Disc</text>
    </svg>
  );
}
