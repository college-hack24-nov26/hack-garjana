/**
 * The animated inline-4 cutaway with the split A/B spark plugs.
 *
 * Ported from AutoTwin's frontend/src/engine/EngineScene.tsx. The geometry,
 * materials and plug model are theirs. What changed in the port:
 *  1. Motion comes from the EngineSim every frame. The original got the crank
 *     angle as React props from a 100 ms timer, so the pistons only moved about
 *     10 times a second.
 *  2. The rod is rigid now (see engine/linkage.ts). The original stretched it
 *     (down to 10% of its length at BDC) and mirrored its bottom end in z away
 *     from the crank pin.
 *  3. Materials and the glow texture are made once per scene instead of once
 *     per cylinder and per plug. Tip colours update in place.
 *
 * New here: fire inside each cylinder (fireMaterial.ts) that fills the space
 * between piston and head, plus a spark flash at the plug gap. Its timing
 * comes from engine/combustionVisual.ts and it can be turned off.
 *
 * The engine is just context: a generic 2.0 L, not a model of any real engine.
 * Plug tip colour shows the tip temperatures the user typed in.
 */
import { createContext, memo, useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CYLINDER_DESIGN, CYLINDER_PHASE, cylinderCycleAngle, type EngineGeometry } from '../engine/kinematics';
import { combustionEvent, degSinceSpark, fireLuminosity, flameFront, sparkFlash } from '../engine/combustionVisual';
import { crankLinkage } from '../engine/linkage';
import type { PlugGeometry } from '../sim/engineSim';
import { useEngineSim } from '../sim/useEngineSim';
import { createFireMaterial } from './fireMaterial';

export const A_COLOUR = '#f0a93b';
export const B_COLOUR = '#38bdf8';

/** The wrist pin sits 10 mm below the middle of the piston, and the crown is 15 mm above it. */
const WRIST_TO_CENTRE = 0.01;
const CENTRE_TO_CROWN = 0.015;
const TDC_CLEARANCE = 0.006;
/** Height of the crank centre in the scene. */
export const ENGINE_Y = -0.1;

export function deckHeight(g: EngineGeometry) {
  return g.stroke / 2 + g.rodLength + WRIST_TO_CENTRE + CENTRE_TO_CROWN + TDC_CLEARANCE;
}

/* ------------------------------------------------------- shared materials */

function createMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: '#aab6c4', metalness: 0.92, roughness: 0.3 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#49566a', metalness: 0.85, roughness: 0.42 }),
    block: new THREE.MeshStandardMaterial({
      color: '#1a2534',
      metalness: 0.5,
      roughness: 0.65,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    bore: new THREE.MeshStandardMaterial({
      color: '#7e8d9f',
      metalness: 0.6,
      roughness: 0.55,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    ceramic: new THREE.MeshStandardMaterial({ color: '#e8ecf1', metalness: 0.05, roughness: 0.52 }),
    shell: new THREE.MeshStandardMaterial({ color: '#2f3a49', metalness: 0.88, roughness: 0.35 }),
    seatA: new THREE.MeshStandardMaterial({
      color: A_COLOUR,
      metalness: 0.6,
      roughness: 0.35,
      emissive: A_COLOUR,
      emissiveIntensity: 0.45,
    }),
    seatB: new THREE.MeshStandardMaterial({
      color: B_COLOUR,
      metalness: 0.6,
      roughness: 0.35,
      emissive: B_COLOUR,
      emissiveIntensity: 0.45,
    }),
    tipA: new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.4, emissiveIntensity: 1.1 }),
    tipB: new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.4, emissiveIntensity: 1.1 }),
  };
}
type Mats = ReturnType<typeof createMaterials>;
const MatsContext = createContext<Mats | null>(null);
const useMats = () => useContext(MatsContext)!;

