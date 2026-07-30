// Shared math + noise. READ-ONLY for feature agents.
import * as THREE from 'three';

export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;
export const rng = (a, b) => a + Math.random() * (b - a);
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, z) {
  return vnoise(x, z) * 0.6 + vnoise(x * 2.7 + 13, z * 2.7 + 7) * 0.28 + vnoise(x * 7.1 + 31, z * 7.1 + 17) * 0.12;
}

// Ridged multifractal — sharper crests than plain fbm, for cliff/spire features.
export function ridged(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * freq, z * freq) * 2 - 1);
    sum += n * n * amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum;
}

// Domain warp: feeds noise through itself for organic, non-grid-aligned shapes.
export function warp(x, z, strength = 1) {
  const wx = fbm(x * 0.5 + 5.2, z * 0.5 + 1.3);
  const wz = fbm(x * 0.5 + 9.7, z * 0.5 + 7.1);
  return { x: x + wx * strength, z: z + wz * strength };
}
