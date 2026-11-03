/**
 * The alloy wheel from the reference drawing: "Alloy Wheel, SolidWorks Exercise"
 * (sheet A3, scale 1:4, all dimensions in mm, unspecified fillets 2 mm).
 *
 * Plain TypeScript with no three.js, so the 3D model, the load model, the mass
 * calculation and the Node checks all read the same geometry.
 *
 * Axes, in metres: X runs along the axle (+X is outboard, toward you in the
 * Front view), Y is up, and the rim's mid-plane is at X = 0. The wheel spins
 * about X. Inside one spoke, `t` is the tangential offset and `r` the distance
 * along the spoke's own axis.
 */

export type Pt = [number, number];

/** Where a dimension came from. */
export type Provenance = 'drawing' | 'interpreted' | 'assumed' | 'derived';

/* ------------------------------------------------------------------ */
/*  Dimensions read off the sheet (mm)                                 */
/* ------------------------------------------------------------------ */
export const DRAWING = {
  outerDia: 520, //        Front view: Ø520 over the flanges
  rimWidth: 256, //        Detail B
  flangeHeight: 12, //     Detail B (interpreted: flange above the bead seat)
  rimWall: 4, //           Detail B (interpreted)
  wellDepth: 10, //        Detail B (interpreted)
  faceZoneEnd: 100, //     Detail B: 20 + 80 from the outboard face before the well wall
  wellWallDeg: 60, //      Detail B
  inboardLip: 3, //        Detail B
  hubDia: 180, //          Section A-A
  hubPadDia: 140, //       Section A-A
  hubDepth: 50, //         Section A-A
  mountInset: 70, //       Section A-A: outboard face to mounting face
  boltCount: 5,
  boltPitchDeg: 72, //     Detail C
  boltHoleDia: 10, //      5X Ø10 ↧55
  boltHoleDepth: 55,
  cboreDia: 20, //         ⌴ Ø20 ↧10
  cboreDepth: 10,
  capDia: 60, //           Detail C
  emblemRadius: 15, //     Detail D-Logo, R15
  frontDraftDeg: 10, //    Section A-A: spline 90 × 10°
  backDraftDeg: 15, //     Section A-A: spline L = 200 × 15°
  edgeFillet: 2, //        Note 2: unspecified fillets
  // Not dimensioned on the sheet, so these are assumptions:
  pcd: 112,
  centreBore: 57,
  tyreSection: 275,
  tyreAspect: 35,
} as const;

/* ------------------------------------------------------------------ */
/*  The spoke design you can change in the twin. Defaults = drawing.   */
/* ------------------------------------------------------------------ */
export interface WheelDesign {
  /** Number of Y-spokes (each splits into two legs). */
  spokeCount: number;
  /** Radius where the two legs of each spoke branch off, mm. */
  forkRadiusMm: number;
  /** Chord between the two leg centrelines where they meet the rim, mm. */
  legSpreadMm: number;
  /** Leg width at the fork, mm. Tapers 4 mm toward the rim. */
  legWidthMm: number;
  /** Arm width at the hub, mm. Tapers 6 mm toward the fork. */
  armWidthMm: number;
  /** Axial depth of the spoke where it meets the rim, mm. */
  spokeDepthRimMm: number;
  /** Blend radius at the crotch and where the legs leave the arm, mm. */
  blendRadiusMm: number;
}

export const DRAWING_DESIGN: WheelDesign = {
  spokeCount: 5,
  forkRadiusMm: 165,
  legSpreadMm: 90,
  legWidthMm: 22,
  armWidthMm: 36,
  spokeDepthRimMm: 20,
  blendRadiusMm: 15,
};

export interface DesignSpec {
  key: keyof WheelDesign;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  source: Provenance;
  hint?: string;
}

