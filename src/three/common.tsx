/** 3D bits shared by the module viewports. */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export interface CameraPreset {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

/** Plain studio reflections so metal looks like metal. Built locally, no HDR file to download. */
export function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      env.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);
  return null;
}

/**
 * Glides the camera to a preset whenever `goal` or `nonce` changes, and lets go
 * the moment the user starts dragging so OrbitControls takes over.
 */
export function CameraRig({ goal, nonce }: { goal: CameraPreset; nonce: number }) {
  const { camera, controls } = useThree();
  const animating = useRef(true);

  useEffect(() => {
    animating.current = true;
  }, [goal, nonce]);

  useEffect(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const stop = () => {
      animating.current = false;
    };
    c.addEventListener('start', stop);
    return () => c.removeEventListener('start', stop);
  }, [controls]);

  useFrame((_, dt) => {
    if (!animating.current) return;
    const c = controls as unknown as OrbitControlsImpl | null;
    const k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(goal.pos, k);
    if (c) {
      c.target.lerp(goal.target, k);
      c.update();
    } else camera.lookAt(goal.target);
    if (camera.position.distanceTo(goal.pos) < 0.0015) animating.current = false;
  });
  return null;
}
