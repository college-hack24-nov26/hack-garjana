import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import * as THREE from 'three';
import { useBrakeSim, useSimSnapshot, pressureColor } from '../sim/useBrakeSim';
import { annularSector, annulus, circlePath, extrudeToX, latheX, smoothProfile } from '../../../three/geometry';

/* ------------------------------------------------------------------ */
/*  Sizes in metres: roughly a 225/45 R18 tyre, 330 x 28 vented rotor */
/* ------------------------------------------------------------------ */
export const DIM = {
  rotorOut: 0.165,
  rotorIn: 0.105,
  plate: 0.009,
  half: 0.014, // rotor half thickness (faces at ±half)
  hatR: 0.085,
  pistonR: 0.135, // piston pitch radius
  padRIn: 0.108,
  padROut: 0.16,
  frictionT: 0.01,
  backingT: 0.004,
  pistonLen: 0.028,
  boreBottom: 0.066,
  bodyX0: 0.032,
  bodyDepth: 0.04,
  /** Pad gap as drawn in 3D. The real gap is about 0.15 mm a side, far too small to see. */
  gapVisual: 0.005,
  tyreR: 0.33,
};
export const CLEARANCE_EXAGGERATION = DIM.gapVisual / 0.00015; // about 33x

/** Where the caliper sits around the axle, rad. Its local +Y ends up pointing along (0, cos a, sin a). */
export const CALIPER_ANGLE = -Math.PI / 3;
export const CALIPER_DIR = new THREE.Vector3(0, Math.cos(CALIPER_ANGLE), Math.sin(CALIPER_ANGLE));

/* ------------------------------------------------------------------ */
/*  Shared materials                                                   */
/* ------------------------------------------------------------------ */
function useMaterials() {
  return useMemo(() => {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
    return {
      rotor: std({ color: '#9aa0a8', metalness: 0.85, roughness: 0.36 }),
      rotorDark: std({ color: '#5b6068', metalness: 0.8, roughness: 0.55 }),
      slot: std({ color: '#1f2227', metalness: 0.4, roughness: 0.8 }),
      hat: std({ color: '#71767e', metalness: 0.8, roughness: 0.45 }),
      rim: std({ color: '#c3c9d1', metalness: 1, roughness: 0.22, side: THREE.DoubleSide }),
      spoke: std({ color: '#b9c0c9', metalness: 1, roughness: 0.26 }),
      lug: std({ color: '#e2e6eb', metalness: 1, roughness: 0.15 }),
      cap: std({ color: '#0f172a', metalness: 0.6, roughness: 0.35 }),
      capRing: std({ color: '#22d3ee', emissive: '#0891b2', emissiveIntensity: 0.6 }),
      tyre: std({ color: '#17191d', metalness: 0, roughness: 0.92, side: THREE.DoubleSide }),
      tread: std({ color: '#0c0d10', metalness: 0, roughness: 1 }),
      caliper: std({ color: '#b4232a', metalness: 0.35, roughness: 0.32 }),
      piston: std({ color: '#dfe3e8', metalness: 1, roughness: 0.12 }),
      friction: std({ color: '#2a2b2f', metalness: 0.05, roughness: 0.95, emissive: '#ff5a1f', emissiveIntensity: 0 }),
      backing: std({ color: '#4d535c', metalness: 0.75, roughness: 0.4 }),
      fluid: std({ color: '#fde047', emissive: '#fde047', emissiveIntensity: 0.35, metalness: 0, roughness: 0.3 }),
      line: std({ color: '#fde047', emissive: '#fde047', emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.4 }),
      knuckle: std({ color: '#2b3038', metalness: 0.55, roughness: 0.65 }),
      bolt: std({ color: '#8e959e', metalness: 1, roughness: 0.3 }),
    };
  }, []);
}
type Mats = ReturnType<typeof useMaterials>;

