import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useBuildClock, useWheelSim, stressRGB } from '../sim/useWheelSim';
import { FIXED } from '../wheel/drawing';
import { itemProgress, partProgress } from '../wheel/build';
import {
  RIM_POINTS,
  RIM_SEGMENTS,
  boltAngle,
  boltGeometries,
  capGeometries,
  hubGeometries,
  makeRoadTextures,
  makeShadowTexture,
  makeTyreTexture,
  patchMaterial,
  rimGeometry,
  spokeGeometry,
  spokeStressCoeffs,
  tyreGeometry,
  valveGeometry,
  vehicleGeometries,
} from './wheelGeometry';
import type { FlattenUniforms } from './wheelGeometry';
import { CorneringRigRotating, MomentArrow, RadialDrum } from './RigHardware';

export interface AssemblyProps {
  overlay: boolean;
  section: boolean;
  exploded: boolean;
  showTyre: boolean;
  showLoads: boolean;
  /** Bench test in place of the road, or null on the road. */
  rig: 'rig-cornering' | 'rig-radial' | null;
}

/** Section A-A: keep the half with z ≥ 0 and look at it from −Z, so outboard is on the left as on the drawing. */
const SECTION_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
/** Cut faces read like a CAD section: light for metal, dark for rubber. */
const SECTION_FILL = '#dbe4ee';

function useMaterials(flatten: FlattenUniforms) {
  return useMemo(() => {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
    return {
      rim: patchMaterial(std({ color: '#c9cfd7', metalness: 1, roughness: 0.2 }), SECTION_FILL),
      spoke: patchMaterial(std({ color: '#959ea9', metalness: 0.95, roughness: 0.27 }), SECTION_FILL),
      // Darker base so the lights and ACES tone mapping don't wash the stress colours out.
      stress: patchMaterial(std({ color: '#6e6e6e', vertexColors: true, metalness: 0, roughness: 0.8, envMapIntensity: 0.25 }), SECTION_FILL),
      neutral: patchMaterial(std({ color: '#3d4653', metalness: 0.45, roughness: 0.6 }), '#9aa6b5'),
      tyre: patchMaterial(std({ map: makeTyreTexture(), roughness: 0.9, metalness: 0 }), '#4b5260', flatten),
      bolt: patchMaterial(std({ color: '#e6e9ee', metalness: 1, roughness: 0.14 }), '#a1a8b3'),
      cap: patchMaterial(std({ color: '#0f172a', metalness: 0.6, roughness: 0.3 }), '#334155'),
      capAccent: std({ color: '#22d3ee', emissive: '#0891b2', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }),
      valve: std({ color: '#111827', metalness: 0.2, roughness: 0.6 }),
      vehicle: patchMaterial(std({ color: '#2b3038', metalness: 0.6, roughness: 0.55 }), '#475063'),
      rotor: patchMaterial(std({ color: '#3f444c', metalness: 0.7, roughness: 0.6 }), '#6b7380'),
    };
  }, [flatten]);
}
type Mats = ReturnType<typeof useMaterials>;

/** Spokes, coloured by their beam-model stress when the overlay is on. */
function Spokes({ m, overlay }: { m: Mats; overlay: boolean }) {
  const sim = useWheelSim();
  const clock = useBuildClock();
  const version = useSyncExternalStore(sim.subscribe, () => sim.geometryVersion);

  const { geos, coeffs } = useMemo(() => {
    const L = sim.layout;
    const base = spokeGeometry(L);
    const coeffs = spokeStressCoeffs(L, base, sim.params.kt);
    const geos = Array.from({ length: L.N }, (_, i) => {
      const g = base.clone();
      g.rotateX((2 * Math.PI * i) / L.N);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      return g;
    });
    base.dispose();
    return { geos, coeffs };
  }, [sim, version]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);

  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const rgb = useMemo(() => [0, 0, 0] as [number, number, number], []);

  useFrame(() => {
    const N = geos.length;
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = itemProgress('spokes', clock.t, i, N);
      mesh.visible = p > 0;
      mesh.position.x = (1 - p) * 0.32;
    });
    if (!overlay) return;
    const limit = sim.fatigueLimitMPa * 1e6;
    const { cA, cO, cI } = coeffs;
    geos.forEach((g, i) => {
      const a = sim.state.arms[i];
      if (!a) return;
      const n = Math.abs(a.n);
      const mo = Math.abs(a.mo);
      const mi = Math.abs(a.mi);
      const col = g.attributes.color as THREE.BufferAttribute;
      const arr = col.array as Float32Array;
      for (let v = 0; v < cA.length; v++) {
        stressRGB((n * cA[v] + mo * cO[v] + mi * cI[v]) / limit, rgb);
        arr[v * 3] = rgb[0];
        arr[v * 3 + 1] = rgb[1];
        arr[v * 3 + 2] = rgb[2];
      }
      col.needsUpdate = true;
    });
  });

  return (
    <>
      {geos.map((g, i) => (
        <mesh key={`${version}-${i}`} ref={(el) => (meshes.current[i] = el)} geometry={g} material={overlay ? m.stress : m.spoke} />
      ))}
    </>
  );
}

