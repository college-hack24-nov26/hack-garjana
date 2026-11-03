/**
 * three.js geometry for the wheel, built from the plain-number drawing in
 * ../wheel/drawing.ts. Axes as there: X along the axle (+X outboard), Y up.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { annulus, circlePath, latheX } from '../../../three/geometry';
import {
  DRAWING,
  FIXED,
  HUB_RINGS,
  RIM_PROFILE,
  TYRE_OUTER,
  TYRE_PROFILE,
  depthAt,
  stressCoeffs,
  xBack,
} from '../wheel/drawing';
import type { WheelLayout } from '../wheel/drawing';

export const RIM_SEGMENTS = 180;
/** Points in the closed lathe profile (first point repeated at the end). */
export const RIM_POINTS = RIM_PROFILE.length + 1;
const closed = <T,>(a: T[]) => [...a, a[0]];

/** Bolt k sits between spokes, on the 72° pitch. Angle from +Y toward +Z, rad. */
export const boltAngle = (k: number) => ((k + 0.5) / DRAWING.boltCount) * Math.PI * 2;

export function rimGeometry() {
  return latheX(closed(RIM_PROFILE), RIM_SEGMENTS);
}

export function tyreGeometry() {
  return latheX(closed(TYRE_PROFILE), RIM_SEGMENTS);
}

/** Three drilled annuli (Section A-A): mounting pad, web and counterbored face. */
export function hubGeometries() {
  return HUB_RINGS.map((h) => {
    const holes = Array.from({ length: DRAWING.boltCount }, (_, k) => {
      const a = boltAngle(k);
      // Shapes are drawn in (x, y) = (−Z, Y); see extrudeToX.
      return circlePath(-FIXED.rPcd * Math.sin(a), FIXED.rPcd * Math.cos(a), h.hole);
    });
    return annulus(h.rIn, h.rOut, h.x0, h.x1 - h.x0, holes);
  });
}

/**
 * One Y-spoke pointing up (+Y). The outline is extruded, then each vertex is
 * moved axially between the drafted back and front faces (Section A-A). Both
 * faces are linear in r, so the flat triangles stay exact.
 */
export function spokeGeometry(L: WheelLayout) {
  const shape = new THREE.Shape(L.outline.map(([t, r]) => new THREE.Vector2(t, r)));
  const h0 = 0.02;
  const bev = (DRAWING.edgeFillet / 1000) * 0.9;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h0 - 2 * bev,
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: -bev,
    bevelSegments: 3,
    steps: 1,
  });
  g.translate(0, 0, bev);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i);
    const r = pos.getY(i);
    const f = pos.getZ(i) / h0;
    pos.setXYZ(i, xBack(L, r) + f * depthAt(L, r), r, -t);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-7);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/**
 * Stress per unit load for every vertex of the spoke geometry (see stressCoeffs).
 * Per frame, σ = |N|·cA + |M_out|·cO + |M_in|·cI, so colouring is three
 * multiply-adds per vertex.
 */
export function spokeStressCoeffs(L: WheelLayout, geo: THREE.BufferGeometry, kt: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cA = new Float32Array(pos.count);
  const cO = new Float32Array(pos.count);
  const cI = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const r = pos.getY(i);
    const t = -pos.getZ(i);
    const arm = r < L.rFork;
    const c = stressCoeffs(L, arm ? 'arm' : 'leg', arm ? r : Math.hypot(t, r), kt);
    cA[i] = c.cA;
    cO[i] = c.cO;
    cI[i] = c.cI;
  }
  return { cA, cO, cI };
}

export function boltGeometries() {
  const head = new THREE.CylinderGeometry(0.0085, 0.0085, 0.009, 6);
  head.rotateZ(Math.PI / 2);
  const seat = new THREE.CylinderGeometry(0.0085, 0.0055, 0.004, 24);
  seat.rotateZ(Math.PI / 2);
  const shank = new THREE.CylinderGeometry(0.0048, 0.0048, 0.065, 16);
  shank.rotateZ(Math.PI / 2);
  return { head, seat, shank };
}

export function capGeometries() {
  const disc = new THREE.CylinderGeometry(0.0295, 0.0295, 0.008, 64);
  disc.rotateZ(Math.PI / 2);
  const ring = annulus(0.0125, FIXED.rCapRecess / 2, 0, 0.0014);
  // Generic AutoTwin emblem: five turbine blades inside the R15 ring (Detail D),
  // in place of the drawing's third-party trademark.
  const blade = new THREE.Shape();
  blade.moveTo(-0.0014, 0.0025);
  blade.lineTo(0.0014, 0.0025);
  blade.quadraticCurveTo(0.003, 0.008, 0.0062, 0.0118);
  blade.lineTo(0.0028, 0.0122);
  blade.quadraticCurveTo(0.0008, 0.008, -0.0014, 0.0025);
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.0012, bevelEnabled: false });
  bladeGeo.rotateY(Math.PI / 2);
  const hubDot = new THREE.CylinderGeometry(0.0028, 0.0028, 0.0014, 24);
  hubDot.rotateZ(Math.PI / 2);
  return { disc, ring, blade: bladeGeo, hubDot };
}

