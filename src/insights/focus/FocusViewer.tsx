import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { StudioEnvironment } from '../../three/common';
import { tipColour } from '../../modules/sparkPlug/engine/kinematics';
import { caliperEstimate, plugEstimate } from '../../workspace/estimators';
import type { CaliperDesign, CaliperInputs, ComponentId, PlugDesign, PlugInputs } from '../../workspace/designs';
import { VERDICT_LABEL } from '../../workspace/validation';
import type { RuleResult } from '../../workspace/validation';
import type { InsightSource } from '../context';
import { formatParam, paramMeta, paramValue, validateCandidate } from '../designAccess';
import type { AnyDesign } from '../designAccess';
import { PART_LABEL, abFocus, lerpDesign, partsOf } from './focusSpec';
import '../insights.css';
import type { FocusSpec, PartId } from './focusSpec';

/**
 * Focused 3D view for AI Insights: the part a change touches glows, and the
 * model morphs between design B now and design B with the change, while the
 * numbers underneath are recomputed for every in-between shape.
 *
 * Looks match the Digital Twin (same plug construction and materials, same
 * caliper colours), but the geometry is built from the Design Lab parameters.
 */

const HIGHLIGHT = new THREE.Color('#22d3ee');
const CYCLE = 7.2;
const ease = (x: number) => x * x * (3 - 2 * x);
const morphAt = (t: number) => (t < 1.2 ? 0 : t < 3.2 ? ease((t - 1.2) / 2) : t < 5.2 ? 1 : 1 - ease((t - 5.2) / 2));

interface Anim {
  p: number;
  t: number;
  clock: number;
  playing: boolean;
  manual: number | null;
  sinceTick: number;
}

function Timeline({ anim, changed, onTick }: { anim: MutableRefObject<Anim>; changed: boolean; onTick: (p: number) => void }) {
  useFrame((_, dt) => {
    const a = anim.current;
    const step = Math.min(dt, 0.1);
    a.clock += step;
    if (a.manual !== null) a.p = a.manual;
    else if (a.playing && changed) {
      a.t = (a.t + step) % CYCLE;
      a.p = morphAt(a.t);
    } else if (!changed) a.p = 0;
    a.sinceTick += step;
    if (a.sinceTick > 0.12) {
      a.sinceTick = 0;
      onTick(a.p);
    }
  }, -1);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Views: close-ups of each part, cutaway and context                 */
/* ------------------------------------------------------------------ */

export type ViewId = 'whole' | 'bridge' | 'legs' | 'pistons' | 'slot' | 'nose' | 'electrode' | 'strap';

interface ViewDef {
  id: ViewId;
  label: string;
  /** Direction from the part to the camera. */
  dir: [number, number, number];
  /** Parts this view is about. Its button is marked when any of them glows. */
  parts: PartId[];
  /** The part sits inside something, so picking the view turns the cutaway on. */
  cut?: boolean;
  /** Extra room around the part, so its neighbours stay in the picture. */
  pad?: number;
}

const VIEWS: Record<'brake-caliper' | 'spark-plug', ViewDef[]> = {
  'brake-caliper': [
    { id: 'whole', label: 'Whole caliper', dir: [0.9, 0.55, 1], parts: ['body'] },
    { id: 'bridge', label: 'Bridge & ribs', dir: [0.55, 1.25, 0.75], parts: ['bridge', 'ribs'], pad: 1.25 },
    // End-on along the disc tangent: the U-section and the (exaggerated) mouth opening.
    { id: 'legs', label: 'Legs & mouth', dir: [0.02, 0.12, 1], parts: ['legs'], pad: 1.15 },
    { id: 'pistons', label: 'Pistons & pads', dir: [0.35, -0.25, 1], parts: ['pistons'], cut: true, pad: 1.35 },
    { id: 'slot', label: 'Disc slot', dir: [0.2, -1, 0.45], parts: ['slot'], pad: 1.3 },
  ],
  'spark-plug': [
    { id: 'whole', label: 'Whole firing end', dir: [0.55, 0.12, 1], parts: [] },
    { id: 'nose', label: 'Insulator nose', dir: [0.05, -0.05, 1], parts: ['nose', 'insulator'], cut: true, pad: 1.6 },
    { id: 'electrode', label: 'Electrode & gap', dir: [0.35, -0.3, 1], parts: ['electrode', 'tip'], pad: 2.2 },
    { id: 'strap', label: 'Ground strap', dir: [1, -0.25, 0.35], parts: [], pad: 1.5 },
  ],
};

/** Which close-up shows a parameter best. */
const KEY_VIEW: Record<string, ViewId> = {
  noseLengthMm: 'nose',
  noseDiaMm: 'nose',
  insulatorId: 'nose',
  electrodeDiaMm: 'electrode',
  electrodeId: 'electrode',
  protrusionMm: 'electrode',
  bridgeMm: 'bridge',
  ribCount: 'bridge',
  ribMm: 'bridge',
  legWallMm: 'legs',
  bodyHeightMm: 'legs',
  slotDepthFrac: 'slot',
  discSlotMm: 'slot',
  pistonBoreMm: 'pistons',
  pistonsPerSide: 'pistons',
  bodyLengthMm: 'whole',
  materialId: 'whole',
};

/** The close-up of the parameter that changes most (relative change; a material swap counts as 100 %). */
function defaultView(spec: FocusSpec): ViewId {
  const a = spec.from as unknown as Record<string, unknown>;
  const b = spec.to as unknown as Record<string, unknown>;
  let best: ViewId | null = null;
  let score = 0;
  for (const k of spec.keys) {
    const va = a[k];
    const vb = b[k];
    const s = typeof va === 'number' && typeof vb === 'number' ? Math.abs(vb - va) / Math.max(Math.abs(va), 1e-9) : va === vb ? 0 : 1;
    if (KEY_VIEW[k] && s > score) {
      score = s;
      best = KEY_VIEW[k];
    }
  }
  // Highlight-only focus (nothing changes): the first highlighted parameter's view.
  return best ?? KEY_VIEW[spec.keys[0]] ?? 'whole';
}

/** The cutaway removes the half of the model nearest the default camera (z > 0). */
const CUT_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

function useCutaway(mats: THREE.Material[], cut: boolean) {
  useEffect(() => {
    for (const mat of mats) {
      mat.clippingPlanes = cut ? [CUT_PLANE] : [];
      // Cut solids show their inside faces, which reads as the section.
      mat.side = cut ? THREE.DoubleSide : THREE.FrontSide;
      mat.needsUpdate = true;
    }
  }, [cut, mats]);
}

/** For each view, the objects to frame. Getters, so they read the refs at measuring time. */
type Registry = MutableRefObject<Partial<Record<ViewId, () => (THREE.Object3D | null)[]>>>;

interface Goal {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  dist: number;
}

/** Camera goal that fits the objects' visible meshes, seen from `dir`. */
function fitGoal(objs: (THREE.Object3D | null)[], dir: [number, number, number], cam: THREE.PerspectiveCamera, pad = 1): Goal | null {
  // Visible meshes only: hidden piston and rib slots are unit-sized placeholders.
  const box = new THREE.Box3();
  for (const o of objs) {
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    o.traverseVisible((x) => {
      const mesh = x as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    });
  }
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const vfov = (cam.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
  const dist = (sphere.radius * 1.12 * pad) / Math.sin(Math.min(vfov, hfov) / 2);
  return {
    pos: sphere.center.clone().addScaledVector(new THREE.Vector3(...dir).normalize(), dist),
    target: sphere.center.clone(),
    dist,
  };
}

/**
 * Frames the model and glides between views. A new focus or a resized canvas
 * snaps to the whole model first, then glides to the chosen view; a view button
 * glides from wherever the camera is. Dragging takes over at once.
 */
function ViewCamera({
  reg,
  view,
  whole,
  nonce,
  fitKey,
  halt,
}: {
  reg: Registry;
  view: ViewDef;
  whole: ViewDef;
  nonce: number;
  fitKey: string;
  /** Bumped by a linked viewport when the user drags it: stop gliding so the drag wins. */
  halt?: MutableRefObject<{ halt: number }>;
}) {
  const { camera, controls, size } = useThree();
  const pending = useRef(2);
  const snap = useRef(true);
  const goal = useRef<Goal | null>(null);
  const gliding = useRef(false);
  const haltSeen = useRef(0);

  useEffect(() => {
    // Wait a frame or two so every part has been sized by its own useFrame first.
    pending.current = 2;
    snap.current = true;
  }, [fitKey, size.width, size.height]);
  useEffect(() => {
    pending.current = Math.max(pending.current, 1);
  }, [view.id, nonce]);
  useEffect(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const stop = () => {
      gliding.current = false;
    };
    c.addEventListener('start', stop);
    return () => c.removeEventListener('start', stop);
  }, [controls]);

  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const c = controls as unknown as OrbitControlsImpl | null;
    if (halt && halt.current.halt !== haltSeen.current) {
      haltSeen.current = halt.current.halt;
      gliding.current = false;
    }
    if (pending.current > 0 && --pending.current === 0) {
      const all = fitGoal(reg.current.whole?.() ?? [], whole.dir, cam);
      if (!all) {
        pending.current = 1; // nothing sized yet, try next frame
        return;
      }
      cam.near = Math.max(all.dist / 200, 0.0005);
      cam.far = all.dist * 30;
      cam.updateProjectionMatrix();
      if (c) {
        c.minDistance = all.dist * 0.08;
        c.maxDistance = all.dist * 3;
      }
      if (snap.current) {
        snap.current = false;
        cam.position.copy(all.pos);
        if (c) {
          c.target.copy(all.target);
          c.update();
        } else cam.lookAt(all.target);
      }
      goal.current = view.id === 'whole' ? all : (fitGoal(reg.current[view.id]?.() ?? [], view.dir, cam, view.pad) ?? all);
      gliding.current = true;
    }
    const g = goal.current;
    if (!gliding.current || !g) return;
    const k = 1 - Math.exp(-dt * 5);
    cam.position.lerp(g.pos, k);
    if (c) {
      c.target.lerp(g.target, k);
      c.update();
    } else cam.lookAt(g.target);
    if (cam.position.distanceTo(g.pos) < g.dist * 0.002) gliding.current = false;
  });
  return null;
}

