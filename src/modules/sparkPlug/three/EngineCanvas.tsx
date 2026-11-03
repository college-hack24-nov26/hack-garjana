import { memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CameraRig, StudioEnvironment } from '../../../three/common';
import type { CameraPreset } from '../../../three/common';
import type { EngineSim, PlugGeometry } from '../sim/engineSim';
import { EngineSimContext, useEngineSim } from '../sim/useEngineSim';
import { ENGINE_Y, EngineScene } from './EngineScene';

export type EngineView = 'cutaway' | 'front' | 'side' | 'tips';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const ENGINE_VIEWS: Record<EngineView, CameraPreset & { label: string }> = {
  cutaway: { label: 'Cutaway', pos: v(0.45, 0.36, 0.84), target: v(-0.03, 0.075, 0) },
  front: { label: 'Bank front', pos: v(0.02, 0.06, 1.0), target: v(0.06, 0.05, 0) },
  side: { label: 'Slider-crank side', pos: v(0.98, 0.1, 0.3), target: v(0, 0.04, 0) },
  tips: { label: 'Spark-plug tips', pos: v(0.05, 0.18, 0.27), target: v(0, 0.135, 0) },
};

/** The only place engine time moves forward. Runs first each frame, before anything draws. */
function EngineDriver() {
  const sim = useEngineSim();
  useFrame((_, delta) => sim.advanceWall(delta), -1);
  return null;
}

export const EngineCanvas = memo(function EngineCanvas({
  sim,
  view,
  viewNonce,
  showBlock,
  tipColours,
  plug,
  combustion,
}: {
  sim: EngineSim;
  view: EngineView;
  viewNonce: number;
  showBlock: boolean;
  tipColours: Record<'A' | 'B', string>;
  plug: PlugGeometry;
  combustion: boolean;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: ENGINE_VIEWS.cutaway.pos.toArray(), fov: 36, near: 0.005, far: 20 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
    >
      <EngineSimContext.Provider value={sim}>
        <EngineDriver />
        <StudioEnvironment />
        <ambientLight intensity={0.35} />
        <hemisphereLight args={['#3d6185', '#05080e', 0.55]} />
        <directionalLight position={[0.4, 0.8, 0.6]} intensity={1.7} color="#cfe3f5" />
        <directionalLight position={[-0.6, 0.2, -0.4]} intensity={0.6} color="#4a7fb5" />
        <EngineScene
          geometry={sim.geometry}
          tipColours={tipColours}
          plug={plug}
          showBlock={showBlock && view !== 'tips'}
          combustion={combustion}
        />
        <Grid
          position={[0, ENGINE_Y - 0.115, 0]}
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
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} minDistance={0.1} maxDistance={3} />
        <CameraRig goal={ENGINE_VIEWS[view]} nonce={viewNonce} />
      </EngineSimContext.Provider>
    </Canvas>
  );
});