/** Vehicle side: rotating hub flange and brake disc, plus the fixed stub axle. Context only. */
export function vehicleGeometries() {
  const flange = annulus(0.03, 0.074, FIXED.xMount - 0.01, 0.01);
  const rotor = annulus(0.11, 0.165, -0.004, 0.028);
  const hat = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 48, 1, true);
  hat.rotateZ(Math.PI / 2);
  hat.translate(0.022, 0, 0);
  const stub = new THREE.CylinderGeometry(0.042, 0.05, 0.12, 32);
  stub.rotateZ(Math.PI / 2);
  stub.translate(-0.03, 0, 0);
  return { flange, rotor, hat, stub };
}

export function valveGeometry() {
  const g = new THREE.CylinderGeometry(0.004, 0.0055, 0.03, 16);
  return g;
}

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */

/** Tyre colour map on the lathe UVs: sipes across the tread, lettering on both sidewalls. */
export function makeTyreTexture() {
  const W = 4096;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#1c1e23';
  ctx.fillRect(0, 0, W, H);
  const n = TYRE_PROFILE.length - 1;
  const band = (pick: (r: number, x: number) => boolean) => {
    let lo = 1;
    let hi = 0;
    TYRE_PROFILE.forEach(([r, x], j) => {
      if (TYRE_OUTER[j] && pick(r, x)) {
        lo = Math.min(lo, j / n);
        hi = Math.max(hi, j / n);
      }
    });
    // canvas y runs top-down, texture v bottom-up (flipY)
    return hi > lo ? { y0: (1 - hi) * H, y1: (1 - lo) * H } : null;
  };
  const tread = band((r, x) => r > 0.336 && Math.abs(x) < 0.112);
  if (tread) {
    ctx.strokeStyle = '#121317';
    ctx.lineWidth = 7;
    for (let u = 0; u < W; u += 26) {
      ctx.beginPath();
      ctx.moveTo(u, tread.y0);
      ctx.lineTo(u + 30, tread.y1);
      ctx.stroke();
    }
  }
  for (const side of [1, -1]) {
    const wall = band((r, x) => side * x > 0.115 && r > 0.272 && r < 0.316);
    if (!wall) continue;
    const h = wall.y1 - wall.y0;
    ctx.save();
    ctx.fillStyle = '#5b616b';
    ctx.font = `700 ${Math.max(14, h * 0.55)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) {
      const text = 'AUTOTWIN  ·  275/35 ZR20  ·  DEMO FIXTURE';
      const x0 = k * (W / 2) + 120;
      ctx.save();
      ctx.translate(x0, (wall.y0 + wall.y1) / 2);
      // Read the right way round from outside the wheel on both sidewalls.
      if (side > 0) ctx.scale(-1, -1);
      ctx.fillText(text, side > 0 ? -ctx.measureText(text).width : 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Tiling asphalt with an edge line and expansion joints, so the road visibly moves. */
export function makeRoadTextures() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#262b33';
  ctx.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + rnd() * 40;
    ctx.fillStyle = `rgba(${v + 10}, ${v + 14}, ${v + 20}, ${0.35 + rnd() * 0.4})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
  ctx.fillRect(S * 0.86, 0, S * 0.035, S); // edge line (outboard side)
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)';
  ctx.fillRect(0, S * 0.5, S, 5); // expansion joint
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const fade = document.createElement('canvas');
  fade.width = 4;
  fade.height = 256;
  const f = fade.getContext('2d')!;
  const grad = f.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.3, '#fff');
  grad.addColorStop(0.7, '#fff');
  grad.addColorStop(1, '#000');
  f.fillStyle = grad;
  f.fillRect(0, 0, 4, 256);
  const alpha = new THREE.CanvasTexture(fade);
  return { map, alpha };
}

export function makeShadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

/* ------------------------------------------------------------------ */
/*  Material patches                                                   */
/* ------------------------------------------------------------------ */
export interface FlattenUniforms {
  uGroundY: { value: number };
  uDefl: { value: number };
}

/**
 * Section fill: when a clip plane opens the part up you see its inside faces,
 * which are painted flat `sectionColor`, so the cut reads as solid material.
 * Optional flatten: vertices below the road are pushed up onto it and the
 * sidewall bulges a little, giving a loaded contact patch on the rolling tyre.
 */
export function patchMaterial(mat: THREE.MeshStandardMaterial, sectionColor: string, flatten?: FlattenUniforms) {
  mat.side = THREE.DoubleSide;
  const col = new THREE.Color(sectionColor);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSectionColor = { value: col };
    if (flatten) {
      shader.uniforms.uGroundY = flatten.uGroundY;
      shader.uniforms.uDefl = flatten.uDefl;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uGroundY;\nuniform float uDefl;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec4 aw = modelMatrix * vec4(transformed, 1.0);
            float gap = aw.y - uGroundY;
            float zone = 0.045;
            if (gap < zone) {
              float k = 1.0 - clamp(gap / zone, 0.0, 1.0);
              aw.y = max(aw.y, uGroundY);
              float side = aw.x;
              aw.x += sign(side) * uDefl * 0.45 * k * smoothstep(0.07, 0.125, abs(side));
              transformed = (inverse(modelMatrix) * aw).xyz;
            }
          }`,
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSectionColor;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nif (!gl_FrontFacing) gl_FragColor = vec4(uSectionColor, 1.0);',
      );
  };
  mat.customProgramCacheKey = () => (flatten ? 'wheel-flatten' : 'wheel-section');
  return mat;
}
