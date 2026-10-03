// VoxelCraft — chunk mesher: block data -> THREE geometry with baked light + day factor shader.
// Optimized: per-column cached heightmap/light, direct chunk-array neighbor access.
import { CHUNK_X, CHUNK_Y, CHUNK_Z, B, BLOCKS } from './blocks.js';
import { buildAtlas, tileUV } from './textures.js';
import { clamp } from './noise.js';

const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.62, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.8, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.8, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const CROSS = [
  [[0.14, 0, 0.14], [0.86, 0, 0.86], [0.14, 1, 0.14], [0.86, 1, 0.86]],
  [[0.86, 0, 0.14], [0.14, 0, 0.86], [0.86, 1, 0.14], [0.14, 1, 0.86]],
];

const VS = `
attribute vec2 alight;
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;
void main() {
  vUv = uv; vShade = color.r; vLight = alight;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map;
uniform float dayFactor;
uniform float uOpacity;
uniform vec3 fogColor;
uniform float fogNear, fogFar;
uniform bool uCutout;
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vFogDepth;
void main() {
  vec4 tex = texture2D(map, vUv);
  if (uCutout && tex.a < 0.5) discard;
  float sky = vLight.x * dayFactor;
  float torch = vLight.y * 0.95;
  float l = max(sky * vShade, torch * vShade);
  l = 0.06 + 0.94 * l;
  vec3 col = tex.rgb * l;
  float f = smoothstep(fogNear, fogFar, vFogDepth);
  col = mix(col, fogColor, f);
  gl_FragColor = vec4(col, tex.a * uOpacity);
}`;

export const dayUniform = { value: 1.0 };
let materials = null;
export function getMaterials() {
  if (materials) return materials;
  const atlas = buildAtlas();
  const mk = (cutout, opacity) => new THREE.ShaderMaterial({
    uniforms: {
      map: { value: atlas.texture }, dayFactor: dayUniform, uOpacity: { value: opacity },
      fogColor: { value: new THREE.Color(0x9fbfff) }, fogNear: { value: 60 }, fogFar: { value: 140 }, uCutout: { value: cutout },
    },
    vertexShader: VS, fragmentShader: FS, transparent: opacity < 1, side: THREE.DoubleSide,
  });
  materials = { solid: mk(true, 1), water: mk(false, 0.72) };
  return materials;
}
export function setFog(color, near, far) {
  const m = getMaterials();
  m.solid.uniforms.fogColor.value.set(color); m.water.uniforms.fogColor.value.set(color);
  m.solid.uniforms.fogNear.value = near; m.water.uniforms.fogNear.value = near;
  m.solid.uniforms.fogFar.value = far; m.water.uniforms.fogFar.value = far;
}

// ---- per-block UV cache (built once atlas exists) ----
let uvCache = null;
function faceUV(id, dirY) {
  if (!uvCache) {
    uvCache = {};
    for (let i = 1; i < BLOCKS.length; i++) {
      const t = BLOCKS[i].tex;
      if (!t) { uvCache[i] = null; continue; }
      const side = t.all || t.side, top = t.all || t.top, bot = t.all || t.bottom || t.side;
      uvCache[i] = { top: tileUV(top), side: tileUV(side), bottom: tileUV(bot) };
    }
  }
  const u = uvCache[id];
  if (!u) return null;
  return dirY === 1 ? u.top : dirY === -1 ? u.bottom : u.side;
}

