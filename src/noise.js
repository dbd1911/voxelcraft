// VoxelCraft — deterministic PRNG + value noise (own implementation, no external deps)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t) => t * t * (3 - 2 * t);

// Spatial hashes -> [0,1)
export function hash2(x, z, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x, y, z, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 2246822519) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in 2D, output [0,1)
export function valueNoise2D(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smooth(x - x0), fz = smooth(z - z0);
  const v00 = hash2(x0, z0, seed), v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed), v11 = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fz);
}

// Smooth value noise in 3D, output [0,1)
export function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const n = (dy) => lerp(
    lerp(hash3(x0, y0 + dy, z0, seed), hash3(x0 + 1, y0 + dy, z0, seed), fx),
    lerp(hash3(x0, y0 + dy, z0 + 1, seed), hash3(x0 + 1, y0 + dy, z0 + 1, seed), fx),
    fz);
  return lerp(n(0), n(1), fy);
}

// Fractal Brownian motion over value noise. Output roughly [0,1), centered ~0.5
export function fbm2D(x, z, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, z * freq, (seed + o * 1013) | 0);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

export function fbm3D(x, y, z, seed, octaves = 3, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq, (seed + o * 7919) | 0);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged noise: sharp mountain crests. Output [0,1)
export function ridged2D(x, z, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise2D(x * freq, z * freq, (seed + o * 5171) | 0);
    sum += amp * (1 - Math.abs(2 * n - 1));
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}