export const DESIGN_SPECS: DesignSpec[] = [
  { key: 'forkRadiusMm', label: 'Fork radius', unit: 'mm', min: 135, max: 195, step: 1, digits: 0, source: 'drawing', hint: 'Where each spoke splits into two legs (drawing: 165).' },
  { key: 'legSpreadMm', label: 'Leg spread at rim', unit: 'mm', min: 60, max: 120, step: 1, digits: 0, source: 'drawing', hint: 'Chord between leg centrelines at the rim (drawing: 90).' },
  { key: 'legWidthMm', label: 'Leg width', unit: 'mm', min: 14, max: 30, step: 0.5, digits: 1, source: 'assumed', hint: 'Not dimensioned on the sheet. Tapers 4 mm toward the rim.' },
  { key: 'armWidthMm', label: 'Arm width at hub', unit: 'mm', min: 26, max: 50, step: 0.5, digits: 1, source: 'assumed', hint: 'Not dimensioned on the sheet. Tapers 6 mm toward the fork.' },
  { key: 'spokeDepthRimMm', label: 'Spoke depth at rim', unit: 'mm', min: 14, max: 30, step: 0.5, digits: 1, source: 'drawing', hint: 'Section A-A: 20. The back face is drafted to meet the mounting face at the hub.' },
  { key: 'blendRadiusMm', label: 'Fork blend radius', unit: 'mm', min: 5, max: 25, step: 0.5, digits: 1, source: 'drawing', hint: 'R15 on the drawing, at the crotch and the arm-to-leg blends.' },
];

/* ------------------------------------------------------------------ */
/*  Fixed radii and axial positions (m)                                */
/* ------------------------------------------------------------------ */
const mm = (v: number) => v / 1000;

export const FIXED = {
  rFlange: mm(DRAWING.outerDia / 2), // 0.260
  rSeat: mm(DRAWING.outerDia / 2 - DRAWING.flangeHeight), // 0.248
  wall: mm(DRAWING.rimWall),
  xOutboard: mm(DRAWING.rimWidth / 2), // 0.128
  xInboard: -mm(DRAWING.rimWidth / 2),
  xMount: mm(DRAWING.rimWidth / 2 - DRAWING.mountInset), // 0.058, so ET +58
  xHubFront: mm(DRAWING.rimWidth / 2 - DRAWING.mountInset + DRAWING.hubDepth), // 0.108
  rHub: mm(DRAWING.hubDia / 2), // 0.090, structural spoke root
  rPad: mm(DRAWING.hubPadDia / 2), // 0.070
  rBore: mm(DRAWING.centreBore / 2),
  rCapRecess: mm(DRAWING.capDia / 2),
  rPcd: mm(DRAWING.pcd / 2),
  rBoltHole: mm(DRAWING.boltHoleDia / 2),
  rCbore: mm(DRAWING.cboreDia / 2),
  cboreDepth: mm(DRAWING.cboreDepth),
  /** The spoke outline starts inside the hub boss so the two overlap. */
  rOutlineStart: 0.08,
  /** Radius where the spoke ring (rim inner surface) carries the legs. Loads act here. */
  rAttach: 0.236,
  /** Leg ends run into the spoke ring to this radius. */
  rLegEnd: 0.242,
  /** Spoke front face where it meets the rim, 7 mm behind the outboard flange face. */
  xSpokeFrontRim: 0.121,
  tyreFreeRadius: mm(DRAWING.outerDia / 2 - DRAWING.flangeHeight + (DRAWING.tyreSection * DRAWING.tyreAspect) / 100),
  tyreHalfWidth: mm(DRAWING.tyreSection / 2),
};