/* ------------------------------------------------------------------ */
/*  The spinning parts: rotor, hub, wheel and tyre all turn as one    */
/* ------------------------------------------------------------------ */
function Rotor({ m }: { m: Mats }) {
  const geo = useMemo(() => {
    const studs = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      return circlePath(0.057 * Math.cos(a), 0.057 * Math.sin(a), 0.0075);
    });
    const hatTube = new THREE.CylinderGeometry(DIM.hatR, DIM.hatR, 0.04, 72, 1, true);
    hatTube.rotateZ(Math.PI / 2);
    hatTube.translate(0.025, 0, 0);
    return {
      outPlate: annulus(DIM.rotorIn, DIM.rotorOut, DIM.half - DIM.plate, DIM.plate),
      inPlate: annulus(DIM.rotorIn, DIM.rotorOut, -DIM.half, DIM.plate),
      neck: annulus(DIM.hatR - 0.003, DIM.rotorIn + 0.002, DIM.half - DIM.plate, 0.004),
      hatTube,
      hatFace: annulus(0.034, DIM.hatR + 0.002, 0.045, 0.004, studs),
      vane: new THREE.BoxGeometry(2 * (DIM.half - DIM.plate) + 0.0004, DIM.rotorOut - DIM.rotorIn - 0.004, 0.0045),
      slot: new THREE.BoxGeometry(0.0008, 0.042, 0.0028),
    };
  }, []);

  const vanes = useRef<THREE.InstancedMesh>(null);
  const slots = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = (DIM.rotorIn + DIM.rotorOut) / 2;
      o.position.set(0, r * Math.cos(a), r * Math.sin(a));
      o.rotation.set(a, 0, 0);
      o.updateMatrix();
      vanes.current!.setMatrixAt(i, o.matrix);
    }
    vanes.current!.instanceMatrix.needsUpdate = true;
    // Curved slots on the rotor face, so you can actually see it spinning.
    let k = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (side > 0 ? 0 : Math.PI / 6);
        const r = 0.136;
        o.position.set(side * (DIM.half + 0.0002), r * Math.cos(a), r * Math.sin(a));
        o.rotation.set(a + 0.45, 0, 0);
        o.updateMatrix();
        slots.current!.setMatrixAt(k++, o.matrix);
      }
    }
    slots.current!.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <mesh geometry={geo.outPlate} material={m.rotor} />
      <mesh geometry={geo.inPlate} material={m.rotor} />
      <mesh geometry={geo.neck} material={m.hat} />
      <mesh geometry={geo.hatTube} material={m.hat} />
      <mesh geometry={geo.hatFace} material={m.hat} />
      <instancedMesh ref={vanes} args={[geo.vane, m.rotorDark, 40]} />
      <instancedMesh ref={slots} args={[geo.slot, m.slot, 12]} />
    </group>
  );
}