/** Soft round glow texture, used for the fire halo and the spark flash. */
function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,248,1)');
    g.addColorStop(0.18, 'rgba(255,236,178,0.96)');
    g.addColorStop(0.42, 'rgba(255,178,74,0.62)');
    g.addColorStop(0.72, 'rgba(236,122,32,0.2)');
    g.addColorStop(1.0, 'rgba(180,70,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------ spark plug */

/** One spark plug: ribbed ceramic insulator, metal shell, A/B seat ring, tip. */
function SparkPlug({ design, scale, plug }: { design: 'A' | 'B'; scale: number; plug: PlugGeometry }) {
  const m = useMats();
  const s = scale;
  const shellRadius = (plug.threadDiameter / 2) * s;
  const noseRadius = (plug.noseDiameter / 2) * s;
  const electrodeRadius = (plug.electrodeDiameter / 2) * s;
  const noseLength = plug.noseLength * s;
  const protrusion = plug.electrodeProtrusion * s;
  const threadLength = plug.shellLength * s * 0.78;
  const ribs = [0, 1, 2, 3].map((i) => 0.03 * s - i * 0.0075 * s);

  return (
    <group>
      {/* Ceramic insulator barrel */}
      <mesh position={[0, 0.04 * s, 0]} material={m.ceramic}>
        <cylinderGeometry args={[0.0085 * s, 0.0085 * s, 0.04 * s, 20]} />
      </mesh>
      {/* Ribs on the insulator */}
      {ribs.map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.ceramic}>
          <torusGeometry args={[0.0088 * s, 0.0022 * s, 8, 22]} />
        </mesh>
      ))}
      {/* Metal shell with the hex */}
      <mesh position={[0, 0.0095 * s, 0]} material={m.shell}>
        <cylinderGeometry args={[shellRadius * 1.17, shellRadius * 1.17, 0.015 * s, 6]} />
      </mesh>
      {/* Coloured seat ring, so you can tell A from B */}
      <mesh position={[0, 0.0012 * s, 0]} material={design === 'A' ? m.seatA : m.seatB}>
        <cylinderGeometry args={[shellRadius * 1.2, shellRadius * 1.2, 0.0028 * s, 20]} />
      </mesh>
      {/* Threaded part, at the plug's real thread diameter */}
      <mesh position={[0, -threadLength / 2, 0]} material={m.shell}>
        <cylinderGeometry args={[shellRadius, shellRadius, threadLength, 18]} />
      </mesh>
      {/* Insulator nose sticking out past the shell. Its length sets the heat range */}
      <mesh position={[0, -threadLength - noseLength / 2, 0]} material={m.ceramic}>
        <cylinderGeometry args={[noseRadius * 0.9, noseRadius, noseLength, 16]} />
      </mesh>
      {/* Centre electrode, coloured by the tip temperature */}
      <mesh position={[0, -threadLength - noseLength - protrusion / 2, 0]} material={design === 'A' ? m.tipA : m.tipB}>
        <cylinderGeometry args={[electrodeRadius, electrodeRadius, protrusion, 12]} />
      </mesh>
      {/* Ground strap that reaches over the gap */}
      <mesh position={[0, -threadLength - noseLength / 2, shellRadius * 0.62]} material={m.shell}>
        <boxGeometry args={[electrodeRadius * 2, noseLength + protrusion, electrodeRadius]} />
      </mesh>
      <mesh
        position={[0, -threadLength - noseLength - protrusion - electrodeRadius, shellRadius * 0.31]}
        material={m.shell}
      >
        <boxGeometry args={[electrodeRadius * 2, electrodeRadius, shellRadius * 1.24]} />
      </mesh>
    </group>
  );
}

/** How far above the deck the spark gap is, for a plug drawn at `scale`. Has to match the SparkPlug layout above. */
function sparkGapAboveDeck(plug: PlugGeometry, scale: number) {
  const plugBase = 0.03 * scale + 0.004;
  return plugBase - (plug.shellLength * 0.78 + plug.noseLength + plug.electrodeProtrusion + plug.electrodeDiameter / 4) * scale;
}

/* ------------------------------------------------------------- cylinder */

interface CylinderProps {
  index: number;
  geometry: EngineGeometry;
  x: number;
  showPlug: boolean;
  plugScale: number;
  plug: PlugGeometry;
  glow: THREE.Texture;
  combustion: boolean;
}

