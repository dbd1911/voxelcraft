// VoxelCraft — world: seeded terrain generation, chunk store, block edits, save state.
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA, B } from './blocks.js';
import { mulberry32, hash2, hash3, fbm2D, fbm3D, ridged2D, clamp } from './noise.js';

const CI = (x, y, z) => (y * CHUNK_Z + z) * CHUNK_X + x; // index into block array

export function biomeAt(x, z, seed) {
  const temp = fbm2D(x * 0.0011, z * 0.0011, (seed ^ 911) | 0, 3);
  const humid = fbm2D(x * 0.0016 + 40, z * 0.0016 + 40, (seed ^ 313) | 0, 3);
  if (temp < 0.34) return 'snow';
  if (temp > 0.66 && humid < 0.42) return 'desert';
  if (humid > 0.56) return 'forest';
  return 'plains';
}

export function terrainHeight(x, z, seed) {
  const c = fbm2D(x * 0.0028, z * 0.0028, (seed ^ 1) | 0, 4);
  const m = ridged2D(x * 0.0045, z * 0.0045, (seed ^ 2) | 0, 4);
  const mm = clamp((m - 0.62) / 0.23, 0, 1);
  const h = 20 + c * 20 + mm * mm * (m > 0.62 ? (m - 0.62) * 260 : 0);
  return clamp(Math.floor(h), 3, CHUNK_Y - 8);
}

function isCave(x, y, z, seed, h) {
  if (y < 3 || y > h - 2) return false;
  const worm = fbm3D(x * 0.055, y * 0.1, z * 0.055, (seed ^ 31) | 0, 3);
  if (worm > 0.71) return true;
  if (y < 26) {
    const cheese = fbm3D(x * 0.045, y * 0.08, z * 0.045, (seed ^ 77) | 0, 3);
    if (cheese > 0.74) return true;
  }
  return false;
}

function oreAt(x, y, z, seed) {
  const r = hash3(x, y, z, (seed ^ 555) | 0);
  if (y <= 12 && r < 0.0016) return B.DIAMOND_ORE;
  if (y <= 14 && r >= 0.0016 && r < 0.0042) return B.GOLD_ORE;
  if (y <= 32 && r >= 0.0042 && r < 0.012) return B.IRON_ORE;
  if (y <= 48 && r >= 0.012 && r < 0.024) return B.COAL_ORE;
  return 0;
}

// deterministic tree test for a column (used with 3-block apron across chunk borders)
function treeAt(wx, wz, seed, biome, h) {
  if (h <= SEA) return 0;
  const r = hash2(wx, wz, (seed ^ 777) | 0);
  const dens = biome === 'forest' ? 0.045 : biome === 'plains' ? 0.007 : biome === 'snow' ? 0.012 : 0;
  if (biome === 'desert') {
    if (h <= SEA + 1) return 0;
    return r < 0.015 ? 10 + Math.floor(hash2(wx, wz, (seed ^ 778) | 0) * 3) : 0; // cactus height
  }
  if (r >= dens) return 0;
  const r2 = hash2(wx, wz, (seed ^ 779) | 0);
  return 4 + Math.floor(r2 * 3); // trunk height 4..6
}