/* ------------------------------------------------------------------ */
/*  Layout: everything derived from the design                         */
/* ------------------------------------------------------------------ */
export interface WheelLayout {
  design: WheelDesign;
  N: number;
  rFork: number;
  /** Lowest point of the crotch fillet, on the spoke axis. */
  rCrotch: number;
  /** Half-angle of each leg pair seen from the axle, rad. */
  legHalfAngle: number;
  /** Angle between a leg and its arm's axis, rad. */
  legAngle: number;
  legLength: number;
  armWidthRoot: number;
  armWidthFork: number;
  legWidthFork: number;
  legWidthEnd: number;
  frontSlope: number;
  backSlope: number;
  /** Axial distance from the tyre mid-plane (contact patch) to the spoke-root centroid, m. */
  dOffset: number;
  /** Closed, filleted Y-spoke outline in (t, r), metres, counter-clockwise. */
  outline: Pt[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function sanitizeDesign(d: Partial<WheelDesign>): WheelDesign {
  const out = { ...DRAWING_DESIGN, ...d };
  for (const s of DESIGN_SPECS) out[s.key] = clamp(out[s.key], s.min, s.max);
  out.spokeCount = Math.round(clamp(out.spokeCount, 4, 7));
  return out;
}

export function wheelLayout(design: WheelDesign): WheelLayout {
  const d = sanitizeDesign(design);
  const F = FIXED;
  const rFork = mm(d.forkRadiusMm);
  const frontSlope = Math.tan((DRAWING.frontDraftDeg * Math.PI) / 180);
  const xBackRim = F.xSpokeFrontRim - mm(d.spokeDepthRimMm);
  // Draft the back face so it meets the mounting face where the spoke enters the hub.
  const backSlope = (xBackRim - F.xMount) / (F.rLegEnd - F.rOutlineStart);

  const armWidthRoot = mm(d.armWidthMm);
  const armWidthFork = mm(d.armWidthMm - 6);
  const legWidthFork = mm(d.legWidthMm);
  const legWidthEnd = mm(d.legWidthMm - 4);

  const half = mm(d.legSpreadMm) / 2;
  const legHalfAngle = Math.asin(half / F.rAttach);
  const pf: Pt = [0, rFork];
  const att: Pt = [half, Math.sqrt(F.rAttach ** 2 - half ** 2)];
  const len = Math.hypot(att[0] - pf[0], att[1] - pf[1]);
  const dir: Pt = [(att[0] - pf[0]) / len, (att[1] - pf[1]) / len];
  const pd = pf[0] * dir[0] + pf[1] * dir[1];
  const sEnd = -pd + Math.sqrt(pd * pd - (pf[0] ** 2 + pf[1] ** 2) + F.rLegEnd ** 2);
  const end: Pt = [pf[0] + dir[0] * sEnd, pf[1] + dir[1] * sEnd];
  const n: Pt = [dir[1], -dir[0]]; // outer side of the right-hand leg
  const wf = legWidthFork / 2;
  const we = legWidthEnd / 2;
  const O1: Pt = [pf[0] + n[0] * wf, pf[1] + n[1] * wf];
  const O2: Pt = [end[0] + n[0] * we, end[1] + n[1] * we];
  const I1: Pt = [pf[0] - n[0] * wf, pf[1] - n[1] * wf];
  const I2: Pt = [end[0] - n[0] * we, end[1] - n[1] * we];

  const armHalf = (r: number) =>
    lerp(armWidthRoot, armWidthFork, (r - F.rHub) / (rFork - F.rHub)) / 2;
  const A1: Pt = [armHalf(F.rOutlineStart), F.rOutlineStart];
  const A2: Pt = [armHalf(rFork), rFork];
  const B = intersect(A1, A2, O1, O2);
  const sCrotch = -I1[0] / (I2[0] - I1[0]);
  const E: Pt = [0, I1[1] + (I2[1] - I1[1]) * sCrotch];

  const mirror = (p: Pt): Pt => [-p[0], p[1]];
  const blend = mm(d.blendRadiusMm);
  const corners: { p: Pt; r: number }[] = [
    { p: mirror(A1), r: 0 },
    { p: A1, r: 0 },
    { p: B, r: blend },
    { p: O2, r: 0 },
    { p: I2, r: 0 },
    { p: E, r: blend },
    { p: mirror(I2), r: 0 },
    { p: mirror(O2), r: 0 },
    { p: mirror(B), r: blend },
  ];
  const rounded = filletPolygon(corners, 10);
  const crotchArc = rounded.filter((p) => Math.abs(p[0]) < 1e-9 && p[1] > rFork);
  const rCrotch = crotchArc.length ? Math.max(...crotchArc.map((p) => p[1])) : E[1];

  // Root-centroid axial position: midway between the front and back faces at the hub radius.
  const xF = F.xSpokeFrontRim - (F.rLegEnd - F.rHub) * frontSlope;
  const xB = xBackRim - (F.rLegEnd - F.rHub) * backSlope;

  return {
    design: d,
    N: d.spokeCount,
    rFork,
    rCrotch,
    legHalfAngle,
    legAngle: Math.atan2(dir[0], dir[1]),
    legLength: sEnd,
    armWidthRoot,
    armWidthFork,
    legWidthFork,
    legWidthEnd,
    frontSlope,
    backSlope,
    dOffset: (xF + xB) / 2,
    outline: densify(rounded, 0.005),
  };
}

/** Spoke front face X at spoke-axis radius r. Linear in r, so drawn triangles stay exact. */
export const xFront = (L: WheelLayout, r: number) => FIXED.xSpokeFrontRim - (FIXED.rLegEnd - r) * L.frontSlope;
export const xBack = (L: WheelLayout, r: number) =>
  FIXED.xSpokeFrontRim - mm(L.design.spokeDepthRimMm) - (FIXED.rLegEnd - r) * L.backSlope;
export const depthAt = (L: WheelLayout, r: number) => xFront(L, r) - xBack(L, r);

/* ------------------------------------------------------------------ */
/*  Beam sections along a spoke, shared by the load model and the 3D   */
/* ------------------------------------------------------------------ */
export type MemberKind = 'arm' | 'leg';

/** Position along the hub-to-rim span: 0 at the hub boss, 1 at the spoke ring. */
export const xiAt = (r: number) => clamp((r - FIXED.rHub) / (FIXED.rAttach - FIXED.rHub), 0, 1);

export function memberWidth(L: WheelLayout, kind: MemberKind, r: number) {
  if (kind === 'arm') return lerp(L.armWidthRoot, L.armWidthFork, clamp((r - FIXED.rHub) / (L.rFork - FIXED.rHub), 0, 1));
  return lerp(L.legWidthFork, L.legWidthEnd, clamp((r - L.rFork) / (FIXED.rLegEnd - L.rFork), 0, 1));
}

/** Local stress-concentration factor: Kt at the hub, crotch and rim junctions, 1 in between. */
export function ktAt(L: WheelLayout, kind: MemberKind, r: number, kt: number) {
  const xi = xiAt(r);
  const bump = (dx: number) => 1 + (kt - 1) * Math.exp(-((dx / 0.06) ** 2));
  if (kind === 'arm') return bump(xi);
  return Math.max(bump(1 - xi), bump(Math.max(0, xi - xiAt(L.rCrotch))));
}

/**
 * Stress per unit load at one point of a spoke, in Pa per N or per N·m.
 * Each Y-spoke is treated as one beam from hub (ξ = 0) to rim (ξ = 1) with both
 * ends held against rotation, so the bending moment runs M(ξ) = M_root (1 − 2ξ).
 * Past the fork the two legs share the axial force and the moment equally.
 *
 *   σ = |N|·cA + |M_out|·cO + |M_in|·cI        (worst corner of the section)
 */
export function stressCoeffs(L: WheelLayout, kind: MemberKind, r: number, kt: number) {
  const b = memberWidth(L, kind, r);
  const h = depthAt(L, r);
  const A = b * h;
  const Zo = (b * h * h) / 6; // bending out of the wheel plane
  const Zi = (h * b * b) / 6; // bending in the wheel plane
  const g = Math.abs(1 - 2 * xiAt(r)) * ktAt(L, kind, r, kt);
  if (kind === 'arm') return { cA: 1 / A, cO: g / Zo, cI: g / Zi, b, h };
  const share = 0.5;
  return { cA: share / (Math.cos(L.legAngle) * A), cO: (share * g) / Zo, cI: (share * g) / Zi, b, h };
}

/* ------------------------------------------------------------------ */
/*  Rim (Detail B), hub and tyre profiles                              */
/* ------------------------------------------------------------------ */

/** Rim cross-section as (r, x_in) in mm, x_in measured inboard from the outboard face. */
const RIM_MM: Pt[] = (() => {
  const R = DRAWING.outerDia / 2; // 260
  const seat = R - DRAWING.flangeHeight; // 248
  const well = seat - DRAWING.wellDepth; // 238
  const t = DRAWING.rimWall; // 4
  const run = DRAWING.wellDepth / Math.tan((DRAWING.wellWallDeg * Math.PI) / 180); // 5.77
  const W = DRAWING.rimWidth; // 256
  const z0 = DRAWING.faceZoneEnd; // 100
  const zIn = W - 10 - run; // inboard wall starts here
  const inner = (a: Pt, b: Pt, rInner: number): number => {
    // x_in where the inner offset of wall a→b reaches radius rInner
    const dx = b[1] - a[1];
    const dr = b[0] - a[0];
    const l = Math.hypot(dx, dr);
    const nr = -Math.abs(dx) / l; // inward normal, radial part
    const nx = (dr > 0 ? 1 : -1) * Math.abs(dr) / l;
    const a2: Pt = [a[0] + nr * t, a[1] + nx * t];
    const k = (rInner - a2[0]) / (dr / l);
    return a2[1] + (dx / l) * k;
  };
  const dA: Pt = [seat, z0];
  const dB: Pt = [well, z0 + run];
  const uA: Pt = [well, zIn];
  const uB: Pt = [seat, zIn + run];
  return [
    // outer (tyre side), outboard to inboard
    [250, 0], [257.5, 0], [R, 2.5], [R, 7], [257, 10], [251, 11.5], [seat, 15],
    dA, dB, uA, uB,
    [seat, W - 7], [251, W - 5], [257, W - DRAWING.inboardLip - 0.5], [R, W - 2], [259, W], [252, W],
    // inner (axle side), inboard to outboard
    [seat - t, W - 3], [seat - t, inner(uA, uB, seat - t)], [well - t, inner(uA, uB, well - t)],
    [well - t, inner(dA, dB, well - t)], [seat - t, inner(dA, dB, seat - t)],
    // spoke ring: thick outboard section that carries the spoke legs
    [seat - t, 62], [236, 50], [231, 38], [230, 24], [231, 10], [236, 4], [241, 1],
  ];
})();

/** Rim profile as (r, X) in metres, counter-clockwise so lathed faces point outward. */
export const RIM_PROFILE: Pt[] = ccw(RIM_MM.map(([r, xin]) => [mm(r), FIXED.xOutboard - mm(xin)] as Pt));

/** Hub rings as annuli in X: [x0, x1, rIn, rOut, hole radius]. Holes sit on the PCD. */
export const HUB_RINGS = [
  { name: 'pad', x0: FIXED.xMount, x1: 0.08, rIn: FIXED.rBore, rOut: FIXED.rPad, hole: FIXED.rBoltHole },
  { name: 'web', x0: 0.08, x1: FIXED.xHubFront - FIXED.cboreDepth, rIn: FIXED.rBore, rOut: FIXED.rHub, hole: FIXED.rBoltHole },
  { name: 'face', x0: FIXED.xHubFront - FIXED.cboreDepth, x1: FIXED.xHubFront, rIn: FIXED.rCapRecess, rOut: FIXED.rHub, hole: FIXED.rCbore },
] as const;

/**
 * Tyre cross-section as (r, X) in metres: a closed outline (outer contour with four
 * circumferential grooves, then an inner liner) so the section view cuts a solid.
 * Illustrative 275/35 section on the drawn rim, not a catalogue tyre.
 */
/** For each TYRE_PROFILE point, true when it's on the outside (tread or sidewall), false on the liner. */
export let TYRE_OUTER: boolean[] = [];
export const TYRE_PROFILE: Pt[] = (() => {
  const R = DRAWING.outerDia / 2 - DRAWING.flangeHeight + (DRAWING.tyreSection * DRAWING.tyreAspect) / 100; // 344.25
  const hw = DRAWING.tyreSection / 2; // 137.5
  const half: Pt[] = [
    [249, 118], [254, 125], [262, 131.5], [274, 135.5], [290, 137.5], [306, 136.5], [320, 132.5],
    [331, 125.5], [338.5, 117], [342.5, 107], [R - 0.5, 96], [R, 84], [R, 0],
  ];
  const outerHalf = smoothPolyline(half, 6).map(([r, x]) => [r, (x / 137.5) * hw] as Pt);
  // Inner liner: offset toward the cavity centre (thicker under the tread).
  const centre: Pt = [296, 0];
  const innerHalf = outerHalf.map(([r, x]): Pt => {
    const dr = centre[0] - r;
    const dx = centre[1] - x;
    const l = Math.hypot(dr, dx) || 1;
    const t = r > 330 ? 13 : 8;
    return [r + (dr / l) * t, x + (dx / l) * t];
  });
  // Four circumferential grooves cut into the tread.
  const grooved: Pt[] = [];
  const grooves = [34, 78];
  for (const p of outerHalf) {
    const [r, x] = p;
    let depth = 0;
    if (r > R - 1.5) for (const g of grooves) if (Math.abs(x - g) < 6) depth = 7;
    grooved.push([r - depth, x]);
  }
  const fullOuter = [...grooved, ...grooved.slice(0, -1).reverse().map(([r, x]) => [r, -x] as Pt)];
  const fullInner = [...innerHalf, ...innerHalf.slice(0, -1).reverse().map(([r, x]) => [r, -x] as Pt)];
  const ring: Pt[] = [...fullOuter, ...fullInner.reverse()];
  const flags = ring.map((_, i) => i < fullOuter.length);
  const pts = ring.map(([r, x]) => [mm(r), mm(x)] as Pt);
  // Wind counter-clockwise, keeping the outer-surface flags in step.
  if (signedArea(pts) < 0) {
    pts.reverse();
    flags.reverse();
  }
  TYRE_OUTER = flags;
  return pts;
})();

/* ------------------------------------------------------------------ */
/*  Mass properties                                                    */
/* ------------------------------------------------------------------ */
export interface MassProps {
  rimKg: number;
  spokesKg: number;
  hubKg: number;
  massKg: number;
  /** Polar moment of inertia about the axle, kg·m². */
  inertiaKgM2: number;
}

/**
 * Mass from the geometry above: the rim is a solid of revolution of its profile,
 * the hub is three drilled annuli, and each spoke is its outline times the local
 * depth, counted only between the hub boss and the spoke ring so the overlaps
 * aren't counted twice. Edge fillets are ignored.
 */
export function massProperties(L: WheelLayout, densityKgM3: number): MassProps {
  const rho = densityKgM3;
  const rimV = 2 * Math.PI * Math.abs(polyMoment(RIM_PROFILE, 1, 0));
  const rimI = 2 * Math.PI * Math.abs(polyMoment(RIM_PROFILE, 3, 0));

  let hubV = 0;
  let hubI = 0;
  for (const h of HUB_RINGS) {
    const len = h.x1 - h.x0;
    const holeA = Math.PI * h.hole * h.hole;
    hubV += (Math.PI * (h.rOut ** 2 - h.rIn ** 2) - DRAWING.boltCount * holeA) * len;
    hubI +=
      ((Math.PI / 2) * (h.rOut ** 4 - h.rIn ** 4) - DRAWING.boltCount * holeA * (h.hole ** 2 / 2 + FIXED.rPcd ** 2)) *
      len;
  }

  // Spoke: depth h(r) = h0 + h1·r, so V = ∫∫ h dA and I = ∫∫ (t² + r²) h dA.
  const clipped = clipY(L.outline, FIXED.rHub, 0.23);
  const h1 = L.frontSlope - L.backSlope;
  const h0 = depthAt(L, 0) ;
  const m = (a: number, b: number) => Math.abs(polyMoment(clipped, a, b));
  const spokeV = h0 * m(0, 0) + h1 * m(0, 1);
  const spokeI = h0 * (m(2, 0) + m(0, 2)) + h1 * (m(2, 1) + m(0, 3));

  const rimKg = rho * rimV;
  const hubKg = rho * hubV;
  const spokesKg = rho * spokeV * L.N;
  return {
    rimKg,
    hubKg,
    spokesKg,
    massKg: rimKg + hubKg + spokesKg,
    inertiaKgM2: rho * (rimI + hubI + spokeI * L.N),
  };
}

/** Dimensions shown in the Design tab, with where each one came from. */
export function drawingTable(L: WheelLayout): { label: string; value: string; source: Provenance; where: string }[] {
  const d = L.design;
  const f = (v: number, digits = 0) => v.toFixed(digits);
  return [
    { label: 'Overall diameter', value: `Ø${DRAWING.outerDia}`, source: 'drawing', where: 'Front view' },
    { label: 'Rim width', value: `${DRAWING.rimWidth}`, source: 'drawing', where: 'Detail B' },
    { label: 'Flange height / wall / well depth', value: `${DRAWING.flangeHeight} / ${DRAWING.rimWall} / ${DRAWING.wellDepth}`, source: 'interpreted', where: 'Detail B' },
    { label: 'Well walls', value: `${DRAWING.wellWallDeg}°`, source: 'drawing', where: 'Detail B' },
    { label: 'Hub boss / pad', value: `Ø${DRAWING.hubDia} / Ø${DRAWING.hubPadDia}`, source: 'drawing', where: 'Section A-A' },
    { label: 'Hub depth', value: `${DRAWING.hubDepth}`, source: 'drawing', where: 'Section A-A' },
    { label: 'Outboard face → mounting face', value: `${DRAWING.mountInset}`, source: 'drawing', where: 'Section A-A' },
    { label: 'Offset ET (rim centre → mounting face)', value: `+${f(FIXED.xMount * 1000)}`, source: 'derived', where: 'Section A-A' },
    { label: 'Spokes', value: `${d.spokeCount} × Y (${d.spokeCount * 2} legs)`, source: d.spokeCount === 5 ? 'drawing' : 'assumed', where: 'Front view' },
    { label: 'Fork radius', value: f(d.forkRadiusMm), source: d.forkRadiusMm === 165 ? 'drawing' : 'assumed', where: 'Front view' },
    { label: 'Leg spread at rim', value: f(d.legSpreadMm), source: d.legSpreadMm === 90 ? 'drawing' : 'assumed', where: 'Front view' },
    { label: 'Fork blends', value: `R${f(d.blendRadiusMm, d.blendRadiusMm % 1 ? 1 : 0)}`, source: d.blendRadiusMm === 15 ? 'drawing' : 'assumed', where: 'Front view' },
    { label: 'Spoke face drafts', value: `${DRAWING.frontDraftDeg}° front / ${(Math.atan(L.backSlope) * 180 / Math.PI).toFixed(1)}° back`, source: 'interpreted', where: 'Section A-A splines' },
    { label: 'Spoke depth rim → hub', value: `${f(depthAt(L, FIXED.rAttach) * 1000)} → ${f(depthAt(L, FIXED.rHub) * 1000)}`, source: 'derived', where: 'Section A-A' },
    { label: 'Bolt holes', value: `${DRAWING.boltCount}× Ø${DRAWING.boltHoleDia} ↧${DRAWING.boltHoleDepth}, ⌴Ø${DRAWING.cboreDia} ↧${DRAWING.cboreDepth}`, source: 'drawing', where: 'Front view' },
    { label: 'Bolt pitch', value: `${DRAWING.boltPitchDeg}°`, source: 'drawing', where: 'Detail C' },
    { label: 'Pitch-circle diameter', value: `${DRAWING.pcd}`, source: 'assumed', where: 'not dimensioned' },
    { label: 'Centre cap', value: `Ø${DRAWING.capDia}`, source: 'drawing', where: 'Detail C' },
    { label: 'Centre bore', value: `Ø${DRAWING.centreBore}`, source: 'assumed', where: 'not dimensioned' },
    { label: 'Edge fillets', value: `R${DRAWING.edgeFillet}`, source: 'drawing', where: 'Note 2' },
    { label: 'Tyre', value: `${DRAWING.tyreSection}/${DRAWING.tyreAspect} section, Ø${f(FIXED.tyreFreeRadius * 2000)}`, source: 'assumed', where: 'not on the drawing' },
  ];
}

/* ------------------------------------------------------------------ */
/*  2D helpers                                                         */
/* ------------------------------------------------------------------ */

/** Signed area of a closed polygon (positive when counter-clockwise). */
export function signedArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function ccw(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/**
 * ∫∫ u^a v^b dA over a closed polygon in (u, v), by Green's theorem with
 * three-point Gauss on each edge (exact for a + b ≤ 4). Sign follows orientation.
 */
export function polyMoment(poly: Pt[], a: number, b: number) {
  const G = [
    [-Math.sqrt(3 / 5), 5 / 9],
    [0, 8 / 9],
    [Math.sqrt(3 / 5), 5 / 9],
  ];
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [u1, v1] = poly[i];
    const [u2, v2] = poly[(i + 1) % poly.length];
    const dv = v2 - v1;
    if (dv === 0) continue;
    let s = 0;
    for (const [x, w] of G) {
      const k = (x + 1) / 2;
      const u = u1 + (u2 - u1) * k;
      const v = v1 + dv * k;
      s += (w / 2) * (u ** (a + 1) / (a + 1)) * v ** b;
    }
    sum += s * dv;
  }
  return sum;
}

function intersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
}

/** Replace each corner that has a radius with a tangent arc. Works for convex and concave corners. */
export function filletPolygon(corners: { p: Pt; r: number }[], segs: number): Pt[] {
  const out: Pt[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const v = corners[i].p;
    const r = corners[i].r;
    if (r <= 0) {
      out.push(v);
      continue;
    }
    const prev = corners[(i - 1 + n) % n].p;
    const next = corners[(i + 1) % n].p;
    const la = Math.hypot(prev[0] - v[0], prev[1] - v[1]);
    const lb = Math.hypot(next[0] - v[0], next[1] - v[1]);
    const u: Pt = [(prev[0] - v[0]) / la, (prev[1] - v[1]) / la];
    const w: Pt = [(next[0] - v[0]) / lb, (next[1] - v[1]) / lb];
    const ang = Math.acos(clamp(u[0] * w[0] + u[1] * w[1], -1, 1));
    if (ang < 1e-3 || Math.PI - ang < 1e-3) {
      out.push(v);
      continue;
    }
    const halfA = ang / 2;
    const dist = Math.min(r / Math.tan(halfA), 0.45 * la, 0.45 * lb);
    const rr = dist * Math.tan(halfA);
    const bis: Pt = [u[0] + w[0], u[1] + w[1]];
    const lbis = Math.hypot(bis[0], bis[1]);
    const dc = rr / Math.sin(halfA);
    const c: Pt = [v[0] + (bis[0] / lbis) * dc, v[1] + (bis[1] / lbis) * dc];
    const t1: Pt = [v[0] + u[0] * dist, v[1] + u[1] * dist];
    const t2: Pt = [v[0] + w[0] * dist, v[1] + w[1] * dist];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let da = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= segs; k++) {
      const a = a1 + (da * k) / segs;
      out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** Split long edges so no segment is longer than `maxLen`. */
function densify(poly: Pt[], maxLen: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** Keep the part of a polygon with lo ≤ y ≤ hi (Sutherland–Hodgman, two half-planes). */
function clipY(poly: Pt[], lo: number, hi: number): Pt[] {
  const clip = (pts: Pt[], inside: (p: Pt) => boolean, edgeY: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const k = (edgeY - a[1]) / (b[1] - a[1]);
        out.push([a[0] + (b[0] - a[0]) * k, edgeY]);
      }
    }
    return out;
  };
  return clip(clip(poly, (p) => p[1] >= lo, lo), (p) => p[1] <= hi, hi);
}

/** Catmull-Rom through the points, `per` samples per span, ends kept. */
function smoothPolyline(pts: Pt[], per: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