/** One cylinder: bore, piston, rod, crank throw, plug and its fire. */
function Cylinder({ index, geometry, x, showPlug, plugScale, plug, glow, combustion }: CylinderProps) {
  const m = useMats();
  const sim = useEngineSim();
  const pistonRef = useRef<THREE.Group>(null);
  const rodRef = useRef<THREE.Mesh>(null);
  const throwRef = useRef<THREE.Group>(null);
  const fireRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const sparkRef = useRef<THREE.Sprite>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const r = geometry.stroke / 2;
  const l = geometry.rodLength;
  const deck = deckHeight(geometry);
  const design = CYLINDER_DESIGN[index] ?? 'A';
  const fireRadius = geometry.bore / 2 - 0.0016;
  const sparkY = deck + sparkGapAboveDeck(plug, plugScale);

  const fireMaterial = useMemo(() => createFireMaterial(fireRadius), [fireRadius]);
  const [haloMaterial, sparkMaterial] = useMemo(() => {
    const sprite = (color: string, depthTest: boolean) =>
      new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest,
        opacity: 0,
        toneMapped: false,
      });
    return [sprite('#ff7a1c', true), sprite('#d4e8ff', false)];
  }, [glow]);
  useEffect(
    () => () => {
      fireMaterial.dispose();
      haloMaterial.dispose();
      sparkMaterial.dispose();
    },
    [fireMaterial, haloMaterial, sparkMaterial],
  );

  useFrame(() => {
    const cycle = cylinderCycleAngle(index, sim.state.crankDeg);
    const k = crankLinkage(cycle, geometry);
    const pistonY = k.wristY + WRIST_TO_CENTRE;
    const crownY = pistonY + CENTRE_TO_CROWN;

    if (pistonRef.current) pistonRef.current.position.y = pistonY;
    if (throwRef.current) throwRef.current.rotation.x = (cycle * Math.PI) / 180;
    if (rodRef.current) {
      rodRef.current.position.set(0, (k.wristY + k.pinY) / 2, k.pinZ / 2);
      rodRef.current.rotation.x = k.rodAngle;
    }

    // The fire fills the space from just above the crown up to the head, so resize it with the piston every frame.
    const glowLevel = combustion ? fireLuminosity(cycle) : 0;
    const flash = combustion ? sparkFlash(cycle) : 0;
    const bottom = crownY + 0.0006; // sit just above the crown so the two faces don't z-fight
    const top = deck - 0.0004;
    const height = Math.max(top - bottom, 0.001);
    const midY = (top + bottom) / 2;
    const burning = glowLevel > 0.002;

    const fire = fireRef.current;
    if (fire) {
      fire.visible = burning;
      if (burning) {
        fire.position.y = midY;
        fire.scale.set(fireRadius, height, fireRadius);
        const u = fireMaterial.uniforms;
        u.uIntensity.value = glowLevel;
        u.uFront.value = flameFront(cycle);
        u.uPhase.value = degSinceSpark(cycle) / 90;
        u.uHeight.value = height;
        // New flame pattern for each firing, but it still replays the same way every time.
        const event = combustionEvent(CYLINDER_PHASE[index] ?? 0, sim.state.totalDeg);
        u.uSeed.value = (((event * 0.618034 + index * 0.27) % 1) + 1) % 1 * 37;
      }
    }
    const halo = haloRef.current;
    if (halo) {
      halo.visible = burning;
      halo.position.y = midY;
      halo.scale.set(geometry.bore * 2.4, height + geometry.bore * 1.3, 1);
      haloMaterial.opacity = glowLevel * 0.26;
    }
    const spark = sparkRef.current;
    if (spark) {
      spark.visible = flash > 0;
      const size = geometry.bore * (0.16 + 0.34 * flash);
      spark.scale.set(size, size, 1);
      sparkMaterial.opacity = flash;
    }
    if (lightRef.current) {
      lightRef.current.intensity = glowLevel * 3.4 + flash * 0.8;
      lightRef.current.position.y = midY;
    }
  });

  return (
    <group position={[x, 0, 0]}>
      {/* Cylinder wall, drawn see-through */}
      <mesh position={[0, deck - geometry.stroke * 0.75, 0]} material={m.bore}>
        <cylinderGeometry args={[geometry.bore / 2, geometry.bore / 2, geometry.stroke * 1.5, 28, 1, true]} />
      </mesh>

      {/* Piston body, rings and wrist pin */}
      <group ref={pistonRef}>
        <mesh material={m.steel}>
          <cylinderGeometry args={[geometry.bore / 2 - 0.0012, geometry.bore / 2 - 0.0012, 0.03, 28]} />
        </mesh>
        {[0.01, 0.0035, -0.003].map((y, i) => (
          <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.darkSteel}>
            <torusGeometry args={[geometry.bore / 2 - 0.0012, 0.0011, 6, 28]} />
          </mesh>
        ))}
        <mesh position={[0, -WRIST_TO_CENTRE, 0]} rotation={[0, 0, Math.PI / 2]} material={m.darkSteel}>
          <cylinderGeometry args={[0.0075, 0.0075, 0.03, 14]} />
        </mesh>
      </group>

      {/* Connecting rod, rigid, from crank pin to wrist pin */}
      <mesh ref={rodRef} material={m.steel}>
        <boxGeometry args={[0.014, l, 0.009]} />
      </mesh>

      {/* Crank throw: pin at +r (pointing up at TDC), counterweight on the other side */}
      <group ref={throwRef}>
        <mesh position={[0, r, 0]} rotation={[0, 0, Math.PI / 2]} material={m.darkSteel}>
          <cylinderGeometry args={[0.0135, 0.0135, 0.026, 16]} />
        </mesh>
        <mesh position={[0, r / 2, 0]} material={m.darkSteel}>
          <boxGeometry args={[0.02, r, 0.02]} />
        </mesh>
        <mesh position={[0, -r * 0.62, 0]} material={m.darkSteel}>
          <boxGeometry args={[0.02, r * 1.15, 0.04]} />
        </mesh>
      </group>

      {/* Spark plug above the deck */}
      {showPlug && (
        <group position={[0, deck + 0.03 * plugScale + 0.004, 0]}>
          <SparkPlug design={design} scale={plugScale} plug={plug} />
        </group>
      )}

      {/* Fire, its soft halo, the spark flash at the plug gap, and the orange light it throws */}
      <mesh ref={fireRef} material={fireMaterial} renderOrder={5} visible={false}>
        <cylinderGeometry args={[1, 1, 1, 48, 1, false]} />
      </mesh>
      <sprite ref={haloRef} material={haloMaterial} renderOrder={6} visible={false} />
      <sprite ref={sparkRef} material={sparkMaterial} position={[0, sparkY, 0]} renderOrder={7} visible={false} />
      <pointLight ref={lightRef} color="#ff8a2a" intensity={0} distance={geometry.bore * 8} decay={2} />
    </group>
  );
}