function Wheel({ m, showTyre }: { m: Mats; showTyre: boolean }) {
  const geo = useMemo(() => {
    // Rim barrel: a closed (r, x) outline spun around the axle.
    const rimProfile: [number, number][] = [
      [0.222, 0.101], [0.238, 0.104], [0.243, 0.099], [0.236, 0.092], [0.229, 0.086],
      [0.222, 0.06], [0.216, 0.02], [0.216, -0.06], [0.229, -0.086], [0.236, -0.092],
      [0.243, -0.099], [0.238, -0.104], [0.222, -0.101], [0.211, -0.094], [0.208, -0.06],
      [0.208, 0.02], [0.212, 0.06], [0.217, 0.092], [0.222, 0.101],
    ];
    const tyreProfile = smoothProfile(
      [
        [0.229, -0.1], [0.262, -0.112], [0.3, -0.113], [0.322, -0.104], [0.33, -0.085],
        [0.331, 0], [0.33, 0.085], [0.322, 0.104], [0.3, 0.113], [0.262, 0.112], [0.229, 0.1],
      ],
      90,
    );
    // Tapered spoke drawn in (tangential, radial), leaning outboard the further out it goes.
    const r0 = 0.068;
    const r1 = 0.214;
    const s = new THREE.Shape();
    s.moveTo(-0.011, r0);
    s.lineTo(0.011, r0);
    s.lineTo(0.0065, r1);
    s.lineTo(-0.0065, r1);
    s.closePath();
    const spoke = extrudeToX(s, 0.05, 0.016, 0.003);
    const pos = spoke.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) + ((y - r0) / (r1 - r0)) * 0.03);
    }
    spoke.computeVertexNormals();
    const studs = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      return circlePath(0.057 * Math.cos(a), 0.057 * Math.sin(a), 0.008);
    });
    const lug = new THREE.CylinderGeometry(0.0105, 0.0105, 0.016, 6);
    lug.rotateZ(Math.PI / 2);
    const cap = new THREE.CylinderGeometry(0.03, 0.032, 0.012, 48);
    cap.rotateZ(Math.PI / 2);
    return {
      rim: latheX(rimProfile, 120),
      tyre: latheX(tyreProfile, 120),
      spoke,
      disc: annulus(0.033, 0.08, 0.047, 0.018, studs),
      lug,
      cap,
      capRing: annulus(0.026, 0.031, 0.0715, 0.002),
      tread: new THREE.BoxGeometry(0.17, 0.006, 0.012),
    };
  }, []);

  const tread = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!tread.current) return;
    const o = new THREE.Object3D();
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      o.position.set(0, 0.3305 * Math.cos(a), 0.3305 * Math.sin(a));
      o.rotation.set(a, 0.35, 0);
      o.updateMatrix();
      tread.current.setMatrixAt(i, o.matrix);
    }
    tread.current.instanceMatrix.needsUpdate = true;
  }, [showTyre]);

  return (
    <group>
      <mesh geometry={geo.rim} material={m.rim} />
      <mesh geometry={geo.disc} material={m.spoke} />
      {Array.from({ length: 5 }, (_, i) =>
        [-0.11, 0.11].map((off) => (
          <mesh
            key={`${i}${off}`}
            geometry={geo.spoke}
            material={m.spoke}
            rotation={[(i / 5) * Math.PI * 2 + off, 0, 0]}
          />
        )),
      )}
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh
            key={i}
            geometry={geo.lug}
            material={m.lug}
            position={[0.07, 0.057 * Math.cos(a), 0.057 * Math.sin(a)]}
          />
        );
      })}
      <mesh geometry={geo.cap} material={m.cap} position={[0.066, 0, 0]} />
      <mesh geometry={geo.capRing} material={m.capRing} />
      {showTyre && (
        <>
          <mesh geometry={geo.tyre} material={m.tyre} />
          <instancedMesh ref={tread} args={[geo.tread, m.tread, 64]} />
        </>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Fixed caliper: n pistons a side, plus the pads and hydraulics     */
/* ------------------------------------------------------------------ */
function pistonOffsets(n: number) {
  if (n <= 1) return [0];
  if (n === 2) return [-0.026, 0.026];
  return [-0.044, 0, 0.044];
}

/** One caliper half, built for the outboard side. The inboard half is the same thing mirrored (scale x = -1). */
function CaliperHalf({ m, cutaway, side }: { m: Mats; cutaway: boolean; side: 1 | -1 }) {
  const sim = useSimSnapshot(); // only re-renders when parameters change
  const n = sim.params.pistonsPerSide;
  const pr = sim.params.pistonDiaMm / 2000;
  const offsets = pistonOffsets(n);

  const geo = useMemo(() => {
    const piston = new THREE.CylinderGeometry(1, 1, 1, 40);
    piston.rotateZ(Math.PI / 2); // point the axis along X
    piston.translate(0.5, 0, 0); // now runs from x = 0 to 1
    const pistonCup = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    pistonCup.rotateZ(Math.PI / 2);
    pistonCup.translate(0.5, 0, 0);
    return {
      body: annularSector(0.098, 0.193, 0.6, DIM.bodyX0, DIM.bodyDepth, 0.004),
      friction: annularSector(DIM.padRIn, DIM.padROut, 0.43, 0, DIM.frictionT, 0.0012),
      backing: annularSector(DIM.padRIn - 0.004, DIM.padROut + 0.003, 0.47, DIM.frictionT, DIM.backingT),
      piston,
      pistonCup,
    };
  }, []);

  const padGroup = useRef<THREE.Group>(null);
  const pistons = useRef<(THREE.Group | null)[]>([]);
  const fluids = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    const s = sim.state;
    const gap = DIM.gapVisual * (1 - s.contactFraction);
    const padX = DIM.half + gap;
    const pistonFace = padX + DIM.frictionT + DIM.backingT;
    padGroup.current?.position.set(padX, 0, 0);
    for (const g of pistons.current) g?.position.setX(pistonFace);
    const fluidStart = pistonFace + DIM.pistonLen;
    const fluidLen = Math.max(0.0005, DIM.boreBottom - fluidStart);
    for (const f of fluids.current) {
      if (!f) continue;
      f.position.setX(fluidStart);
      f.scale.setX(fluidLen);
    }
  });

  const bodyMat = useMemo(() => {
    const mat = m.caliper.clone();
    return mat;
  }, [m.caliper]);
  useEffect(() => {
    bodyMat.transparent = cutaway;
    bodyMat.opacity = cutaway ? 0.16 : 1;
    bodyMat.depthWrite = !cutaway;
    bodyMat.color.set(cutaway ? '#67e8f9' : '#b4232a');
    bodyMat.needsUpdate = true;
  }, [cutaway, bodyMat]);

  return (
    <group scale={[side, 1, 1]}>
      <mesh geometry={geo.body} material={bodyMat} renderOrder={2}>
        {cutaway && <Edges threshold={25} color="#22d3ee" />}
      </mesh>
      {offsets.map((z, i) => {
        const a = z / DIM.pistonR;
        const y = DIM.pistonR * Math.cos(a);
        const zz = DIM.pistonR * Math.sin(a);
        return (
          <group key={`${n}-${i}`} position={[0, y, zz]}>
            <group ref={(el) => (pistons.current[i] = el)}>
              <mesh geometry={geo.piston} material={m.piston} scale={[DIM.pistonLen, pr, pr]} />
            </group>
            <mesh
              ref={(el) => (fluids.current[i] = el)}
              geometry={geo.piston}
              material={m.fluid}
              scale={[0.005, pr * 0.97, pr * 0.97]}
            />
            {/* Seal ring around the mouth of each bore */}
            <mesh
              geometry={geo.pistonCup}
              material={m.backing}
              position={[DIM.bodyX0 - 0.0005, 0, 0]}
              scale={[0.004, pr * 1.08, pr * 1.08]}
            />
          </group>
        );
      })}
      <group ref={padGroup}>
        <mesh geometry={geo.friction} material={m.friction} />
        <mesh geometry={geo.backing} material={m.backing} />
      </group>
    </group>
  );
}