function Bolts({ m, explode }: { m: Mats; explode: MutableRefObject<number> }) {
  const clock = useBuildClock();
  const geo = useMemo(boltGeometries, []);
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    groups.current.forEach((g, k) => {
      if (!g) return;
      const p = itemProgress('bolts', clock.t, k, 5);
      g.visible = p > 0;
      g.position.x = explode.current * 0.16 + (1 - p) * 0.09;
      g.rotation.x = (1 - p) * 9; // screws in
    });
  });
  return (
    <>
      {Array.from({ length: 5 }, (_, k) => {
        const a = boltAngle(k);
        const y = FIXED.rPcd * Math.cos(a);
        const z = FIXED.rPcd * Math.sin(a);
        return (
          <group key={k} position={[0, y, z]}>
            <group ref={(el) => (groups.current[k] = el)}>
              <mesh geometry={geo.head} material={m.bolt} position={[FIXED.xHubFront - 0.0055, 0, 0]} />
              <mesh geometry={geo.seat} material={m.bolt} position={[FIXED.xHubFront - FIXED.cboreDepth + 0.002, 0, 0]} />
              <mesh geometry={geo.shank} material={m.bolt} position={[FIXED.xHubFront - FIXED.cboreDepth - 0.03, 0, 0]} />
            </group>
          </group>
        );
      })}
    </>
  );
}

function Cap({ m, explode }: { m: Mats; explode: MutableRefObject<number> }) {
  const clock = useBuildClock();
  const geo = useMemo(capGeometries, []);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = partProgress('cap', clock.t);
    g.visible = p > 0;
    g.scale.setScalar(Math.max(0.001, p));
    g.position.x = FIXED.xHubFront - 0.004 + explode.current * 0.24;
  });
  return (
    <group ref={ref}>
      <mesh geometry={geo.disc} material={m.cap} />
      <mesh geometry={geo.ring} material={m.capAccent} position={[0.004, 0, 0]} />
      <mesh geometry={geo.hubDot} material={m.capAccent} position={[0.0047, 0, 0]} />
      {Array.from({ length: 5 }, (_, k) => (
        <mesh key={k} geometry={geo.blade} material={m.capAccent} position={[0.004, 0, 0]} rotation={[(k / 5) * Math.PI * 2, 0, 0]} />
      ))}
    </group>
  );
}