/* --------------------------------------------------------- crankshaft */

function Crankshaft({ geometry }: { geometry: EngineGeometry }) {
  const m = useMats();
  const sim = useEngineSim();
  const ref = useRef<THREE.Group>(null);
  const span = geometry.cylinderPitch * geometry.cylinders;
  useFrame(() => {
    if (ref.current) ref.current.rotation.x = (sim.state.crankDeg * Math.PI) / 180;
  });
  return (
    <group ref={ref}>
      <mesh rotation={[0, 0, Math.PI / 2]} material={m.steel}>
        <cylinderGeometry args={[0.019, 0.019, span, 22]} />
      </mesh>
      {Array.from({ length: geometry.cylinders + 1 }, (_, i) => (
        <mesh
          key={i}
          position={[-span / 2 + i * geometry.cylinderPitch, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={m.darkSteel}
        >
          <cylinderGeometry args={[0.026, 0.026, 0.017, 20]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------- the scene */

export interface EngineSceneProps {
  geometry: EngineGeometry;
  tipColours: Record<'A' | 'B', string>;
  plug: PlugGeometry;
  showPlugs?: boolean;
  plugScale?: number;
  showBlock?: boolean;
  /** Show the fire, spark flash and fire light inside the cylinders. */
  combustion?: boolean;
}

export const EngineScene = memo(function EngineScene({
  geometry,
  tipColours,
  plug,
  showPlugs = true,
  plugScale = 1.6,
  showBlock = true,
  combustion = true,
}: EngineSceneProps) {
  const mats = useMemo(createMaterials, []);
  const glow = useMemo(createGlowTexture, []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((mat) => mat.dispose());
      glow.dispose();
    },
    [mats, glow],
  );
  useEffect(() => {
    for (const [mat, c] of [
      [mats.tipA, tipColours.A],
      [mats.tipB, tipColours.B],
    ] as const) {
      mat.color.set(c);
      mat.emissive.set(c);
    }
  }, [mats, tipColours.A, tipColours.B]);

  const span = geometry.cylinderPitch * geometry.cylinders;
  const deck = deckHeight(geometry);

  return (
    <MatsContext.Provider value={mats}>
      <group position={[0, ENGINE_Y, 0]}>
        {showBlock && (
          <>
            {/* Deck plate the plugs thread into */}
            <mesh position={[0, deck + geometry.stroke * 0.3, 0]} material={mats.block} renderOrder={3}>
              <boxGeometry args={[span, 0.018, geometry.bore * 1.5]} />
            </mesh>
            {/* Crankcase floor, for depth */}
            <mesh position={[0, -geometry.stroke * 1.25, 0]} material={mats.block} renderOrder={3}>
              <boxGeometry args={[span, 0.012, geometry.bore * 1.6]} />
            </mesh>
          </>
        )}
        {Array.from({ length: geometry.cylinders }, (_, index) => (
          <Cylinder
            key={index}
            index={index}
            geometry={geometry}
            x={-span / 2 + geometry.cylinderPitch * (index + 0.5)}
            showPlug={showPlugs}
            plugScale={plugScale}
            plug={plug}
            glow={glow}
            combustion={combustion}
          />
        ))}
        <Crankshaft geometry={geometry} />
      </group>
    </MatsContext.Provider>
  );
});