function Caliper({ m, cutaway }: { m: Mats; cutaway: boolean }) {
  const sim = useBrakeSim();
  const geo = useMemo(() => {
    const bridge = (offset: number) => {
      const g = annularSector(0.17, 0.193, 0.1, -DIM.bodyX0 - 0.002, 2 * DIM.bodyX0 + 0.004, 0.003);
      g.rotateX(offset);
      return g;
    };
    const line = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.074, 0.168, 0.03),
        new THREE.Vector3(-0.105, 0.185, 0.04),
        new THREE.Vector3(-0.15, 0.25, 0.02),
        new THREE.Vector3(-0.2, 0.33, -0.04),
        new THREE.Vector3(-0.26, 0.45, -0.06),
        new THREE.Vector3(-0.3, 0.6, -0.06),
      ]),
      80,
      0.0045,
      12,
    );
    const cross = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.07, 0.186, -0.055),
        new THREE.Vector3(-0.045, 0.199, -0.06),
        new THREE.Vector3(0, 0.201, -0.062),
        new THREE.Vector3(0.045, 0.199, -0.06),
        new THREE.Vector3(0.07, 0.186, -0.055),
      ]),
      40,
      0.0028,
      10,
    );
    const banjo = new THREE.CylinderGeometry(0.009, 0.009, 0.012, 20);
    banjo.rotateZ(Math.PI / 2);
    const bleed = new THREE.CylinderGeometry(0.0045, 0.006, 0.02, 12);
    const bolt = new THREE.CylinderGeometry(0.008, 0.008, 0.05, 16);
    bolt.rotateZ(Math.PI / 2);
    const ear = annularSector(0.07, 0.112, 0.12, -0.082, 0.018, 0.003);
    const housing = new THREE.CylinderGeometry(0.062, 0.066, 0.05, 48);
    housing.rotateZ(Math.PI / 2);
    const hubShaft = new THREE.CylinderGeometry(0.03, 0.03, 0.06, 32);
    hubShaft.rotateZ(Math.PI / 2);
    return {
      bridgeA: bridge(0.43),
      bridgeB: bridge(-0.43),
      bridgeC: bridge(0),
      line,
      cross,
      banjo,
      bleed,
      bolt,
      earA: ear.clone().rotateX(0.7),
      earB: ear.clone().rotateX(-0.7),
      arm: new THREE.BoxGeometry(0.016, 0.12, 0.09),
      housing,
      hubShaft,
    };
  }, []);

  const bridgeMat = useMemo(() => m.caliper.clone(), [m.caliper]);
  useEffect(() => {
    bridgeMat.transparent = cutaway;
    bridgeMat.opacity = cutaway ? 0.16 : 1;
    bridgeMat.depthWrite = !cutaway;
    bridgeMat.color.set(cutaway ? '#67e8f9' : '#b4232a');
    bridgeMat.needsUpdate = true;
  }, [cutaway, bridgeMat]);

  // Fluid colour, pad glow and rotor heat glow, all taken from the sim state.
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const s = sim.state;
    col.set(pressureColor(s.pressure));
    m.fluid.color.copy(col);
    m.fluid.emissive.copy(col);
    m.line.color.copy(col);
    m.line.emissive.copy(col);
    m.line.emissiveIntensity = 0.2 + 0.5 * Math.min(1, s.pressure / 10);
    m.fluid.emissiveIntensity = 0.3 + 0.5 * Math.min(1, s.pressure / 10);
    const frictionPowerW = s.brakeTorque * s.omega;
    m.friction.emissiveIntensity = Math.min(1.4, frictionPowerW / 60000);
    const hot = Math.max(0, Math.min(1, (s.rotorTempC - 250) / 450));
    m.rotor.emissive.setRGB(hot * 0.9, hot * 0.22, 0);
  });

  return (
    <group rotation={[CALIPER_ANGLE, 0, 0]}>
      <CaliperHalf m={m} cutaway={cutaway} side={1} />
      <CaliperHalf m={m} cutaway={cutaway} side={-1} />
      <mesh geometry={geo.bridgeA} material={bridgeMat} renderOrder={2} />
      <mesh geometry={geo.bridgeB} material={bridgeMat} renderOrder={2} />
      <mesh geometry={geo.bridgeC} material={bridgeMat} renderOrder={2} scale={[1, 1, 0.5]} />
      {/* Hydraulic lines (these don't move) */}
      <mesh geometry={geo.line} material={m.line} />
      <mesh geometry={geo.cross} material={m.line} />
      <mesh geometry={geo.banjo} material={m.bolt} position={[-0.078, 0.168, 0.03]} />
      <mesh geometry={geo.bleed} material={m.bolt} position={[0.06, 0.198, 0.05]} />
      {/* Caliper ears bolted to the knuckle, which doesn't move */}
      <mesh geometry={geo.earA} material={bridgeMat} />
      <mesh geometry={geo.earB} material={bridgeMat} />
      {[0.7, -0.7].map((a) => (
        <mesh
          key={a}
          geometry={geo.bolt}
          material={m.bolt}
          position={[-0.08, 0.091 * Math.cos(a), 0.091 * Math.sin(a)]}
        />
      ))}
      <mesh geometry={geo.arm} material={m.knuckle} position={[-0.096, 0.055, 0]} />
      <mesh geometry={geo.housing} material={m.knuckle} position={[-0.115, 0, 0]} rotation={[-CALIPER_ANGLE, 0, 0]} />
      <mesh geometry={geo.hubShaft} material={m.bolt} position={[-0.07, 0, 0]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Cutaway: slices a wedge out of the wheel and tyre at the caliper  */
/* ------------------------------------------------------------------ */
function wedgePlanes(): THREE.Plane[] {
  const tilt = 0.6; // rad. Plane normals at ±tilt give a wedge half-angle of 90° - tilt
  return [tilt, -tilt].map((t) => {
    const a = CALIPER_ANGLE + t;
    const n = new THREE.Vector3(0, -Math.cos(a), -Math.sin(a));
    return new THREE.Plane(n, 0);
  });
}

export function BrakeAssembly({ cutaway, showTyre }: { cutaway: boolean; showTyre: boolean }) {
  const sim = useBrakeSim();
  const m = useMaterials();
  const rotating = useRef<THREE.Group>(null);
  const planes = useMemo(wedgePlanes, []);

  useEffect(() => {
    for (const mat of [m.rim, m.spoke, m.tyre, m.tread, m.lug, m.cap, m.capRing]) {
      mat.clippingPlanes = cutaway ? planes : null;
      mat.clipIntersection = true;
      mat.needsUpdate = true;
    }
  }, [cutaway, m, planes]);

  // Wheel and rotor share one transform: same axle, same angle, same sim state.
  useFrame(() => {
    if (rotating.current) rotating.current.rotation.x = -sim.state.theta;
  });

  return (
    <group>
      <group ref={rotating}>
        <Rotor m={m} />
        <Wheel m={m} showTyre={showTyre} />
      </group>
      <Caliper m={m} cutaway={cutaway} />
    </group>
  );
}
