import { memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CameraRig, StudioEnvironment } from '../../../three/common';
import type { CameraPreset } from '../../../three/common';
import { BuildClockContext, WheelSimContext, useBuildClock, useWheelSim } from '../sim/useWheelSim';
import type { WheelSim } from '../sim/wheelModel';
import type { BuildClock } from '../wheel/build';
import { WheelAssembly } from './WheelAssembly';
import type { AssemblyProps } from './WheelAssembly';

export type WheelView = 'front' | 'section' | 'iso' | 'patch';

export const WHEEL_VIEWS: Record<WheelView, CameraPreset & { label: string }> = {
  front: { label: 'Front', pos: new THREE.Vector3(1.75, 0.0, 0), target: new THREE.Vector3(0, -0.02, 0) },
  section: { label: 'Section A-A', pos: new THREE.Vector3(0.0, 0.02, -1.5), target: new THREE.Vector3(0.0, -0.02, 0) },
  iso: { label: 'Isometric', pos: new THREE.Vector3(1.25, 0.5, -0.95), target: new THREE.Vector3(0.0, -0.04, 0) },
  patch: { label: 'Contact patch', pos: new THREE.Vector3(0.95, -0.2, 0.55), target: new THREE.Vector3(0.04, -0.3, 0) },
};

/** The only place sim time and build time move forward. Runs before anything draws. */
function Drivers() {
  const sim = useWheelSim();
  const clock = useBuildClock();
  useFrame((_, delta) => {
    sim.advanceWall(delta);
    clock.advance(delta);
  }, -1);
  return null;
}

interface SceneProps extends AssemblyProps {
  sim: WheelSim;
  clock: BuildClock;
  view: WheelView;
  viewNonce: number;
}

export const WheelScene = memo(function WheelScene({ sim, clock, view, viewNonce, ...assembly }: SceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: WHEEL_VIEWS.iso.pos.toArray(), fov: 34, near: 0.01, far: 20 }}
      gl={{ antialias: true, localClippingEnabled: true } as THREE.WebGLRendererParameters}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      {/* React context doesn't cross into the R3F reconciler, so provide it again. */}
      <WheelSimContext.Provider value={sim}>
        <BuildClockContext.Provider value={clock}>
          <Drivers />
          <StudioEnvironment />
          <hemisphereLight args={['#bcd7ff', '#0b1020', 0.55]} />
          <directionalLight position={[1.6, 1.5, -0.6]} intensity={2.0} />
          <directionalLight position={[-1.2, 0.6, 1]} intensity={1.0} color="#7dd3fc" />
          <pointLight position={[0.7, -0.1, 0.6]} intensity={0.5} color="#38bdf8" />
          <WheelAssembly {...assembly} />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.3} maxDistance={3} />
          <CameraRig goal={WHEEL_VIEWS[view]} nonce={viewNonce} />
        </BuildClockContext.Provider>
      </WheelSimContext.Provider>
    </Canvas>
  );
});
