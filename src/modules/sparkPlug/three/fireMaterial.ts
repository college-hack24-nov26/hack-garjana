/**
 * Shader for the fire in one cylinder.
 *
 * It's drawn on a closed cylinder that runs from the piston crown up to the
 * head. The pattern is 3D noise, warped and swirled around the bore, sitting
 * inside a flame front that grows out from the plug gap. Ridged noise on top
 * gives the bright streaks.
 *
 * Both sides of the cylinder are drawn, so the front and back walls add up and
 * it reads as a glowing volume. The blending also darkens the grey bore behind
 * it a little, which keeps the orange from washing out.
 *
 * There's no clock in here. The uniforms are set from the EngineSim every
 * frame, so the fire stops when you pause and repeats after a reset.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uHeight;
  uniform float uRadius;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    // The mesh is a unit cylinder scaled to the chamber, so turn positions back into metres here.
    vLocal = vec3(position.x * uRadius, position.y * uHeight, position.z * uRadius);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uIntensity; // how bright the gas is, 0..1
  uniform float uFront;     // how far the flame has spread, 0..1
  uniform float uPhase;     // drives the swirl (crank degrees since spark / 90)
  uniform float uHeight;    // chamber height, m
  uniform float uRadius;    // chamber radius, m
  uniform float uSeed;      // changes every firing so each one looks different
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return s / 0.9375;
  }
  // Ridged noise: thin bright lines where the noise crosses its middle value. These become the flame streaks.
  float filaments(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += a * abs(vnoise(p) * 2.0 - 1.0);
      p = p * 2.11 + vec3(5.3, 1.9, 7.7);
      a *= 0.5;
    }
    return pow(1.0 - s / 0.875, 4.0);
  }

  vec3 fireRamp(float x) {
    vec3 c = mix(vec3(0.30, 0.02, 0.0), vec3(0.92, 0.17, 0.01), smoothstep(0.0, 0.3, x));
    c = mix(c, vec3(1.0, 0.42, 0.03), smoothstep(0.3, 0.55, x));
    c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(0.55, 0.8, x));
    return mix(c, vec3(1.0, 0.95, 0.78), smoothstep(0.82, 1.0, x));
  }

  void main() {
    vec3 p = vLocal / uRadius;      // scaled so the bore radius is 1
    float h = uHeight / uRadius;
    float depth = 0.5 * h - p.y;    // distance below the head
    float rad = length(p.xz);

    // Swirl around the bore. The twist grows with radius (spiral arms) and as the burn goes on.
    float ang = uPhase * 1.7 + depth * 0.7 + rad * 1.9;
    float c = cos(ang);
    float s = sin(ang);
    vec2 q = mat2(c, s, -s, c) * p.xz;
    vec3 seed = vec3(uSeed * 3.17, uSeed * 1.31, uSeed * 2.07);

    // Warped noise for the curling flames, plus the ridged streaks.
    float warp = fbm(vec3(q * 1.3, p.y * 1.3 - uPhase * 0.8) + seed);
    vec3 wq = vec3(q * 2.3 + warp * 2.1, p.y * 2.0 + uPhase * 0.5) + seed.zxy;
    float n = fbm(wq);
    float fil = filaments(wq * 1.35 + vec3(0.0, uPhase * 0.4, 0.0));

    // Flame front: a lumpy sphere growing out from the plug gap at the top centre.
    float d = length(vec3(p.x, depth, p.z)) / length(vec2(1.0, h));
    float front = uFront * 1.12;
    float wrinkled = d + (n - 0.5) * 0.32;
    float burnt = 1.0 - smoothstep(front - 0.16, front + 0.02, wrinkled);
    float sheet = exp(-pow((wrinkled - front) / 0.06, 2.0)) * (1.0 - smoothstep(0.8, 1.0, uFront));

    // Hottest just after the spark. As the gas cools the colour slides from yellow to orange to deep red.
    float temp = mix(0.5, 1.0, uIntensity);
    float heat = clamp((n * 1.3 - 0.2 + fil * 0.75 + sheet * 0.6) * temp, 0.0, 1.0);
    vec3 col = fireRamp(heat);

    // How much of the surface is lit, a bit stronger toward the edges.
    float rim = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
    float cover = burnt * (0.55 + 0.45 * smoothstep(0.1, 0.6, heat)) * (0.8 + 0.35 * rim * rim) + sheet * 0.7;
    // Fade all the way to zero with the glow so the fire doesn't pop out when it's hidden.
    float a = clamp(cover * mix(0.3, 1.0, uIntensity) * smoothstep(0.0, 0.15, uIntensity), 0.0, 1.0);
    float gain = 0.75 + 0.6 * heat;
    // Premultiplied output: rgb adds the fire's light, alpha dims what's behind it.
    gl_FragColor = vec4(col * a * gain, a * 0.55);
  }
`;

export function createFireMaterial(radius: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uFront: { value: 0 },
      uPhase: { value: 0 },
      uHeight: { value: 0.01 },
      uRadius: { value: radius },
      uSeed: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // Premultiplied blending: rgb gets added, alpha darkens whatever is behind the flame.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
export type FireMaterial = ReturnType<typeof createFireMaterial>;
