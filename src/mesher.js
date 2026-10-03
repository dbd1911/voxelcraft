// VoxelCraft — chunk mesher: block data -> THREE geometry with baked light + day factor shader.
import { CHUNK_X, CHUNK_Y, CHUNK_Z, B, BLOCKS } from './blocks.js';
import { buildAtlas, tileUV } from './textures.js';
import { clamp } from './noise.js';

const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]], texSide: true },
  { dir: [1, 0, 0], shade: 0.62, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]], texSide: true },
  { dir: [0, -1, 0], shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]], texSide: false },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]], texSide: false },
  { dir: [0, 0, -1], shade: 0.8, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]], texSide: true },
  { dir: [0, 0, 1], shade: 0.8, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]], texSide: true },
];
const CROSS = [ // X-shaped plant quads
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
uniform float dayFactor;   // 0..1 sky brightness
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
  float torch = vLight.y * (0.92 + 0.08 * sin(dayFactor * 40.0)); // subtle torch warmth variation
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
  const mk = (cutout, opacity) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: atlas.texture }, dayFactor: dayUniform, uOpacity: { value: opacity },
        fogColor: { value: new THREE.Color(0x9fbfff) }, fogNear: { value: 60 }, fogFar: { value: 140 }, uCutout: { value: cutout },
      },
      vertexShader: VS, fragmentShader: FS, transparent: opacity < 1, side: THREE.DoubleSide,
    });
    return m;
  };
  materials = { solid: mk(true, 1), water: mk(false, 0.72) };
  return materials;
}
export function setFog(color, near, far) {
  const m = getMaterials();
  m.solid.uniforms.fogColor.value.set(color); m.water.uniforms.fogColor.value.set(color);
  m.solid.uniforms.fogNear.value = near; m.water.uniforms.fogNear.value = near;
  m.solid.uniforms.fogFar.value = far; m.water.uniforms.fogFar.value = far;
}

function tileFor(blockId, face) {
  const t = BLOCKS[blockId].tex;
  if (!t) return null;
  if (t.all) return t.all;
  if (face.dir[1] === 1) return t.top;
  if (face.dir[1] === -1) return t.bottom || t.side;
  return t.side;
}

export class ChunkMesher {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.meshes = new Map(); // key -> {solid, water}
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
    const key = cx + ',' + cz;
    const pos = [], uv = [], light = [], shade = [], idxA = [];
    const wpos = [], wuv = [], wlight = [], wshade = [], widxA = [];
    const x0 = cx * CHUNK_X, z0 = cz * CHUNK_Z;

    const pushQuad = (P, U, L, S, Iarr, verts, uvr, li, sh) => {
      const base = P.length / 3;
      for (const v of verts) { P.push(v[0], v[1], v[2]); U.push(v[3], v[4]); }
      for (let i = 0; i < 4; i++) { L.push(li[0], li[1]); S.push(sh, sh, sh, sh); }
      Iarr.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };

    for (let ly = 0; ly < CHUNK_Y; ly++) for (let lz = 0; lz < CHUNK_Z; lz++) for (let lx = 0; lx < CHUNK_X; lx++) {
      const id = chunk.get(lx, ly, lz);
      if (id === B.AIR) continue;
      const bl = BLOCKS[id];
      const wx = x0 + lx, wz = z0 + lz;

      if (bl.cross) {
        const uvName = bl.tex.all;
        const uvr = tileUV(uvName);
        const sky = w.skyLight(wx, ly, wz) / 15;
        const torch = w.torchLightAt(wx, ly, wz) / 15;
        for (const q of CROSS) {
          const verts = [
            [lx + q[0][0], ly + q[0][1], lz + q[0][2], uvr[0], uvr[3]],
            [lx + q[1][0], ly + q[1][1], lz + q[1][2], uvr[2], uvr[3]],
            [lx + q[2][0], ly + q[2][1], lz + q[2][2], uvr[0], uvr[1]],
            [lx + q[3][0], ly + q[3][1], lz + q[3][2], uvr[2], uvr[1]],
          ];
          pushQuad(pos, uv, light, shade, idxA, verts, uvr, [sky, torch], 1.0);
        }
        continue;
      }

      const isWater = id === B.WATER;
      for (const face of FACES) {
        const nx = wx + face.dir[0], ny = ly + face.dir[1], nz = wz + face.dir[2];
        const nid = (ny < 0 || ny >= CHUNK_Y) ? (ny < 0 ? B.BEDROCK : B.AIR) : w.getBlock(nx, ny, nz);
        const nbl = BLOCKS[nid];
        if (isWater) {
          if (nid === B.WATER) continue;
          if (nbl && nbl.opaque) continue;
        } else {
          if (nid === id) continue;
          if (nbl && nbl.opaque && !BLOCKS[id].leaves) continue;
          if (nbl && nbl.opaque && BLOCKS[id].leaves && nid === B.LEAVES) continue;
        }
        const uvr = tileUV(tileFor(id, face));
        // light sampled at the neighbor cell the face looks into
        let sky, torch;
        if (ny < 0) { sky = 0; torch = 0; }
        else {
          sky = clamp(w.skyLight(nx, ny, nz), 0, 15) / 15;
          torch = w.torchLightAt(nx, ny, nz) / 15;
        }
        const yTop = (isWater && face.dir[1] === 1) ? 0.875 : (isWater ? 0.875 : 1);
        const verts = face.corners.map(cn => [
          lx + cn[0],
          ly + (cn[1] === 1 ? yTop : 0),
          lz + cn[2],
          uvr[0] + (uvr[2] - uvr[0]) * cn[3],
          uvr[1] + (uvr[3] - uvr[1]) * cn[4],
        ]);
        const P = isWater ? wpos : pos, U = isWater ? wuv : uv, L = isWater ? wlight : light, S = isWater ? wshade : shade, Ia = isWater ? widxA : idxA;
        pushQuad(P, U, L, S, Ia, verts, uvr, [sky, torch], face.shade);
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

  meshAt(x, z) { // mesh object containing world pos (for picking debug)
    const k = Math.floor(x / CHUNK_X) + ',' + Math.floor(z / CHUNK_Z);
    return this.meshes.get(k);
  }
}