/** Soft round glow, the same idea as the twin's spark and fire halo. */
function useGlowTexture() {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function pulse(mat: THREE.MeshStandardMaterial, on: boolean, clock: number, base = 0) {
  if (on) {
    mat.emissive.copy(HIGHLIGHT);
    mat.emissiveIntensity = 0.18 + 0.42 * (0.5 + 0.5 * Math.sin(clock * 4.2));
  } else if (base === 0) {
    mat.emissiveIntensity = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Spark plug (same construction as the Digital Twin's plug)          */
/* ------------------------------------------------------------------ */

const PLUG_SCALE = 6;
const THREAD_D = 0.014;
const SHELL_L = 0.022;

/** Is the cutaway on? Hides the highlight outlines, which the clip plane doesn't cut. */
const CutContext = createContext(false);

interface ModelProps {
  spec: MutableRefObject<FocusSpec>;
  anim: MutableRefObject<Anim>;
  frame: MutableRefObject<THREE.Object3D | null>;
  reg: Registry;
  cut: boolean;
  /** Show the surroundings: the rotor for the caliper, the metal shell for the plug. */
  context: boolean;
}

function PlugFocus({ spec, anim, inputs, frame, reg, cut, context }: ModelProps & { inputs: PlugInputs }) {
  const glow = useGlowTexture();
  const m = useMemo(
    () => ({
      ceramic: new THREE.MeshStandardMaterial({ color: '#e8ecf1', metalness: 0.05, roughness: 0.52 }),
      nose: new THREE.MeshStandardMaterial({ color: '#e8ecf1', metalness: 0.05, roughness: 0.52 }),
      shell: new THREE.MeshStandardMaterial({ color: '#2f3a49', metalness: 0.88, roughness: 0.35 }),
      strap: new THREE.MeshStandardMaterial({ color: '#2f3a49', metalness: 0.88, roughness: 0.35 }),
      seat: new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.6, roughness: 0.35, emissive: '#38bdf8', emissiveIntensity: 0.45 }),
      tip: new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.4, emissiveIntensity: 1.1 }),
      // Inside the plug, only seen in the cutaway.
      rod: new THREE.MeshStandardMaterial({ color: '#a3aab4', metalness: 0.85, roughness: 0.3 }),
      core: new THREE.MeshStandardMaterial({ color: '#c8743c', metalness: 0.9, roughness: 0.28 }),
    }),
    [],
  );
  const clipped = useMemo(() => [m.ceramic, m.nose, m.shell, m.seat, m.rod, m.core], [m]);
  useCutaway(clipped, cut);
  const nose = useRef<THREE.Mesh>(null);
  const electrode = useRef<THREE.Mesh>(null);
  const rod = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const strapV = useRef<THREE.Mesh>(null);
  const strapH = useRef<THREE.Mesh>(null);
  const heat = useRef<THREE.Sprite>(null);
  const spark = useRef<THREE.Sprite>(null);
  const flame = useRef<THREE.Sprite>(null);
  const label = useRef<THREE.Group>(null);
  const labelText = useRef<HTMLDivElement>(null);
  const s = PLUG_SCALE;
  const shellR = (THREAD_D / 2) * s;
  const threadL = SHELL_L * s * 0.78;
  const ribs = [0, 1, 2, 3].map((i) => 0.03 * s - i * 0.0075 * s);
  // Internal insulator: from the barrel down to where the nose leaves the shell.
  const insTop = 0.02 * s;
  const insR = shellR * 0.72;

  reg.current = {
    whole: () => [frame.current],
    // The nose plus the electrode tip under it, so a longer nose doesn't push the tip out of frame.
    nose: () => [nose.current, electrode.current],
    electrode: () => [electrode.current, strapH.current],
    strap: () => [strapV.current, strapH.current],
  };

  useFrame(() => {
    const f = spec.current;
    const a = anim.current;
    const d = lerpDesign(f.from as PlugDesign, f.to as PlugDesign, a.p);
    const noseL = (d.noseLengthMm / 1000) * s;
    const noseR = (d.noseDiaMm / 2000) * s;
    const elR = (Math.min(d.electrodeDiaMm, d.noseDiaMm * 0.8) / 2000) * s;
    const prot = Math.max((d.protrusionMm / 1000) * s, 1e-4);
    nose.current!.scale.set(noseR, noseL, noseR);
    nose.current!.position.y = -threadL - noseL / 2;
    electrode.current!.scale.set(elR, prot, elR);
    electrode.current!.position.y = -threadL - noseL - prot / 2;
    strapV.current!.scale.set(elR * 2, noseL + prot, elR);
    strapV.current!.position.set(0, -threadL - noseL / 2, shellR * 0.62);
    strapH.current!.scale.set(elR * 2, elR, shellR * 1.24);
    strapH.current!.position.set(0, -threadL - noseL - prot - elR, shellR * 0.31);
    const gapY = -threadL - noseL - prot - elR / 2;

    // Centre-electrode rod through the insulator, with a copper core when the material has one.
    const rodTop = 0.05 * s;
    const rodBot = -threadL - noseL;
    rod.current!.scale.set(elR * 0.92, rodTop - rodBot, elR * 0.92);
    rod.current!.position.y = (rodTop + rodBot) / 2;
    core.current!.visible = d.electrodeId === 'ni-cu';
    core.current!.scale.set(elR * 0.5, rodTop - rodBot - elR, elR * 0.5);
    core.current!.position.y = (rodTop + rodBot + elR) / 2;

    // Tip colour from the estimated firing-end temperature, as in the twin.
    const temp = plugEstimate(d, inputs).tipTempC;
    const col = new THREE.Color(tipColour(temp));
    m.tip.color.copy(col);
    m.tip.emissive.copy(col);
    m.tip.emissiveIntensity = 0.4 + 0.9 * Math.min(1, Math.max(0, (temp - 300) / 600));
    const hs = heat.current!;
    hs.position.set(0, -threadL - noseL - prot * 0.4, 0);
    (hs.material as THREE.SpriteMaterial).color.copy(col);
    (hs.material as THREE.SpriteMaterial).opacity = Math.min(0.85, Math.max(0, (temp - 350) / 650));
    hs.scale.setScalar(noseR * 3.4);

    // Spark across the gap, then a small flame kernel, every 1.6 s.
    const ph = a.clock % 1.6;
    const sp = spark.current!;
    sp.position.set(0, gapY, shellR * 0.18);
    sp.visible = ph < 0.1;
    sp.scale.setScalar(elR * (5 + 3 * Math.random()));
    const fl = flame.current!;
    fl.position.set(0, gapY - elR, shellR * 0.18);
    fl.visible = ph >= 0.06 && ph < 0.55;
    const fk = (ph - 0.06) / 0.49;
    fl.scale.setScalar(elR * (3 + 14 * fk));
    (fl.material as THREE.SpriteMaterial).opacity = 0.75 * (1 - fk);

    const parts = new Set<PartId>(f.parts);
    pulse(m.nose, parts.has('nose'), a.clock);
    pulse(m.ceramic, parts.has('insulator'), a.clock);
    pulse(m.strap, parts.has('tip'), a.clock);
    if (parts.has('electrode') || parts.has('tip')) m.tip.emissiveIntensity += 0.5 * (0.5 + 0.5 * Math.sin(a.clock * 4.2));

    // Label every changing parameter with its live value, next to the first one's part.
    const key = f.keys[0];
    if (label.current && labelText.current) {
      label.current.visible = !!key;
      if (key) {
        const y = key === 'protrusionMm' || key === 'electrodeDiaMm' || key === 'electrodeId' ? gapY : -threadL - noseL / 2;
        label.current.position.set(noseR * 1.6 + 0.012, y, 0);
        labelText.current.textContent = liveLabel(f, d);
      }
    }
  });

  return (
    <group ref={frame as MutableRefObject<THREE.Group>}>
      <mesh position={[0, 0.04 * s, 0]} material={m.ceramic}>
        <cylinderGeometry args={[0.0085 * s, 0.0085 * s, 0.04 * s, 24]} />
      </mesh>
      {ribs.map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.ceramic}>
          <torusGeometry args={[0.0088 * s, 0.0022 * s, 8, 24]} />
        </mesh>
      ))}
      <group visible={context}>
        <mesh position={[0, 0.0095 * s, 0]} material={m.shell}>
          <cylinderGeometry args={[shellR * 1.17, shellR * 1.17, 0.015 * s, 6]} />
        </mesh>
        <mesh position={[0, 0.0012 * s, 0]} material={m.seat}>
          <cylinderGeometry args={[shellR * 1.2, shellR * 1.2, 0.0028 * s, 24]} />
        </mesh>
        <mesh position={[0, -threadL / 2, 0]} material={m.shell}>
          <cylinderGeometry args={[shellR, shellR, threadL, 20]} />
        </mesh>
      </group>
      <mesh position={[0, (insTop - threadL) / 2, 0]} material={m.ceramic}>
        <cylinderGeometry args={[insR, insR, insTop + threadL, 24]} />
      </mesh>
      <mesh ref={rod} material={m.rod}>
        <cylinderGeometry args={[1, 1, 1, 16]} />
      </mesh>
      <mesh ref={core} material={m.core}>
        <cylinderGeometry args={[1, 1, 1, 16]} />
      </mesh>
      <mesh ref={nose} material={m.nose}>
        <cylinderGeometry args={[0.9, 1, 1, 24]} />
        <HighlightEdges on={spec.current.parts.includes('nose') || spec.current.parts.includes('insulator')} />
      </mesh>
      <mesh ref={electrode} material={m.tip}>
        <cylinderGeometry args={[1, 1, 1, 16]} />
        <HighlightEdges on={spec.current.parts.includes('electrode') || spec.current.parts.includes('tip')} />
      </mesh>
      <mesh ref={strapV} material={m.strap}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh ref={strapH} material={m.strap}>
        <boxGeometry args={[1, 1, 1]} />
        <HighlightEdges on={spec.current.parts.includes('tip')} />
      </mesh>
      <sprite ref={heat}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={spark}>
        <spriteMaterial map={glow} color="#dbeafe" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={flame}>
        <spriteMaterial map={glow} color="#fb923c" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <group ref={label}>
        <Html style={{ pointerEvents: 'none' }} calculatePosition={keepTagInView}>
          <div ref={labelText} className="focus-tag" />
        </Html>
      </group>
    </group>
  );
}