export class ChunkMesher {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.meshes = new Map();
    getMaterials();
  }

  disposeChunk(cx, cz) {
    const k = cx + ',' + cz, m = this.meshes.get(k);
    if (m) {
      if (m.solid) { this.scene.remove(m.solid); m.solid.geometry.dispose(); }
      if (m.water) { this.scene.remove(m.water); m.water.geometry.dispose(); }
      this.meshes.delete(k);
    }
  }

  build(cx, cz) {
    const w = this.world;
    const chunk = w.getChunk(cx, cz);
    // neighbors (also ensures border culling has data)
    const nXm = w.getChunk(cx - 1, cz), nXp = w.getChunk(cx + 1, cz);
    const nZm = w.getChunk(cx, cz - 1), nZp = w.getChunk(cx, cz + 1);
    const key = cx + ',' + cz;
    const pos = [], uv = [], light = [], shade = [], idxA = [];
    const wpos = [], wuv = [], wlight = [], wshade = [], widxA = [];
    const x0 = cx * CHUNK_X, z0 = cz * CHUNK_Z;
    const blocks = chunk.blocks;
    const CI = (x, y, z) => (y * CHUNK_Z + z) * CHUNK_X + x;

    // per-column caches
    const hm = new Int16Array(CHUNK_X * CHUNK_Z);
    const torchLookup = (x, y, z) => (w.torchLightAt ? w.torchLightAt(x, y, z) : 0);
    for (let lz = 0; lz < CHUNK_Z; lz++) for (let lx = 0; lx < CHUNK_X; lx++) hm[lz * CHUNK_X + lx] = w.heightAt(x0 + lx, z0 + lz);

    // neighbor-aware block + height access
    const getB = (lx, y, lz) => {
      if (y < 0) return B.BEDROCK;
      if (y >= CHUNK_Y) return B.AIR;
      if (lx >= 0 && lx < CHUNK_X && lz >= 0 && lz < CHUNK_Z) return blocks[CI(lx, y, lz)];
      if (lx < 0) return nXm.get(lx + CHUNK_X, y, lz >= 0 && lz < CHUNK_Z ? lz : lz - (lz < 0 ? -CHUNK_Z : CHUNK_Z) * 0);
      if (lx >= CHUNK_X) return nXp.get(lx - CHUNK_X, y, lz);
      if (lz < 0) return nZm.get(lx, y, lz + CHUNK_Z);
      return nZp.get(lx, y, lz - CHUNK_Z);
    };
    const getHM = (lx, lz) => {
      if (lx >= 0 && lx < CHUNK_X && lz >= 0 && lz < CHUNK_Z) return hm[lz * CHUNK_X + lx];
      return w.heightAt(x0 + lx, z0 + lz);
    };
    const skyAt = (lx, y, lz) => {
      const h = getHM(lx, lz);
      if (y >= h) { const underwater = (y < 23) ? Math.max(4, 15 - 2 * (23 - y)) : 15; return underwater / 15; }
      return Math.max(2, 15 - 3 * (h - y)) / 15;
    };

    const pushQuad = (P, U, L, S, Ia, verts, li, sh) => {
      const base = P.length / 3;
      for (let i = 0; i < 4; i++) { const v = verts[i]; P.push(v[0], v[1], v[2]); U.push(v[3], v[4]); }
      for (let i = 0; i < 4; i++) { L.push(li[0], li[1]); S.push(sh, sh, sh, sh); }
      Ia.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };

    for (let ly = 1; ly < CHUNK_Y; ly++) for (let lz = 0; lz < CHUNK_Z; lz++) for (let lx = 0; lx < CHUNK_X; lx++) {
      const id = blocks[CI(lx, ly, lz)];
      if (id === B.AIR) continue;
      const bl = BLOCKS[id];

      if (bl.cross) {
        const uvr = faceUV(id, 1);
        const sky = skyAt(lx, ly, lz);
        const torch = torchLookup(x0 + lx, ly, z0 + lz) / 15;
        for (const q of CROSS) {
          const verts = [
            [lx + q[0][0], ly + q[0][1], lz + q[0][2], uvr[0], uvr[3]],
            [lx + q[1][0], ly + q[1][1], lz + q[1][2], uvr[2], uvr[3]],
            [lx + q[2][0], ly + q[2][1], lz + q[2][2], uvr[0], uvr[1]],
            [lx + q[3][0], ly + q[3][1], lz + q[3][2], uvr[2], uvr[1]],
          ];
          pushQuad(pos, uv, light, shade, idxA, verts, [sky, torch], 1.0);
        }
        continue;
      }

      const isWater = id === B.WATER;
      for (const face of FACES) {
        const nx = lx + face.dir[0], ny = ly + face.dir[1], nz = lz + face.dir[2];
        const nid = getB(nx, ny, nz);
        const nbl = BLOCKS[nid];
        if (isWater) {
          if (nid === B.WATER) continue;
          if (nbl && nbl.opaque) continue;
        } else {
          if (nid === id && !bl.leaves && !bl.cross) continue;
          if (nbl && nbl.opaque && !bl.leaves) continue;
          if (nid === B.LEAVES && bl.leaves) continue;
        }
        const uvr = faceUV(id, face.dir[1]);
        const sky = ny < 0 ? 0 : skyAt(nx, ny, nz);
        const torch = ny < 0 ? 0 : torchLookup(x0 + nx, ny, z0 + nz) / 15;
        const yTop = isWater ? 0.875 : 1;
        const verts = face.corners.map(cn => [
          lx + cn[0],
          ly + (cn[1] === 1 ? yTop : 0),
          lz + cn[2],
          uvr[0] + (uvr[2] - uvr[0]) * cn[3],
          uvr[1] + (uvr[3] - uvr[1]) * cn[4],
        ]);
        const P = isWater ? wpos : pos, U = isWater ? wuv : uv, L = isWater ? wlight : light, S = isWater ? wshade : shade, Ia = isWater ? widxA : idxA;
        pushQuad(P, U, L, S, Ia, verts, [sky, torch], face.shade);
      }
    }

    const mkGeo = (P, U, L, S, Ia) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('alight', new THREE.Float32BufferAttribute(L, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(S, 3));
      g.setIndex(Ia);
      g.computeBoundingSphere();
      return g;
    };

    const old = this.meshes.get(key) || {};
    const out = { solid: null, water: null };
    if (pos.length) {
      const mesh = new THREE.Mesh(mkGeo(pos, uv, light, shade, idxA), materials.solid);
      mesh.position.set(x0, 0, z0);
      this.scene.add(mesh); out.solid = mesh;
    }
    if (wpos.length) {
      const mesh = new THREE.Mesh(mkGeo(wpos, wuv, wlight, wshade, widxA), materials.water);
      mesh.position.set(x0, 0, z0);
      this.scene.add(mesh); out.water = mesh;
    }
    if (old.solid) { this.scene.remove(old.solid); old.solid.geometry.dispose(); }
    if (old.water) { this.scene.remove(old.water); old.water.geometry.dispose(); }
    this.meshes.set(key, out);
    chunk.dirty = false; chunk.built = true;
    return out;
  }

  meshAt(x, z) {
    const k = Math.floor(x / CHUNK_X) + ',' + Math.floor(z / CHUNK_Z);
    return this.meshes.get(k);
  }
}