function Road({ flatten, hidden }: { flatten: FlattenUniforms; hidden: boolean }) {
  const sim = useWheelSim();
  const tex = useMemo(makeRoadTextures, []);
  const shadow = useMemo(makeShadowTexture, []);
  const road = useRef<THREE.Group>(null);
  useMemo(() => {
    tex.map.repeat.set(1, 6);
  }, [tex]);
  useFrame(() => {
    const s = sim.state;
    const y = -s.loadedRadius;
    flatten.uGroundY.value = y;
    flatten.uDefl.value = s.deflection;
    if (road.current) road.current.position.y = y - 0.0006;
    // Ground moves +Z relative to the axle as the car drives toward −Z. 1 m per texture tile.
    tex.map.offset.y = s.distanceM % 1;
  });
  return (
    <group ref={road} visible={!hidden}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.05, 0, 0]}>
        <planeGeometry args={[1.5, 6]} />
        <meshStandardMaterial map={tex.map} alphaMap={tex.alpha} transparent roughness={0.95} metalness={0} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0004, 0]}>
        <planeGeometry args={[0.42, 0.62]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Load arrows at the contact patch                                   */
/* ------------------------------------------------------------------ */
const UP = new THREE.Vector3(0, 1, 0);
const M_PER_N = 0.03 / 1000; // 30 mm per kN
const HEAD = 0.022;

function Arrow({ color, setRef }: { color: string; setRef: (g: THREE.Group | null) => void }) {
  return (
    <group ref={setRef}>
      <mesh name="shaft">
        <cylinderGeometry args={[0.0035, 0.0035, 1, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh name="head">
        <coneGeometry args={[0.011, HEAD, 18]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function setArrow(g: THREE.Group | null, origin: THREE.Vector3, dir: THREE.Vector3, len: number) {
  if (!g) return;
  g.visible = len > 0.004;
  if (!g.visible) return;
  g.position.copy(origin);
  g.quaternion.setFromUnitVectors(UP, dir);
  const shaft = g.getObjectByName('shaft')!;
  const head = g.getObjectByName('head')!;
  const sl = Math.max(0.001, len - HEAD);
  shaft.scale.set(1, sl, 1);
  shaft.position.y = sl / 2;
  head.position.y = sl + HEAD / 2;
}

function LoadArrows() {
  const sim = useWheelSim();
  const fz = useRef<THREE.Group | null>(null);
  const fy = useRef<THREE.Group | null>(null);
  const fx = useRef<THREE.Group | null>(null);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  const anchors = useRef<Record<string, THREE.Group | null>>({});
  const o = useMemo(() => new THREE.Vector3(), []);
  const d = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const s = sim.state;
    const g = -s.loadedRadius;
    const side = FIXED.tyreHalfWidth + 0.03;
    // Fz: road pushes up on the tyre.
    const lz = s.Fz * M_PER_N;
    setArrow(fz.current, o.set(side, g, 0), d.set(0, 1, 0), lz);
    anchors.current.fz?.position.set(side, g + lz + 0.02, 0);
    // Fy: positive points inboard (−X), drawn ending at the sidewall.
    const ly = Math.abs(s.Fy) * M_PER_N;
    if (s.Fy >= 0) setArrow(fy.current, o.set(side + ly, g + 0.012, 0.09), d.set(-1, 0, 0), ly);
    else setArrow(fy.current, o.set(side, g + 0.012, 0.09), d.set(1, 0, 0), ly);
    anchors.current.fy?.position.set(side + ly + 0.03, g + 0.03, 0.09);
    // Fx: braking pushes the tyre toward +Z (against travel, which is −Z).
    const lx = Math.abs(s.Fx) * M_PER_N;
    setArrow(fx.current, o.set(side, g + 0.012, 0), d.set(0, 0, s.Fx < 0 ? 1 : -1), lx);
    anchors.current.fx?.position.set(side, g + 0.04, (s.Fx < 0 ? 1 : -1) * (lx + 0.03));
    const kN = (v: number) => `${(v / 1000).toFixed(2)} kN`;
    const set = (k: string, text: string, show: boolean) => {
      const el = labels.current[k];
      if (!el) return;
      el.textContent = text;
      el.style.display = show ? '' : 'none';
    };
    set('fz', `Fz ${kN(s.Fz)}`, lz > 0.004);
    set('fy', `Fy ${kN(Math.abs(s.Fy))}`, ly > 0.004);
    set('fx', `Fx ${kN(Math.abs(s.Fx))}`, lx > 0.004);
  });

  const label = (k: string, cls: string) => (
    <group ref={(el) => (anchors.current[k] = el)}>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <span className={`force-label ${cls}`} ref={(el) => (labels.current[k] = el)} />
      </Html>
    </group>
  );

  return (
    <group>
      <Arrow color="#22d3ee" setRef={(g) => (fz.current = g)} />
      <Arrow color="#a78bfa" setRef={(g) => (fy.current = g)} />
      <Arrow color="#fb923c" setRef={(g) => (fx.current = g)} />
      {label('fz', 'z')}
      {label('fy', 'y')}
      {label('fx', 'x')}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  The assembly                                                       */
/* ------------------------------------------------------------------ */
export function WheelAssembly({ overlay, section, exploded, showTyre: tyreOn, showLoads, rig }: AssemblyProps) {
  // The cornering rig runs the bare wheel: no tyre.
  const showTyre = tyreOn && rig !== 'rig-cornering';
  const sim = useWheelSim();
  const clock = useBuildClock();
  const flatten = useMemo<FlattenUniforms>(() => ({ uGroundY: { value: -0.33 }, uDefl: { value: 0 } }), []);
  const m = useMaterials(flatten);

  const geo = useMemo(
    () => ({ rim: rimGeometry(), tyre: tyreGeometry(), hub: hubGeometries(), vehicle: vehicleGeometries(), valve: valveGeometry() }),
    [],
  );

  useEffect(() => {
    const clipped = [m.rim, m.spoke, m.stress, m.neutral, m.tyre, m.bolt, m.cap, m.capAccent, m.valve, m.vehicle, m.rotor];
    for (const mat of clipped) {
      mat.clippingPlanes = section ? [SECTION_PLANE] : null;
      mat.needsUpdate = true;
    }
  }, [section, m]);

  const rotating = useRef<THREE.Group>(null);
  const hub = useRef<THREE.Group>(null);
  const tyre = useRef<THREE.Group>(null);
  const vehicle = useRef<THREE.Group>(null);
  const explode = useRef(0);

  useFrame((_, dt) => {
    const s = sim.state;
    if (rotating.current) rotating.current.rotation.x = -s.theta;
    explode.current += ((exploded ? 1 : 0) - explode.current) * (1 - Math.exp(-dt * 4));
    const e = explode.current;
    const t = clock.t;

    const pr = partProgress('rim', t);
    geo.rim.setDrawRange(0, pr >= 1 ? Infinity : Math.floor(pr * RIM_SEGMENTS) * (RIM_POINTS - 1) * 6);

    const ph = partProgress('hub', t);
    if (hub.current) {
      hub.current.visible = ph > 0;
      hub.current.position.x = -(1 - ph) * 0.22;
    }
    const pt = partProgress('tyre', t);
    if (tyre.current) {
      tyre.current.visible = pt > 0;
      tyre.current.position.x = -(1 - pt) * 0.75 - e * 0.36;
    }
    if (vehicle.current) {
      vehicle.current.visible = ph > 0;
      vehicle.current.position.x = -e * 0.5;
    }
  });

  const valveA = Math.PI / sim.layout.N; // between spoke 0 and spoke 1
  const valveR = FIXED.rSeat - FIXED.wall - 0.012;

  return (
    <group>
      <group ref={rotating}>
        <mesh geometry={geo.rim} material={overlay ? m.neutral : m.rim} />
        <group ref={hub}>
          {geo.hub.map((g, i) => (
            <mesh key={i} geometry={g} material={overlay ? m.neutral : m.spoke} />
          ))}
        </group>
        <Spokes m={m} overlay={overlay} />
        <Bolts m={m} explode={explode} />
        <Cap m={m} explode={explode} />
        <mesh
          geometry={geo.valve}
          material={m.valve}
          position={[0.075, valveR * Math.cos(valveA), valveR * Math.sin(valveA)]}
          rotation={[valveA, 0, 0.5]}
        />
        <group ref={vehicle}>
          <mesh geometry={geo.vehicle.flange} material={m.vehicle} />
          <mesh geometry={geo.vehicle.hat} material={m.rotor} />
          <mesh geometry={geo.vehicle.rotor} material={m.rotor} />
        </group>
        {rig === 'rig-cornering' && <CorneringRigRotating />}
        <group ref={tyre}>
          {showTyre && <mesh geometry={geo.tyre} material={m.tyre} />}
        </group>
      </group>
      <mesh geometry={geo.vehicle.stub} material={m.vehicle} />
      <Road flatten={flatten} hidden={!!rig} />
      {rig === 'rig-radial' && <RadialDrum />}
      {rig === 'rig-cornering' && <MomentArrow />}
      {showLoads && <LoadArrows />}
    </group>
  );
}