/** One line per changing parameter, with its value at this point of the morph. */
function liveLabel(f: FocusSpec, d: AnyDesign) {
  const lines = f.keys.slice(0, 5).map((k) => `${paramMeta(f.component, k).label}: ${formatParam(f.component, k, paramValue(d, k))}`);
  if (f.keys.length > 5) lines.push(`+${f.keys.length - 5} more`);
  return lines.join(String.fromCharCode(10));
}

/**
 * Screen position for the in-scene tag, kept inside the canvas: in a close-up
 * the part's side can be near the edge, and the tag would run off it.
 */
const TAG_W = 300; // .focus-tag max-width + its 8px offset + a margin
function keepTagInView(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) {
  const v = new THREE.Vector3().setFromMatrixPosition(el.matrixWorld).project(camera);
  const x = (v.x * 0.5 + 0.5) * size.width;
  const y = (-v.y * 0.5 + 0.5) * size.height;
  return [Math.max(4, Math.min(x, size.width - TAG_W)), Math.max(40, Math.min(y, size.height - 50))];
}

function HighlightEdges({ on }: { on: boolean }) {
  const cut = useContext(CutContext);
  return on && !cut ? <Edges threshold={20} color="#22d3ee" /> : null;
}

/* ------------------------------------------------------------------ */
/*  Brake caliper, built from the Design Lab parameters                */
/* ------------------------------------------------------------------ */

