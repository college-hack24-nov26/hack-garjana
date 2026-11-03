import { memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { CameraRig, StudioEnvironment } from '../../../three/common';
import type { CameraPreset } from '../../../three/common';
import { BrakeSimContext, useBrakeSim } from '../sim/useBrakeSim';
import type { BrakeSim } from '../sim/brakeModel';
import { BrakeAssembly, CALIPER_DIR } from './BrakeAssembly';

export type CameraView = 'front' | 'side' | 'iso';

const caliperCentre = CALIPER_DIR.clone().multiplyScalar(0.15);
export const VIEWS: Record<CameraView, CameraPreset> = {
  front: { pos: new THREE.Vector3(1.6, 0.05, 0), target: new THREE.Vector3(0, 0, 0) },
  side: {
    pos: CALIPER_DIR.clone().multiplyScalar(0.72).add(new THREE.Vector3(0.001, 0, 0)),
    target: caliperCentre.clone(),
  },
  iso: {
    pos: new THREE.Vector3(1.0, 0.42, 0).add(CALIPER_DIR.clone().multiplyScalar(0.85)),
    target: CALIPER_DIR.clone().multiplyScalar(0.05),
  },
};

/** The only place sim time moves forward. Runs first each frame, before anything draws. */
function SimDriver() {
  const sim = useBrakeSim();
  useFrame((_, delta) => sim.advanceWall(delta), -1);
  return null;
}

export const BrakeScene = memo(function BrakeScene({
  sim,
  view,
  viewNonce,
  cutaway,
  showTyre,
}: {
  sim: BrakeSim;
  view: CameraView;
  viewNonce: number;
  cutaway: boolean;
  showTyre: boolean;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: VIEWS.iso.pos.toArray(), fov: 34, near: 0.01, far: 20 }}
      gl={{ antialias: true, localClippingEnabled: true } as THREE.WebGLRendererParameters}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      {/* R3F has its own reconciler, so React context doesn't reach inside the canvas. Pass the sim in again here. */}
      <BrakeSimContext.Provider value={sim}>
        <SimDriver />
        <StudioEnvironment />
        <hemisphereLight args={['#bcd7ff', '#0b1020', 0.55]} />
        <directionalLight
          position={[1.4, 1.6, 0.6]}
          intensity={2.1}
        />
        <directionalLight position={[-1.2, 0.4, -1]} intensity={1.1} color="#7dd3fc" />
        <pointLight position={[0.5, -0.4, 0.6]} intensity={0.6} color="#38bdf8" />
        <BrakeAssembly cutaway={cutaway} showTyre={showTyre} />
        <Grid
          position={[0, -0.345, 0]}
          args={[4, 4]}
          cellSize={0.05}
          cellThickness={0.6}
          cellColor="#1e3a5f"
          sectionSize={0.25}
          sectionThickness={1}
          sectionColor="#22577a"
          fadeDistance={2.2}
          fadeStrength={1.5}
          infiniteGrid
        />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.25} maxDistance={2.5} />
        <CameraRig goal={VIEWS[view]} nonce={viewNonce} />
      </BrakeSimContext.Provider>
    </Canvas>
  );
});