function placeTree(setFn, wx, h, wz, trunk, biome, cx0, cx1, cz0, cz1) {
  const set = (x, y, z, id, soft) => {
    if (x < cx0 || x >= cx1 || z < cz0 || z >= cz1 || y < 0 || y >= CHUNK_Y) return;
    if (soft) setFn(x, y, z, id, true); // soft = don't overwrite solid
    else setFn(x, y, z, id);
  };
  if (biome === 'desert') {
    for (let i = 1; i <= trunk; i++) set(wx, h + i, wz, B.CACTUS);
    return;
  }
  const top = h + trunk;
  for (let y = h + 1; y <= top; y++) set(wx, y, wz, B.LOG);
  for (let dy = -2; dy <= 1; dy++) {
    const rad = dy <= -1 ? 2 : dy === 0 ? 2 : 1;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (dx === 0 && dz === 0 && dy <= 0) continue;
      if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash3(wx + dx, top + dy, wz + dz, 12345) < 0.5) continue;
      set(wx + dx, top + dy, wz + dz, B.LEAVES, true);
    }
  }
  set(wx, top + 2, wz, B.LEAVES, true);
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    this.hm = new Uint8Array(CHUNK_X * CHUNK_Z); // heightmap for skylight
    this.dirty = true; this.built = false;
  }
  get(x, y, z) { return this.blocks[CI(x, y, z)]; }
  set(x, y, z, id) { this.blocks[CI(x, y, z)] = id; }
  recomputeHM() {
    for (let x = 0; x < CHUNK_X; x++) for (let z = 0; z < CHUNK_Z; z++) {
      let top = 0;
      for (let y = CHUNK_Y - 1; y >= 0; y--) {
        const id = this.blocks[CI(x, y, z)];
        if (id !== 0 && id !== B.WATER && id !== B.TORCH && id !== B.FLOWER && id !== B.TALLGRASS) { top = y; break; }
      }
      this.hm[z * CHUNK_X + x] = top;
    }
  }
}

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.edits = new Map(); // "x,y,z" -> id (player edits journal, survives chunk unload)
    this.onEdit = null; // callback(x,y,z,id,prevId)
    this.torchCache = new Map(); // chunkKey -> [worldX,y,z*...]
  }
  key(cx, cz) { return cx + ',' + cz; }

  getChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) { c = this.generate(cx, cz); this.chunks.set(k, c); }
    return c;
  }
  peekChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    const seed = this.seed;
    const x0 = cx * CHUNK_X, z0 = cz * CHUNK_Z;
    for (let lx = 0; lx < CHUNK_X; lx++) for (let lz = 0; lz < CHUNK_Z; lz++) {
      const wx = x0 + lx, wz = z0 + lz;
      const biome = biomeAt(wx, wz, seed);
      const h = terrainHeight(wx, wz, seed);
      const beach = h >= SEA - 2 && h <= SEA + 1;
      for (let y = 0; y < CHUNK_Y; y++) {
        let id = B.AIR;
        if (y === 0 || (y === 1 && hash3(wx, y, wz, seed) < 0.5)) id = B.BEDROCK;
        else if (y <= h) {
          if (isCave(wx, y, wz, seed, h)) id = B.AIR;
          else if (y === h) {
            id = biome === 'desert' || beach ? B.SAND : biome === 'snow' ? B.SNOW : (h < SEA ? B.DIRT : B.GRASS);
            if (biome !== 'desert' && h < SEA - 1) id = B.DIRT;
          } else if (y >= h - 3) id = biome === 'desert' || beach ? B.SAND : B.DIRT;
          else id = B.STONE;
          if (id === B.STONE) { const ore = oreAt(wx, y, wz, seed); if (ore) id = ore; }
          if (y === h - 1 && h < SEA - 1) id = B.GRAVEL;
        }
        if (id === B.AIR && y > h && y <= SEA) id = B.WATER;
        c.blocks[CI(lx, y, lz)] = id;
      }
      // surface decorations
      const topId = c.get(lx, h, lz);
      if (h > SEA) {
        if (biome !== 'desert' && topId === B.GRASS) {
          const r = hash2(wx, wz, (seed ^ 4242) | 0);
          if (r < 0.02) c.set(lx, h + 1, lz, B.FLOWER);
          else if (r < 0.10) c.set(lx, h + 1, lz, B.TALLGRASS);
        }
      }
    }
    // trees/cacti with apron so canopies cross chunk borders
    const setLocal = (wx, y, wz, id, soft) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return;
      if (soft && c.get(lx, y, lz) !== B.AIR) return;
      c.set(lx, y, lz, id);
    };
    for (let wx = x0 - 3; wx < x0 + CHUNK_X + 3; wx++) {
      for (let wz = z0 - 3; wz < z0 + CHUNK_Z + 3; wz++) {
        const biome = biomeAt(wx, wz, seed);
        const h = terrainHeight(wx, wz, seed);
        const trunk = treeAt(wx, wz, seed, biome, h);
        if (trunk) {
          placeTree((x, y, z, id, soft) => setLocal(x, y, z, id, soft), wx, h, wz, trunk, biome, x0 - 3, x0 + CHUNK_X + 3, z0 - 3, z0 + CHUNK_Z + 3);
        }
      }
    }
    // apply player edits that fall inside this chunk
    for (const [k, id] of this.edits) {
      const [x, y, z] = k.split(',').map(Number);
      if (x >= x0 && x < x0 + CHUNK_X && z >= z0 && z < z0 + CHUNK_Z) {
        c.set(x - x0, y, z - z0, id);
      }
    }
    c.recomputeHM();
    return c;
  }

  // world-space block access
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return B.AIR;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.getChunk(cx, cz);
    return c.get(x - cx * CHUNK_X, y, z - cz * CHUNK_Z);
  }
  getBlockLoaded(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return B.AIR;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.peekChunk(cx, cz);
    return c ? c.get(x - cx * CHUNK_X, y, z - cz * CHUNK_Z) : -1; // -1 = not loaded
  }
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= CHUNK_Y) return false;
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.getChunk(cx, cz);
    const lx = x - cx * CHUNK_X, lz = z - cz * CHUNK_Z;
    const prev = c.get(lx, y, lz);
    if (prev === id) return true;
    c.set(lx, y, lz, id);
    if (!opts.fromGen) { this.edits.set(x + ',' + y + ',' + z, id); if (this.onEdit) this.onEdit(x, y, z, id, prev); }
    c.dirty = true;
    if (lx === 0) { const n = this.peekChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_X - 1) { const n = this.peekChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.peekChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_Z - 1) { const n = this.peekChunk(cx, cz + 1); if (n) n.dirty = true; }
    if (!opts.noGravity) this.applyGravityColumn(x, z);
    return true;
  }
  // sand/gravel fall: move blocks down the column where support vanished
  applyGravityColumn(x, z) {
    for (let y = CHUNK_Y - 2; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if ((id === B.SAND || id === B.GRAVEL)) {
        let ny = y;
        while (ny > 0) {
          const below = this.getBlock(x, ny - 1, z);
          if (below === B.AIR || below === B.WATER || below === B.FLOWER || below === B.TALLGRASS) ny--;
          else break;
        }
        if (ny !== y) {
          this.setBlock(x, y, z, B.AIR, { noGravity: true });
          this.setBlock(x, ny, z, id, { noGravity: true });
        }
      }
    }
  }
  heightAt(x, z) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.getChunk(cx, cz);
    return c.hm[(z - cz * CHUNK_Z) * CHUNK_X + (x - cx * CHUNK_X)];
  }
  // skylight 0..15 at a position (column model: above terrain = 15, dims with depth; water dims)
  skyLight(x, y, z) {
    const hm = this.heightAt(x, z);
    if (y >= hm) {
      let l = 15;
      if (y < SEA) l = Math.max(4, 15 - 2 * (SEA - y)); // underwater dimming
      return l;
    }
    return Math.max(2, 15 - 3 * (hm - y));
  }
  serializeEdits() {
    const o = {};
    for (const [k, v] of this.edits) o[k] = v;
    return o;
  }
  loadEdits(obj) {
    this.edits = new Map(Object.entries(obj || {}));
  }
}

export function makeWorld(seed) {
  const w = new World(seed);
  // pregenerate 3x3 chunks around spawn
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(cx, cz);
  return w;
}

export function findSpawn(w) {
  // prefer a grassy, above-sea column
  for (let r = 0; r < 400; r += 6) {
    for (let a = 0; a < 12; a++) {
      const ang = a / 12 * Math.PI * 2 + r * 0.37;
      const x = Math.floor(Math.cos(ang) * r), z = Math.floor(Math.sin(ang) * r);
      const h = w.heightAt(x, z);
      if (h <= SEA + 1) continue;
      if (biomeAt(x, z, w.seed) === 'desert') continue;
      const top = w.getBlock(x, h, z);
      if (top === B.GRASS || top === B.SNOW) return [x + 0.5, h + 2.2, z + 0.5];
    }
  }
  // fallback: any land
  for (let r = 0; r < 200; r += 4) {
    const x = Math.floor(Math.sin(r * 12.9898 + w.seed) * r), z = Math.floor(Math.cos(r * 7.233 + w.seed) * r);
    const h = w.heightAt(x, z);
    if (h > SEA) return [x + 0.5, h + 2.2, z + 0.5];
  }
  return [0.5, CHUNK_Y - 10, 0.5];
}