const K = 0.005; // scene units per mm
const MOUTH_EXAGGERATION = 60;

const clampCycle = (clock: number) => {
  const t = clock % 3.2;
  if (t < 0.5) return ease(t / 0.5);
  if (t < 1.9) return 1;
  if (t < 2.4) return 1 - ease((t - 1.9) / 0.5);
  return 0;
};

function CaliperFocus({ spec, anim, inputs, frame, reg, cut, context }: ModelProps & { inputs: CaliperInputs }) {
  const m = useMemo(() => {
    const red = () => new THREE.MeshStandardMaterial({ color: '#b4232a', metalness: 0.35, roughness: 0.32 });
    return {
      legs: red(),
      bridge: red(),
      ribs: red(),
      piston: new THREE.MeshStandardMaterial({ color: '#dfe3e8', metalness: 1, roughness: 0.12 }),
      friction: new THREE.MeshStandardMaterial({ color: '#2a2b2f', metalness: 0.05, roughness: 0.95, emissive: '#ff5a1f', emissiveIntensity: 0 }),
      rotor: new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.85, roughness: 0.36 }),
      hole: new THREE.MeshStandardMaterial({ color: '#1f2227', metalness: 0.4, roughness: 0.8 }),
      slot: new THREE.MeshStandardMaterial({ color: '#22d3ee', transparent: true, opacity: 0.12, depthWrite: false, emissive: '#22d3ee', emissiveIntensity: 0.4 }),
    };
  }, []);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const legLMesh = useRef<THREE.Mesh>(null);
  const legRMesh = useRef<THREE.Mesh>(null);
  const bridge = useRef<THREE.Mesh>(null);
  const ribs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const pistonsL = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const pistonsR = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const padL = useRef<THREE.Mesh>(null);
  const padR = useRef<THREE.Mesh>(null);
  const disc = useRef<THREE.Group>(null);
  const slotVol = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.Group>(null);
  const labelText = useRef<HTMLDivElement>(null);
  const R = 165 * K;
  const holes = useMemo(() => Array.from({ length: 18 }, (_, i) => (i / 18) * Math.PI * 2), []);
  const clipped = useMemo(() => [m.legs, m.bridge, m.ribs, m.piston, m.friction, m.rotor, m.hole, m.slot], [m]);
  useCutaway(clipped, cut);

  reg.current = {
    whole: () => [frame.current],
    bridge: () => [bridge.current, ...ribs.map((r) => r.current)],
    legs: () => [legLMesh.current, legRMesh.current],
    pistons: () => [...pistonsL, ...pistonsR].map((r) => r.current).concat([padL.current, padR.current]),
    slot: () => [padL.current, padR.current, slotVol.current],
  };

  useFrame((_, dt) => {
    const f = spec.current;
    const a = anim.current;
    const d = lerpDesign(f.from as CaliperDesign, f.to as CaliperDesign, a.p);
    const slot = d.discSlotMm * K;
    const slotDepth = d.bodyHeightMm * d.slotDepthFrac * K;
    const br = d.bridgeMm * K;
    const leg = d.legWallMm * K;
    const L = d.bodyLengthMm * K;
    const legH = slotDepth + br;
    const load = clampCycle(a.clock);
    const est = caliperEstimate(d, inputs);
    const half = ((est.mouthOpeningMm * MOUTH_EXAGGERATION) / 2) * K * load;
    const phi = Math.atan2(half, slotDepth);

    legL.current!.position.set(-slot / 2, legH, 0);
    legL.current!.rotation.z = -phi;
    legR.current!.position.set(slot / 2, legH, 0);
    legR.current!.rotation.z = phi;
    legLMesh.current!.scale.set(leg, legH, L);
    legLMesh.current!.position.set(-leg / 2, -legH / 2, 0);
    legRMesh.current!.scale.set(leg, legH, L);
    legRMesh.current!.position.set(leg / 2, -legH / 2, 0);
    bridge.current!.scale.set(slot, br, L);
    bridge.current!.position.set(0, slotDepth + br / 2, 0);

    // Ribs on top of the bridge; a rib that is appearing or disappearing grows or shrinks.
    const n = Math.max(0, d.ribCount);
    const shown = Math.ceil(n - 1e-6);
    const ribH = 0.8 * br;
    const outer = slot + 2 * leg;
    ribs.forEach((r, i) => {
      const mesh = r.current!;
      mesh.visible = i < shown;
      if (!mesh.visible) return;
      const grow = i === shown - 1 && n % 1 > 1e-6 ? n % 1 : 1;
      const z = -L / 2 + ((i + 1) * L) / (shown + 1);
      mesh.scale.set(outer, Math.max(ribH * grow, 1e-4), d.ribMm * K);
      mesh.position.set(0, legH + (ribH * grow) / 2, z);
    });

    // Pistons and pads ride in the legs; at full load the pads touch the disc.
    const count = Math.max(1, Math.round(d.pistonsPerSide));
    const bore = d.pistonBoreMm * K;
    const lig = 6 * K;
    const row = count * bore + (count + 1) * lig;
    const discT = 0.42 * slot;
    const padT = 0.25 * slot;
    const ext = (slot / 2 - discT / 2 - padT) * (0.3 + 0.7 * load);
    const pistonLen = 0.6 * leg;
    const padY = -(legH - slotDepth / 2);
    [pistonsL, pistonsR].forEach((list, side) => {
      const sign = side === 0 ? 1 : -1;
      list.forEach((r, j) => {
        const mesh = r.current!;
        mesh.visible = j < count;
        if (!mesh.visible) return;
        mesh.scale.set(bore / 2, pistonLen, bore / 2);
        mesh.position.set(sign * (ext - pistonLen / 2), padY, -row / 2 + lig + bore / 2 + j * (bore + lig));
      });
    });
    const padH = Math.min(inputs.padHeightMm * K, slotDepth * 0.95);
    padL.current!.scale.set(padT, padH, 0.8 * L);
    padL.current!.position.set(ext + padT / 2, padY, 0);
    padR.current!.scale.set(padT, padH, 0.8 * L);
    padR.current!.position.set(-(ext + padT / 2), padY, 0);
    m.friction.emissiveIntensity = 0.9 * load;

    // The disc spins and slows while it is clamped.
    disc.current!.position.set(0, slotDepth - R - 3 * K, 0);
    disc.current!.scale.set(discT / (28 * K), 1, 1);
    disc.current!.rotation.x += dt * 4 * (1 - 0.85 * load);

    slotVol.current!.visible = f.parts.includes('slot');
    slotVol.current!.scale.set(slot, slotDepth, L);
    slotVol.current!.position.set(0, slotDepth / 2, 0);
    m.slot.opacity = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(a.clock * 4.2));

    const parts = new Set<PartId>(f.parts);
    const body = parts.has('body');
    pulse(m.legs, body || parts.has('legs'), a.clock);
    pulse(m.bridge, body || parts.has('bridge'), a.clock);
    pulse(m.ribs, body || parts.has('ribs'), a.clock);
    pulse(m.piston, parts.has('pistons'), a.clock);

    const key = f.keys[0];
    if (label.current && labelText.current) {
      label.current.visible = !!key;
      if (key) {
        const y = key === 'bridgeMm' || key === 'ribCount' || key === 'ribMm' ? legH + ribH : slotDepth / 2;
        label.current.position.set(outer / 2 + 0.03, y, L / 2);
        labelText.current.textContent = liveLabel(f, d);
      }
    }
  });

  const hl = spec.current.parts;
  return (
    <group>
      <group ref={disc} visible={context}>
        <mesh rotation={[0, 0, Math.PI / 2]} material={m.rotor}>
          <cylinderGeometry args={[R, R, 28 * K, 96]} />
        </mesh>
        {holes.map((ang, i) => (
          <mesh key={i} position={[14 * K + 0.0005, Math.cos(ang) * R * 0.8, Math.sin(ang) * R * 0.8]} rotation={[0, 0, Math.PI / 2]} material={m.hole}>
            <cylinderGeometry args={[4 * K, 4 * K, 0.002, 12]} />
          </mesh>
        ))}
      </group>
      {/* Everything but the (much larger) rotor is framed by the camera. */}
      <group ref={frame as MutableRefObject<THREE.Group>}>
      <group ref={legL}>
        <mesh ref={legLMesh} material={m.legs}>
          <boxGeometry args={[1, 1, 1]} />
          <HighlightEdges on={hl.includes('legs') || hl.includes('body')} />
        </mesh>
        {pistonsL.map((r, j) => (
          <mesh key={j} ref={r} rotation={[0, 0, Math.PI / 2]} material={m.piston}>
            <cylinderGeometry args={[1, 1, 1, 28]} />
            <HighlightEdges on={hl.includes('pistons')} />
          </mesh>
        ))}
        <mesh ref={padL} material={m.friction}>
          <boxGeometry args={[1, 1, 1]} />
          <HighlightEdges on={hl.includes('slot')} />
        </mesh>
      </group>
      <group ref={legR}>
        <mesh ref={legRMesh} material={m.legs}>
          <boxGeometry args={[1, 1, 1]} />
          <HighlightEdges on={hl.includes('legs') || hl.includes('body')} />
        </mesh>
        {pistonsR.map((r, j) => (
          <mesh key={j} ref={r} rotation={[0, 0, Math.PI / 2]} material={m.piston}>
            <cylinderGeometry args={[1, 1, 1, 28]} />
            <HighlightEdges on={hl.includes('pistons')} />
          </mesh>
        ))}
        <mesh ref={padR} material={m.friction}>
          <boxGeometry args={[1, 1, 1]} />
          <HighlightEdges on={hl.includes('slot')} />
        </mesh>
      </group>
      <mesh ref={bridge} material={m.bridge}>
        <boxGeometry args={[1, 1, 1]} />
        <HighlightEdges on={hl.includes('bridge') || hl.includes('body')} />
      </mesh>
      {ribs.map((r, i) => (
        <mesh key={i} ref={r} material={m.ribs}>
          <boxGeometry args={[1, 1, 1]} />
          <HighlightEdges on={hl.includes('ribs') || hl.includes('body')} />
        </mesh>
      ))}
      <mesh ref={slotVol} material={m.slot}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      </group>
      <group ref={label}>
        <Html style={{ pointerEvents: 'none' }} calculatePosition={keepTagInView}>
          <div ref={labelText} className="focus-tag" />
        </Html>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Viewer with live readout and controls                              */
/* ------------------------------------------------------------------ */

interface ReadoutRow {
  id: string;
  label: string;
  value: string;
  limit: string;
  status: RuleResult['status'];
}

const RANK = { pass: 0, review: 1, fail: 2 } as const;
const fmtVal = (r: RuleResult) => `${r.value.toFixed(r.digits)}${r.unit === '–' ? '' : ` ${r.unit}`}`;
const fmtLim = (r: RuleResult) => `${r.kind === 'max' ? '≤' : '≥'} ${r.limit.toFixed(r.digits)}${r.unit === '–' ? '' : ` ${r.unit}`}`;

/** The checks worth showing for this focus, without repeating what the parameter rows already say. */
function readoutRows(results: RuleResult[], keys: string[], component: string): ReadoutRow[] {
  let picked = results.filter((r) => r.parameters.some((p) => keys.includes(p)));
  if (!picked.length) {
    const ids = component === 'spark-plug' ? ['plug.tip-min', 'plug.tip-max', 'plug.tip-range', 'plug.tip-idle'] : ['cal.stress', 'cal.mouth', 'cal.fos'];
    picked = results.filter((r) => ids.includes(r.ruleId));
  }
  // A passing wall/size check on a parameter that is already listed adds nothing.
  picked = picked.filter((r) => !(r.basis === 'geometric' && r.status === 'pass' && r.parameters.every((p) => keys.includes(p))));
  const rows: ReadoutRow[] = [];
  const lo = picked.find((r) => r.ruleId === 'plug.tip-min');
  const hi = picked.find((r) => r.ruleId === 'plug.tip-max');
  for (const r of picked) {
    if (lo && hi && (r === lo || r === hi)) {
      if (r !== lo) continue;
      rows.push({
        id: 'plug.tip-window',
        label: 'Tip temperature, operating point',
        value: fmtVal(lo),
        limit: `${lo.limit.toFixed(0)}–${hi.limit.toFixed(0)} °C`,
        status: RANK[lo.status] >= RANK[hi.status] ? lo.status : hi.status,
      });
      continue;
    }
    rows.push({ id: r.ruleId, label: r.label, value: fmtVal(r), limit: fmtLim(r), status: r.status });
  }
  return rows.slice(0, 5);
}

export function FocusViewer({ spec, src }: { spec: FocusSpec; src: InsightSource }) {
  const specRef = useRef(spec);
  specRef.current = spec;
  const anim = useRef<Anim>({ p: 0, t: 0, clock: 0, playing: true, manual: null, sinceTick: 0 });
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(true);
  const views = VIEWS[spec.component];
  const [viewId, setViewId] = useState<ViewId>(() => defaultView(spec));
  const [viewNonce, setViewNonce] = useState(0);
  const [cut, setCut] = useState(() => !!views.find((v) => v.id === defaultView(spec))?.cut);
  const [context, setContext] = useState(true);
  const [autoRotate, setAutoRotate] = useState(() => defaultView(spec) === 'whole');
  const reg: Registry = useRef({});
  // Until the effect below runs, a view id from the other component falls back to the whole model.
  const view = views.find((v) => v.id === viewId) ?? views[0];

  // A new focus starts its morph from the beginning, on the close-up of what changes most.
  const key = `${spec.title}|${JSON.stringify(spec.keys)}|${JSON.stringify(spec.to)}`;
  useEffect(() => {
    anim.current.t = 0;
    anim.current.p = 0;
    anim.current.manual = null;
    anim.current.playing = true;
    setPlaying(true);
    setP(0);
    const v = defaultView(spec);
    setViewId(v);
    setCut(!!VIEWS[spec.component].find((x) => x.id === v)?.cut);
    setAutoRotate(v === 'whole');
  }, [key]);

  const chooseView = (v: ViewDef) => {
    setViewId(v.id);
    setViewNonce((n) => n + 1);
    setAutoRotate(false);
    if (v.cut) setCut(true);
  };

  const design = lerpDesign(spec.from, spec.to, p) as AnyDesign;
  const now = validateCandidate(src, spec.component, design);
  const rows = readoutRows(now.results, spec.keys, spec.component);
  const frame = useRef<THREE.Object3D | null>(null);
  const mass = spec.component === 'brake-caliper' ? caliperEstimate(design as CaliperDesign, src.caliperInputs).massKg : null;
  const stage = !spec.changed ? 'Highlight' : p < 0.02 ? spec.labels.from : p > 0.98 ? spec.labels.to : 'Changing…';

  const setManual = (v: number | null) => {
    anim.current.manual = v;
    if (v !== null) {
      anim.current.playing = false;
      setPlaying(false);
      anim.current.p = v;
      setP(v);
    }
  };

  return (
    <div className="focus">
      <div className="focus-canvas">
        <Canvas
          key={spec.component}
          camera={{ position: [1, 0.6, 1.2], fov: 34, near: 0.01, far: 40 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
          }}
        >
          <color attach="background" args={['#0a1020']} />
          <StudioEnvironment />
          <ambientLight intensity={0.45} />
          <directionalLight position={[1.2, 2, 1.5]} intensity={1.7} />
          <directionalLight position={[-1.5, 0.5, -1]} intensity={0.5} color="#7aa7d8" />
          <Timeline anim={anim} changed={spec.changed} onTick={setP} />
          {/* React context doesn't cross into the canvas on its own, so it's provided in here. */}
          <CutContext.Provider value={cut}>
            {spec.component === 'spark-plug' ? (
              <PlugFocus spec={specRef} anim={anim} inputs={src.plugInputs} frame={frame} reg={reg} cut={cut} context={context} />
            ) : (
              <CaliperFocus spec={specRef} anim={anim} inputs={src.caliperInputs} frame={frame} reg={reg} cut={cut} context={context} />
            )}
          </CutContext.Provider>
          <OrbitControls makeDefault enablePan={false} autoRotate={autoRotate} autoRotateSpeed={0.6} />
          <ViewCamera reg={reg} view={view} whole={views[0]} nonce={viewNonce} fitKey={`${spec.component}|${key}`} />
        </Canvas>
        <div className="focus-stage">
          <span className={`focus-dot ${stage === spec.labels.to ? 'to' : stage === spec.labels.from ? 'from' : ''}`} />
          {stage}
        </div>
        {spec.parts.length > 0 && (
          <div className="focus-glow">
            Glowing: {spec.parts.map((x) => PART_LABEL[x]).join(', ')}
            {spec.component === 'brake-caliper' && ' · mouth opening drawn ×' + MOUTH_EXAGGERATION}
            {cut && ' · cutaway: front half removed'}
          </div>
        )}
      </div>

      <div className="focus-views" role="toolbar" aria-label="3D views">
        {views.map((v) => {
          const marked = v.parts.some((x) => spec.parts.includes(x));
          return (
            <button
              key={v.id}
              className={`vp-btn ${view.id === v.id ? 'active' : ''} ${marked ? 'marked' : ''}`}
              aria-pressed={view.id === v.id}
              title={marked ? `${v.label}: this part ${spec.changed ? 'changes' : 'is highlighted'}` : v.label}
              onClick={() => chooseView(v)}
            >
              {marked && (
                <span className="focus-mark" aria-label={spec.changed ? 'changed' : 'highlighted'}>
                  ●
                </span>
              )}
              {v.label}
            </button>
          );
        })}
        <span className="focus-views-gap" />
        <button className={`vp-btn ${cut ? 'active' : ''}`} aria-pressed={cut} onClick={() => setCut(!cut)}>
          Cutaway
        </button>
        <button className={`vp-btn ${context ? 'active' : ''}`} aria-pressed={context} onClick={() => setContext(!context)}>
          {spec.component === 'brake-caliper' ? 'Rotor' : 'Shell'}
        </button>
        <button className={`vp-btn ${autoRotate ? 'active' : ''}`} aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)}>
          Auto-rotate
        </button>
        <button className="vp-btn focus-reset" onClick={() => setViewNonce((n) => n + 1)}>
          ↺ Reset view
        </button>
      </div>

      <div className="focus-controls">
        <button
          className="btn sm"
          onClick={() => {
            const next = !playing;
            anim.current.playing = next;
            if (next) anim.current.manual = null;
            setPlaying(next);
          }}
          disabled={!spec.changed}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn sm" onClick={() => setManual(0)} disabled={!spec.changed}>
          {spec.labels.from}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p}
          disabled={!spec.changed}
          aria-label={`${spec.labels.from} to ${spec.labels.to}`}
          style={{ ['--fill' as string]: `${p * 100}%` }}
          onChange={(e) => setManual(Number(e.target.value))}
        />
        <button className="btn sm" onClick={() => setManual(1)} disabled={!spec.changed}>
          {spec.labels.to}
        </button>
      </div>

      <div className="focus-readout">
        <div className="focus-title">{spec.title}</div>
        {spec.keys.map((k) => (
          <div className="focus-line" key={k}>
            <span className="l">{paramMeta(spec.component, k).label}</span>
            <span className="v">{formatParam(spec.component, k, paramValue(design, k))}</span>
            {spec.changed && (
              <span className="muted">
                {spec.labels.from.toLowerCase()} {formatParam(spec.component, k, paramValue(spec.from, k))} → {spec.labels.to.toLowerCase()}{' '}
                {formatParam(spec.component, k, paramValue(spec.to, k))}
              </span>
            )}
          </div>
        ))}
        {rows.map((r) => (
          <div className="focus-line" key={r.id}>
            <span className="l">
              {r.label} <span className="muted">{r.limit}</span>
            </span>
            <span className={`v ${r.status}`}>{r.value}</span>
            <span className={`vtag ${r.status}`}>{VERDICT_LABEL[r.status]}</span>
          </div>
        ))}
        {mass !== null && (
          <div className="focus-line">
            <span className="l">Mass</span>
            <span className="v">{mass.toFixed(3)} kg</span>
          </div>
        )}
        {spec.why && <div className="focus-why">{spec.why}</div>}
        <div className="hint">Numbers are reduced-order estimates, recomputed for every in-between shape. Not FEA.</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Design Lab: A and B side by side, on the part being edited         */
