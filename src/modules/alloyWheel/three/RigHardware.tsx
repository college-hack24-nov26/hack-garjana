/**
 * Bench-test hardware for the two rig scenarios. It's context only: the loads
 * come from the sim (sim.rigMoment, the drum load as Fz), not from these meshes.
 *
 *   Cornering fatigue  shaft bolted to the hub face, a loading disc at its far
 *                      end, the rim clamped at its inboard flange, and a fixed
 *                      arrow for the bending moment. The wheel turns under it.
 *   Radial fatigue     a large drum under the tyre, turning so its surface
 *                      matches the tyre's.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { annulus } from '../../../three/geometry';
import { useWheelSim } from '../sim/useWheelSim';
import { FIXED } from '../wheel/drawing';

const SHAFT_END = -0.62;
export const DRUM_RADIUS = 0.855; // ≈ Ø1.7 m drum

function useSteel() {
  return useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: '#59616c', metalness: 0.8, roughness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2a3038', metalness: 0.6, roughness: 0.55 }),
      accent: new THREE.MeshBasicMaterial({ color: '#5eead4', toneMapped: false }),
    }),
    [],
  );
}

/** Parts that turn with the wheel. Mount inside the rotating group. */
export function CorneringRigRotating() {
  const m = useSteel();
  const geo = useMemo(() => {
    const len = FIXED.xMount - SHAFT_END;
    const shaft = new THREE.CylinderGeometry(0.045, 0.045, len, 40);
    shaft.rotateZ(Math.PI / 2);
    shaft.translate(SHAFT_END + len / 2, 0, 0);
    const adapter = annulus(0.03, 0.085, FIXED.xMount - 0.022, 0.022);
    const disc = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 48);
    disc.rotateZ(Math.PI / 2);
    disc.translate(SHAFT_END, 0, 0);
    const clamp = annulus(0.236, 0.3, FIXED.xInboard - 0.026, 0.026);
    const dog = new THREE.BoxGeometry(0.03, 0.03, 0.05);
    return { shaft, adapter, disc, clamp, dog };
  }, []);
  return (
    <group>
      <mesh geometry={geo.shaft} material={m.steel} />
      <mesh geometry={geo.adapter} material={m.dark} />
      <mesh geometry={geo.disc} material={m.dark} />
      <mesh geometry={geo.clamp} material={m.dark} />
      {Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return (
          <mesh
            key={k}
            geometry={geo.dog}
            material={m.steel}
            position={[FIXED.xInboard - 0.01, 0.268 * Math.cos(a), 0.268 * Math.sin(a)]}
            rotation={[a, 0, 0]}
          />
        );
      })}
    </group>
  );
}

/** The bending moment: a fixed curved arrow round the shaft's far end, in the vertical plane through the axle. */
export function MomentArrow() {
  const sim = useWheelSim();
  const m = useSteel();
  const label = useRef<HTMLSpanElement>(null);
  const geo = useMemo(() => {
    const arc = 1.35 * Math.PI;
    const ring = new THREE.TorusGeometry(0.17, 0.006, 10, 80, arc);
    ring.rotateZ(-arc / 2 + Math.PI / 2); // centred on the top
    const head = new THREE.ConeGeometry(0.018, 0.045, 18);
    // Arrow head at the arc's end, pointing along the tangent.
    const end = Math.PI / 2 + arc / 2;
    head.rotateZ(end);
    head.translate(0.17 * Math.cos(end), 0.17 * Math.sin(end), 0);
    return { ring, head };
  }, []);
  useFrame(() => {
    if (label.current) label.current.textContent = `M ${(sim.rigMoment / 1000).toFixed(2)} kN·m`;
  });
  return (
    <group position={[SHAFT_END + 0.06, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={geo.ring} material={m.accent} />
      <mesh geometry={geo.head} material={m.accent} />
      <group position={[0, 0.21, 0]}>
        <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <span className="force-label m" ref={label} />
        </Html>
      </group>
    </group>
  );
}

/** Drum under the tyre for the radial test. Its surface speed matches the tyre's. */
export function RadialDrum() {
  const sim = useWheelSim();
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#4b535e';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#353b44';
    for (let i = 0; i < 16; i++) ctx.fillRect(i * 32, 0, 10, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    return t;
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, 0.42, 160, 1);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  useFrame(() => {
    const s = sim.state;
    const g = ref.current;
    if (!g) return;
    g.position.y = -s.loadedRadius - DRUM_RADIUS - 0.0006;
    // Top of the drum moves +Z, with the bottom of the tyre.
    g.rotation.x = s.distanceM / DRUM_RADIUS;
  });
  return (
    <group ref={ref}>
      <mesh geometry={geo}>
        <meshStandardMaterial map={tex} metalness={0.7} roughness={0.45} />
      </mesh>
    </group>
  );
}
