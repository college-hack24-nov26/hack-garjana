import * as THREE from 'three';

/**
 * Geometry helpers. Axes used for the whole assembly, in metres:
 *   X runs along the axle (+X is outboard, toward you in the Front view)
 *   the rotor's mid-plane is at x = 0
 * Inside the caliper, +Y points out radially toward the caliper centre and Z is tangential.
 */

/** A ring segment centred on +Y in the YZ plane, extruded along +X from x0 to x0 + depth. */
export function annularSector(
  rIn: number,
  rOut: number,
  halfAngle: number,
  x0: number,
  depth: number,
  bevel = 0,
): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const seg = 24;
  for (let i = 0; i <= seg; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / seg;
    const p = [rOut * Math.sin(a), rOut * Math.cos(a)];
    if (i === 0) s.moveTo(p[0], p[1]);
    else s.lineTo(p[0], p[1]);
  }
  for (let i = seg; i >= 0; i--) {
    const a = -halfAngle + (2 * halfAngle * i) / seg;
    s.lineTo(rIn * Math.sin(a), rIn * Math.cos(a));
  }
  s.closePath();
  return extrudeToX(s, x0, depth, bevel);
}

/** A full ring extruded along +X. */
export function annulus(rIn: number, rOut: number, x0: number, depth: number, holes: THREE.Path[] = []) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(h, ...holes);
  return extrudeToX(s, x0, depth, 0, 96);
}

export function circlePath(cx: number, cy: number, r: number) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/** Extrude a shape drawn in (z, y) so the extrusion runs along +X. */
export function extrudeToX(shape: THREE.Shape, x0: number, depth: number, bevel: number, curveSegments = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  // The shape is in (x, y) and extrudes along z. Rotating +90° about Y maps (x, y, z) to (z, y, -x).
  g.rotateY(Math.PI / 2);
  g.translate(x0 + bevel, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Spin a (radius, x) profile around the X axis. */
export function latheX(profile: [number, number][], segments = 96) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, segments);
  // LatheGeometry spins around Y, so turn the result onto X.
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Smooth a polyline profile with a Catmull-Rom spline. */
export function smoothProfile(points: [number, number][], samples = 80, closed = false): [number, number][] {
  const curve = new THREE.SplineCurve(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const out = curve.getPoints(samples).map((v) => [v.x, v.y] as [number, number]);
  if (closed) out.push(out[0]);
  return out;
}