/* ------------------------------------------------------------------ */

type LabSlot = 'A' | 'B';

/** Camera shared by the two viewports, so A and B are always seen from the same place at the same scale. */
interface CamSync {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  near: number;
  far: number;
  minD: number;
  maxD: number;
  /** The user is dragging the B viewport (or its drag has only just ended). */
  bActive: boolean;
  bUntil: number;
  halt: number;
  ready: boolean;
}

/**
 * Viewport A leads (it runs the view glides) and viewport B mirrors it. While
 * the user drags B, B leads and A mirrors. Damping is off in both, so the
 * mirrored camera never drifts.
 */
function SyncCamera({ sync, role }: { sync: MutableRefObject<CamSync>; role: LabSlot }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (role !== 'B') return;
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const start = () => {
      sync.current.bActive = true;
    };
    const end = () => {
      sync.current.bActive = false;
      sync.current.bUntil = performance.now() + 250;
    };
    c.addEventListener('start', start);
    c.addEventListener('end', end);
    return () => {
      c.removeEventListener('start', start);
      c.removeEventListener('end', end);
    };
  }, [controls, role, sync]);
  useFrame(() => {
    const S = sync.current;
    const cam = camera as THREE.PerspectiveCamera;
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const bLeads = S.bActive || performance.now() < S.bUntil;
    const leads = role === 'A' ? !bLeads : bLeads;
    if (leads) {
      S.pos.copy(cam.position);
      S.target.copy(c.target);
      if (role === 'A') {
        S.near = cam.near;
        S.far = cam.far;
        S.minD = c.minDistance;
        S.maxD = c.maxDistance;
        S.ready = true;
      }
      return;
    }
    if (!S.ready) return;
    cam.position.copy(S.pos);
    c.target.copy(S.target);
    if (cam.near !== S.near || cam.far !== S.far) {
      cam.near = S.near;
      cam.far = S.far;
      cam.updateProjectionMatrix();
    }
    c.minDistance = S.minD;
    c.maxDistance = S.maxD;
    c.update();
    if (role === 'A') S.halt++;
    // Default priority: a positive one would switch off R3F's automatic rendering.
    // It still runs after ViewCamera, which is mounted (and so subscribed) first.
  });
  return null;
}

const noop = () => {};

function LabPane({
  slot,
  spec,
  src,
  cut,
  context,
  reg,
  frame,
  sync,
  viewCamera,
}: {
  slot: LabSlot;
  spec: FocusSpec;
  src: InsightSource;
  cut: boolean;
  context: boolean;
  reg: Registry;
  frame: MutableRefObject<THREE.Object3D | null>;
  sync: MutableRefObject<CamSync>;
  /** Only viewport A runs the view camera; B mirrors it. */
  viewCamera?: ReactNode;
}) {
  const specRef = useRef(spec);
  specRef.current = spec;
  const anim = useRef<Anim>({ p: 0, t: 0, clock: 0, playing: false, manual: null, sinceTick: 0 });
  return (
    <Canvas
      key={spec.component}
      camera={{ position: [1, 0.6, 1.2], fov: 34, near: 0.01, far: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
    >
      <color attach="background" args={['#0a1020']} />
      <StudioEnvironment />
      <ambientLight intensity={0.45} />
      <directionalLight position={[1.2, 2, 1.5]} intensity={1.7} />
      <directionalLight position={[-1.5, 0.5, -1]} intensity={0.5} color="#7aa7d8" />
      <Timeline anim={anim} changed={false} onTick={noop} />
      <CutContext.Provider value={cut}>
        {spec.component === 'spark-plug' ? (
          <PlugFocus spec={specRef} anim={anim} inputs={src.plugInputs} frame={frame} reg={reg} cut={cut} context={context} />
        ) : (
          <CaliperFocus spec={specRef} anim={anim} inputs={src.caliperInputs} frame={frame} reg={reg} cut={cut} context={context} />
        )}
      </CutContext.Provider>
      <OrbitControls makeDefault enablePan={false} enableDamping={false} />
      {viewCamera}
      <SyncCamera sync={sync} role={slot} />
    </Canvas>
  );
}

export interface ABLabViewerProps {
  src: InsightSource;
  component: ComponentId;
  designs: { A: AnyDesign; B: AnyDesign };
  /** The parameter being edited right now: both models zoom to its part and label it. */
  focusKey: string | null;
}

const ALL_VIEW_IDS: ViewId[] = ['whole', 'bridge', 'legs', 'pistons', 'slot', 'nose', 'electrode', 'strap'];

/**
 * Design A and design B side by side, seen through one linked camera, so a
 * change in size is a change you can see. While a parameter is being edited,
 * both viewports glide to the part it shapes, light it up and label its value.
 */
export function ABLabViewer({ src, component, designs, focusKey }: ABLabViewerProps) {
  const views = VIEWS[component];
  const a = designs.A as unknown as Record<string, unknown>;
  const b = designs.B as unknown as Record<string, unknown>;
  const diffKeys = Object.keys(b).filter((k) => k !== 'revision' && a[k] !== b[k]);
  const keys = focusKey ? [focusKey] : diffKeys;
  const parts = partsOf(keys);
  const diffParts = partsOf(diffKeys);
  const specFor = (d: AnyDesign, slot: LabSlot): FocusSpec => ({
    component,
    title: slot,
    from: d,
    to: d,
    keys,
    parts,
    changed: false,
    labels: { from: slot, to: slot },
  });

  const viewFor = (k: string | null): ViewId => (k ? (KEY_VIEW[k] ?? 'whole') : defaultView(abFocus(src, component, designs)));
  const [follow, setFollow] = useState(true);
  const [viewId, setViewId] = useState<ViewId>(() => viewFor(focusKey));
  const [nonce, setNonce] = useState(0);
  const [cut, setCut] = useState(() => !!views.find((v) => v.id === viewFor(focusKey))?.cut);
  const [context, setContext] = useState(true);
  const view = views.find((v) => v.id === viewId) ?? views[0];

  const pick = (v: ViewDef) => {
    setViewId(v.id);
    setNonce((n) => n + 1);
    setCut(!!v.cut);
  };
  // Follow the slider: editing a different parameter moves both cameras to its part.
  useEffect(() => {
    if (!follow || !focusKey) return;
    const v = views.find((x) => x.id === (KEY_VIEW[focusKey] ?? 'whole')) ?? views[0];
    if (v.id !== viewId) pick(v);
  }, [focusKey, follow, component]);

  const regA: Registry = useRef({});
  const regB: Registry = useRef({});
  const frameA = useRef<THREE.Object3D | null>(null);
  const frameB = useRef<THREE.Object3D | null>(null);
  // Frame both designs at once, so the camera shows the bigger one whole and the sizes compare 1:1.
  const merged: Registry = useRef({});
  merged.current = Object.fromEntries(
    ALL_VIEW_IDS.map((id) => [id, () => [...(regA.current[id]?.() ?? []), ...(regB.current[id]?.() ?? [])]]),
  );
  const sync = useRef<CamSync>({
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    near: 0.01,
    far: 40,
    minD: 0,
    maxD: Infinity,
    bActive: false,
    bUntil: 0,
    halt: 0,
    ready: false,
  });

  const label = focusKey ? paramMeta(component, focusKey).label : null;
  const valueOf = (d: AnyDesign) => (focusKey ? formatParam(component, focusKey, paramValue(d, focusKey)) : '');
  let pct: number | null = null;
  if (focusKey) {
    const x = paramValue(designs.A, focusKey);
    const y = paramValue(designs.B, focusKey);
    if (typeof x === 'number' && typeof y === 'number' && Math.abs(x) > 1e-12) pct = ((y - x) / Math.abs(x)) * 100;
  }

  return (
    <div className="lab3d">
      <div className="lab3d-panes">
        {(['A', 'B'] as LabSlot[]).map((slot) => (
          <div key={slot} className={`lab3d-pane slot-${slot.toLowerCase()}`}>
            <LabPane
              slot={slot}
              spec={specFor(designs[slot], slot)}
              src={src}
              cut={cut}
              context={context}
              reg={slot === 'A' ? regA : regB}
              frame={slot === 'A' ? frameA : frameB}
              sync={sync}
              viewCamera={
                slot === 'A' ? <ViewCamera reg={merged} view={view} whole={views[0]} nonce={nonce} fitKey={component} halt={sync} /> : undefined
              }
            />
            <div className="lab3d-tag">
              <span className="lab3d-slot">{slot}</span>
              <span className="lab3d-rev">{(designs[slot] as { revision: string }).revision}</span>
            </div>
            {label && (
              <div className="lab3d-value">
                {label}: <b>{valueOf(designs[slot])}</b>
                {slot === 'B' && pct !== null && Math.abs(pct) >= 0.05 && (
                  <span className="lab3d-pct">
                    {' '}
                    ({pct > 0 ? '+' : ''}
                    {pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)} % vs A)
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="focus-views" role="toolbar" aria-label="3D views">
        {views.map((v) => {
          const marked = v.parts.some((x) => diffParts.includes(x));
          return (
            <button
              key={v.id}
              className={`vp-btn ${view.id === v.id ? 'active' : ''} ${marked ? 'marked' : ''}`}
              aria-pressed={view.id === v.id}
              title={marked ? `${v.label}: differs between A and B` : v.label}
              onClick={() => pick(v)}
            >
              {marked && (
                <span className="focus-mark" aria-label="differs">
                  ●
                </span>
              )}
              {v.label}
            </button>
          );
        })}
        <span className="focus-views-gap" />
        <button className={`vp-btn ${cut ? 'active' : ''}`} aria-pressed={cut} onClick={() => setCut(!cut)}>
          Cutaway
        </button>
        <button className={`vp-btn ${context ? 'active' : ''}`} aria-pressed={context} onClick={() => setContext(!context)}>
          {component === 'brake-caliper' ? 'Rotor' : 'Shell'}
        </button>
        <button
          className={`vp-btn ${follow ? 'active' : ''}`}
          aria-pressed={follow}
          title="Zoom both views to the part of the parameter you are changing"
          onClick={() => setFollow(!follow)}
        >
          Follow slider
        </button>
        <button className="vp-btn focus-reset" onClick={() => setNonce((n) => n + 1)}>
          ↺ Reset view
        </button>
      </div>
    </div>
  );
}
