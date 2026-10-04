// VoxelCraft — game engine: scene, chunk streaming, lighting, interaction, sim loop, agent API.
import THREE from './three.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA, DAY_LENGTH, B, I, BLOCKS, ITEMS, RECIPES, SMELT, FUEL, canCraft, countItem, miningInfo, itemType } from './blocks.js';
import { makeWorld, findSpawn, terrainHeight, biomeAt } from './world.js';
import { buildAtlas, crackTextures, blockTile } from './textures.js';
import { ChunkMesher, getMaterials, setFog, dayUniform } from './mesher.js';
import { Player, raycastBlock, EYE, moveEntity, isInWater } from './player.js';
import { Mob, ItemDrop, MOB_DEFS } from './entities.js';
import { burrow } from './shelter.js';
import { clamp } from './noise.js';

const VIEW_CHUNKS_DEFAULT = 5; // 11x11 blocks of chunks

export class Engine {
  constructor(canvas, hud, opts = {}) {
    this.canvas = canvas; this.hud = hud; this.on = opts;
    // world identity: ?seed= wins, else resume the saved world's seed, else a fresh one.
    // The seed must NOT live only in the URL — reloads/reconnects must keep the same world.
    this.seed = null;
    if (opts.seed !== undefined && opts.seed !== null && Number.isFinite(+opts.seed)) this.seed = (+opts.seed) | 0;
    if (this.seed === null) {
      try { const s = localStorage.getItem('hermes_seed_cache'); if (s && Number.isFinite(+s)) this.seed = (+s) | 0; } catch {}
    }
    if (this.seed === null) {
      try {
        const s = JSON.parse(localStorage.getItem('voxelcraft_save') || 'null');
        if (s && Number.isFinite(s.seed)) this.seed = s.seed | 0;
      } catch { }
    }
    if (this.seed === null) {
      this.seed = (Math.random() * 2 ** 31) | 0;
      // persist seed as soon as a world is created so any reload resumes the same world
      try { localStorage.setItem('hermes_seed_cache', String(this.seed)); } catch {}
    }
    this.world = makeWorld(this.seed);
    // mesher samples engine-computed torch light through the world handle
    this.world.torchLightAt = (x, y, z) => this.torchLightAt(x, y, z);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
    getMaterials();
    this.mesher = new ChunkMesher(this.world, this.scene);
    this.player = new Player(0, 40, 0);
    this.player.gameMode = opts.gameMode || 'survival';
    const sp = findSpawn(this.world);
    this.player.x = sp[0]; this.player.y = sp[1]; this.player.z = sp[2];
    this.time = DAY_LENGTH * 0.30; // morning
    this.paused = false; this.viewChunks = opts.viewChunks ?? VIEW_CHUNKS_DEFAULT;
    this.torchMap = new Map(); // "x,y,z" -> true
    this.furnaces = new Map(); // "x,y,z" -> {in: {id,count}|null, fuel: n, out: {id,count}|null, prog: 0, burn: 0}
    this.mobs = []; this.drops = []; this.arrows = [];
    this.buildQueue = []; this.genBudgetMs = 6;
    this.toastT = 0; this.chat = []; this.eventLog = [];
    this.agentLock = 0; this.agentAction = null;
    this.breakingState = { tx: null, ty: null, tz: null, prog: 0, needed: 0 };
    this.hook = { action: null, log: [] };
    this._selTarget = null;
    this._initScene();
    this._resume();
    this._logEvent('world', 'New world generated (seed ' + this.seed + ')');
  }

  _initScene() {
    buildAtlas();
    this.scene.background = new THREE.Color(0x9fbfff);
    // crack overlay
    this.crackMats = crackTextures().map(t => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMats[0]);
    this.crackMesh.visible = false; this.scene.add(this.crackMesh);
    // highlight
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.highlight = edges; edges.visible = false; this.scene.add(edges);
    // drops (instanced colored cubes)
    this.dropGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.dropColorCache = {};
    // sun & moon billboards
    const sunMat = new THREE.SpriteMaterial({ color: 0xFFF6A3, fog: false });
    this.sun = new THREE.Sprite(sunMat); this.sun.scale.set(30, 30, 1); this.scene.add(this.sun);
    const moonMat = new THREE.SpriteMaterial({ color: 0xDDDDEE, fog: false });
    this.moon = new THREE.Sprite(moonMat); this.moon.scale.set(20, 20, 1); this.scene.add(this.moon);
  }

  // ---------- persistence ----------
  _save() {
    const furs = {};
    for (const [k, f] of this.furnaces) furs[k] = f;
    const s = {
      v: 1, seed: this.seed, time: this.time, edits: this.world.serializeEdits(),
      player: { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch, hp: this.player.hp, food: this.player.food, inv: this.player.inv, sel: this.player.sel, gameMode: this.player.gameMode },
      furnaces: furs, torches: [...this.torchMap.keys()], gameMode: this.player.gameMode,
    };
    try { localStorage.setItem('voxelcraft_save', JSON.stringify(s)); } catch (e) { }
  }
  _resume() {
    try {
      const raw = localStorage.getItem('voxelcraft_save');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.seed !== this.seed) return;
      this.world.loadEdits(s.edits);
      this.time = s.time ?? this.time;
      for (const [k, f] of Object.entries(s.furnaces || {})) this.furnaces.set(k, f);
      for (const k of s.torches || []) this.torchMap.set(k, true);
      const p = s.player;
      if (p) {
        this.player.x = p.x; this.player.y = p.y; this.player.z = p.z; this.player.yaw = p.yaw; this.player.pitch = p.pitch;
        this.player.hp = p.hp; this.player.food = p.food; this.player.inv = p.inv; this.player.sel = p.sel || 0;
        this.player.gameMode = p.gameMode || 'survival';
        // guard: saves can land mid-death (hp 0 without dead flag) — resurrect safely instead of a 0-hp zombie state
        if (this.player.hp <= 0) { this.player.hp = 20; this.player.food = 20; this._logEvent('revive', 'restored from save with 0 hp — revived at full health'); }
      }
      this._logEvent('world', 'Loaded saved world (seed ' + this.seed + ')');
    } catch (e) { }
  }
  static resetSave() { localStorage.removeItem('voxelcraft_save'); location.reload(); }
  saveNow() { this._save(); this.toast('World saved'); }

  toggleGameMode() {
    this.player.gameMode = this.player.gameMode === 'survival' ? 'creative' : 'survival';
    if (this.player.gameMode === 'survival') this.player.flying = false;
    this.toast('Game mode: ' + this.player.gameMode.toUpperCase());
    this._logEvent('mode', this.player.gameMode);
  }
  give(id, count) { this.player.addItem(id, count); }

  // ---------- toasts / log ----------
  toast(msg, kind) {
    this.hud.toast(msg, kind);
  }
  _logEvent(kind, text) {
    const e = { t: this.time | 0, kind, text, stamp: performance.now() | 0 };
    this.eventLog.push(e);
    if (this.eventLog.length > 400) this.eventLog.shift();
    if (this.on.onEvent) this.on.onEvent(e);
  }

  // ---------- lighting ----------
  _scanTorches(cx, cz) {
    const c = this.world.getChunk(cx, cz);
    const x0 = cx * CHUNK_X, z0 = cz * CHUNK_Z;
    for (let lx = 0; lx < CHUNK_X; lx++) for (let lz = 0; lz < CHUNK_Z; lz++) for (let y = 0; y < CHUNK_Y; y++) {
      if (c.get(lx, y, lz) === B.TORCH) this.torchMap.set((x0 + lx) + ',' + y + ',' + (z0 + lz), true);
    }
  }
  _scanAllTorches() {
    for (const k of this.world.chunks.keys()) { const [cx, cz] = k.split(',').map(Number); this._scanTorches(cx, cz); }
  }
  torchLightAt(x, y, z) {
    const s = this._lightCache;
    if (!s || s.size === 0) return 0;
    return s.get(Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z)) || 0;
  }

  // BFS torch light. torchPower: list of [x,y,z,level]
  computeTorchLight(list) {
    const R = 15;
    const store = new Map();
    const get = (x, y, z) => store.get(x + ',' + y + ',' + z) || 0;
    const set = (x, y, z, v) => store.set(x + ',' + y + ',' + z, v);
    let q = [];
    for (const [x, y, z] of list) { set(x, y, z, R); q.push([x, y, z, R]); }
    while (q.length) {
      const nq = [];
      for (const [x, y, z, v] of q) {
        if (v <= 1) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (ny < 0 || ny >= CHUNK_Y) continue;
          const id = this.world.getBlock(nx, ny, nz);
          const bl = BLOCKS[id];
          if (bl && bl.opaque) continue;
          const nv = v - 1;
          if (get(nx, ny, nz) < nv) { set(nx, ny, nz, nv); nq.push([nx, ny, nz, nv]); }
        }
      }
      q = nq;
    }
    this.lightGrid = {
      sample: (x, y, z) => get(Math.floor(x), Math.floor(y), Math.floor(z)),
    };
    this._lightCache = store;
    return store;
  }

  daylight() { // 1.0 full day, 0.0 full night, smooth transitions
    const t = (this.time % DAY_LENGTH) / DAY_LENGTH;
    // 0=sunrise,0.25=noon,0.5=sunset,0.75=midnight
    if (t < 0.22 || t > 0.78) return 0.06;
    if (t < 0.30) return (t - 0.22) / 0.08 * 0.94 + 0.06;
    if (t > 0.70) return 0.06 + (0.78 - t) / 0.08 * 0.94;
    return 1.0;
  }

  // ---------- chunk streaming ----------
  updateChunks(px, pz) {
    const t0 = performance.now();
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    const V = this.viewChunks;
    // queue missing / dirty (nearest first)
    const wanted = [];
    for (let dx = -V; dx <= V; dx++) for (let dz = -V; dz <= V; dz++) {
      const cx = pcx + dx, cz = pcz + dz;
      const k = cx + ',' + cz;
      const have = this.world.peekChunk(cx, cz);
      const built = this.mesher.meshes.get(k);
      if (!have || have.dirty || !built) wanted.push([dx * dx + dz * dz, cx, cz]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    let builtCount = 0;
    for (const [, cx, cz] of wanted) {
      if (builtCount >= 2 || performance.now() - t0 > this.genBudgetMs) break;
      if (!this.world.peekChunk(cx, cz) || !this._torchesScanned(cx, cz)) this._scanTorches(cx, cz);
      this.mesher.build(cx, cz);
      builtCount++;
    }
    // unload far chunks
    for (const [k, m] of this.mesher.meshes) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.abs(cx - pcx) > V + 2 || Math.abs(cz - pcz) > V + 2) {
        this.mesher.disposeChunk(cx, cz);
        this.world.chunks.delete(k);
      }
    }
  }
  _torchesScanned(cx, cz) { return this._scanned && this._scanned.has(cx + ',' + cz) || false; }

  // ---------- main frame ----------
  frame(dt, input) {
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
    this.time = (this.time + dt) % DAY_LENGTH;

    const P = this.player;
    // ONE tick owner per frame: when the agent hook drives, it owns player+interaction
    // (executed at frame end). Otherwise the human input path runs — never both.
    const agentDrives = !!(this.hook && this.hook.action);
    if (agentDrives) {
      if (P.dead && this.hook.autoRespawn !== false) {
        P.respawnTimer -= dt;
        if (P.respawnTimer <= 0) this.respawnPlayer();
      }
    } else if (!P.dead) {
      if (!input.agentLocked) {
        P.yaw += input.lookDX * 0.0023; P.pitch += input.lookDY * 0.0023;
        P.pitch = clamp(P.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      }
      P.tick(dt, this.world, input, this);
      // interaction (only human path here; agent uses its own API calls)
      if (!input.agentLocked) this._humanInteract(dt, input);
      // UI edges
      if (input.hotbarNext > 0) { P.sel = (P.sel + input.hotbarNext) % 9; }
      if (input.hotbarPrev > 0) { P.sel = (P.sel - input.hotbarPrev + 9) % 9; }
      if (input.hotbarSel >= 0) P.sel = input.hotbarSel;
    }

    // mobs
    for (const m of this.mobs) m.tick(dt, this.world, this);
    this.mobs = this.mobs.filter(m => !m.gone);
    // drops
    for (const d of this.drops) d.tick(dt, this.world, this);
    this.drops = this.drops.filter(d => !d.gone);
    // arrows
    this._tickArrows(dt);
    // furnaces
    this._tickFurnaces(dt);
    // water flow (gentle infinite water)
    this._tickWater(dt);
    // spawning
    this._tickSpawning(dt);

    // chunks + lighting
    this.updateChunks(P.x, P.z);
    const nearTorches = [];
    for (const k of this.torchMap.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      if (Math.abs(x - P.x) < 48 && Math.abs(z - P.z) < 48) nearTorches.push([x, y, z]);
    }
    const tk = nearTorches.map(t => t.join(',')).join('|');
    if (tk !== this._lastTorchKey) { this._lastTorchKey = tk; this.computeTorchLight(nearTorches); this._remeshAll(); }
    dayUniform.value = this.daylight();

    // sky/fog
    const dl = this.daylight();
    const dayC = new THREE.Color(0x9fbfff), nightC = new THREE.Color(0x050b1a);
    const sky = nightC.clone().lerp(dayC, Math.min(1, dl * 1.6));
    this.scene.background = sky;
    const m = getMaterials();
    const far = (this.viewChunks * CHUNK_X) * 0.95;
    setFog(sky, far * 0.55, far * 0.95);
    m.solid.uniforms.fogColor.value.copy(sky); m.water.uniforms.fogColor.value.copy(sky);
    // sun/moon position
    const t = (this.time % DAY_LENGTH) / DAY_LENGTH;
    const ang = t * Math.PI * 2 - Math.PI / 2;
    const cx = P.x, cy = P.y + 8, cz = P.z;
    this.sun.position.set(cx + Math.cos(ang) * 300, cy + Math.sin(ang) * 300, cz);
    this.moon.position.set(cx - Math.cos(ang) * 300, cy - Math.sin(ang) * 300, cz);

    // camera
    this.camera.position.set(P.x, P.eyeY, P.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(P.yaw); this.camera.rotateX(P.pitch);
    if (this.player.gameMode === 'survival' && this.player.headInWater) { /* underwater tint via fog below */ }

    // target highlight + cracks
    this._updateTarget();

    this.dropSprites(dt);

    this.renderer.render(this.scene, this.camera);
    this._saveT += (this._saveT || 0) + dt; if (this._saveT > 12) { this._saveT = 0; if (!this.player.dead) this._save(); }
    if (this.hook.action) { try { this.hook.action(dt); } catch (e) { this.toast('Agent error: ' + e.message, 'warn'); this.hook.action = null; } }
  }

  dropSprites(dt) { /* item drop meshes are managed in renderDrops below */ }

  _humanInteract(dt, input) {
    const P = this.player;
    if (input.breaking) this.mineFromLook(dt);
    else this.breakingState.tx = null;
    if (input.useEdge) {
      const hit = this.raycastFromCamera();
      if (hit) this.useOn(hit);
    }
  }

  raycastFromCamera() {
    const P = this.player;
    const lv = P.lookVec();
    return raycastBlock(this.world, P.x, P.eyeY, P.z, lv.x, lv.y, lv.z, 5.5);
  }

  _updateTarget() {
    const hit = this.raycastFromCamera();
    this._selTarget = hit;
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else this.highlight.visible = false;
    const bs = this.breakingState;
    if (bs.tx !== null) {
      this.crackMesh.visible = true;
      this.crackMesh.position.set(bs.tx + 0.5, bs.ty + 0.5, bs.tz + 0.5);
      const stg = Math.min(9, Math.floor(bs.prog / Math.max(0.01, bs.needed) * 10));
      this.crackMesh.material = this.crackMats[stg];
    } else this.crackMesh.visible = false;
  }

  mineFromLook(dt) {
    const hit = this._selTarget || this.raycastFromCamera();
    if (!hit) { this.breakingState.tx = null; return false; }
    return this.mineBlock(hit.x, hit.y, hit.z, dt, true);
  }

  // shared by human + agent: returns progress done
  mineBlock(x, y, z, dt, human) {
    const st = this.breakingState;
    if (st.tx !== x || st.ty !== y || st.tz !== z) { st.tx = x; st.ty = y; st.tz = z; st.prog = 0; }
    const held = this.player.held();
    const info = miningInfo(this.world.getBlock(x, y, z), held ? held.id : 0);
    if (!info.ok) { st.prog = 0; return false; }
    st.needed = info.time;
    st.prog += dt;
    if (st.prog >= st.needed) {
      const id = this.world.getBlock(x, y, z);
      // furnace/table keep their state on break? drop contents
      if (id === B.FURNACE) {
        const f = this.furnaces.get(x + ',' + y + ',' + z);
        if (f) {
          if (f.in) this.spawnDrop(f.in.id, f.in.count, x + 0.5, y + 0.5, z + 0.5);
          if (f.out) this.spawnDrop(f.out.id, f.out.count, x + 0.5, y + 0.5, z + 0.5);
          this.furnaces.delete(x + ',' + y + ',' + z);
        }
      }
      this.world.setBlock(x, y, z, B.AIR);
      if (id === B.TORCH) this.torchMap.delete(x + ',' + y + ',' + z);
      st.tx = null; st.prog = 0;
      this._remeshAround(x, z);
      if (info.canDrop) {
        const bl = BLOCKS[id];
        const heldItem = held && itemType(held.id);
        for (const [dropId, minC, maxC] of (bl.drops || [[id, 1, 1]])) {
          if (dropId === null) continue;
          const chance = minC < 1 ? minC : 1;
          if (minC < 1 && Math.random() > chance) continue;
          const n = minC < 1 ? maxC : minC + Math.floor(Math.random() * (maxC - minC + 1));
          const finalId = this._playerSilkTouch(id);
          this.spawnDrop(finalId ?? dropId, n, x + 0.5, y + 0.5, z + 0.5);
        }
      }
      // support break (plants on top)
      const above = this.world.getBlock(x, y + 1, z);
      if (BLOCKS[above] && BLOCKS[above].needsSoil) { this.world.setBlock(x, y + 1, z, B.AIR); this._remeshAround(x, z); }
      // gravity chain above
      const aboveId = this.world.getBlock(x, y + 1, z);
      if (aboveId === B.SAND || aboveId === B.GRAVEL) { this.world.applyGravityColumn(x, z); this._remeshAround(x, z); }
      this._logEvent('mine', BLOCKS[id].name);
      return true;
    }
    return false;
  }
  _playerSilkTouch(id) { return id === B.STONE ? B.COBBLE : (id === B.IRON_ORE ? B.IRON_ORE : id === B.GOLD_ORE ? B.GOLD_ORE : null); }

  useOn(hit) {
    const id = hit.id;
    const P = this.player;
    if (id === B.TABLE) { this.on.onCraftMenu && this.on.onCraftMenu(true); return; }
    if (id === B.FURNACE) { this.on.onFurnaceMenu && this.on.onFurnaceMenu(hit); return; }
    // eat / place
    const held = P.held();
    if (!held) return;
    const it = itemType(held.id);
    if (it && it.food && P.food < 20) { P.eatTimer = 1.2; return; }
    // placement: right-click place from hit.face
    if (held.id < 100 && BLOCKS[held.id]) {
      const px = hit.x + hit.face[0], py = hit.y + hit.face[1], pz = hit.z + hit.face[2];
      if (py < 0 || py >= CHUNK_Y) return;
      const cur = this.world.getBlock(px, py, pz);
      if (cur !== B.AIR && cur !== B.WATER && !BLOCKS[cur].cross) return;
      const bl = BLOCKS[held.id];
      // can't place inside player
      if (bl.solid && !bl.cross) {
        const bx = Math.abs(P.x - (px + 0.5)) < 0.5 + P.width / 2, bz = Math.abs(P.z - (pz + 0.5)) < 0.5 + P.width / 2;
        const by = py >= Math.floor(P.y) - 1 && py <= Math.floor(P.y + P.height);
        if (bx && bz && by) return;
      }
      if (bl.placeOnSolid) { const below = this.world.getBlock(px, py - 1, pz); if (!(BLOCKS[below] && BLOCKS[below].solid)) return; }
      if (bl.needsSoil) { const below = this.world.getBlock(px, py - 1, pz); if (below !== B.GRASS && below !== B.DIRT) return; }
      this.world.setBlock(px, py, pz, held.id);
      if (held.id === B.TORCH) { this.torchMap.set(px + ',' + py + ',' + pz, true); this._remeshAround(px, pz); }
      else this._remeshAround(px, pz);
      P.consumeHeld(1);
    }
  }

  interactBlock(kind) { // agent: right-click the targeted block
    const hit = this._selTarget || this.raycastFromCamera();
    if (hit) this.useOn(hit);
    return hit ? BLOCKS[hit.id].name : null;
  }

  _remeshAround(x, z) {
    const cx = Math.floor(x / CHUNK_X), cz = Math.floor(z / CHUNK_Z);
    const c = this.world.peekChunk(cx, cz); if (c) c.dirty = true;
    // neighbors handled by setBlock dirty flags; rebuild nearest dirty chunks this frame
    const t0 = performance.now();
    for (const [k, have] of this.mesher.meshes) {
      const [mx, mz] = k.split(',').map(Number);
      const ch = this.world.peekChunk(mx, mz);
      if (ch && ch.dirty) { this.mesher.build(mx, mz); if (performance.now() - t0 > 8) break; }
      if (Math.abs(mx) === 1e9) break;
    }
  }
  _remeshAll() {
    for (const [k] of this.mesher.meshes) { const [cx, cz] = k.split(',').map(Number); const c = this.world.peekChunk(cx, cz); if (c) c.dirty = true; }
    const t0 = performance.now();
    for (const [k] of this.mesher.meshes) {
      const [cx, cz] = k.split(',').map(Number);
      const ch = this.world.peekChunk(cx, cz);
      if (ch && ch.dirty && performance.now() - t0 < 10) this.mesher.build(cx, cz);
    }
  }

  spawnDrop(id, n, x, y, z) {
    const d = new ItemDrop(id, n, x, y, z);
    this.drops.push(d);
    this._ensureDropMesh(d);
  }
  _ensureDropMesh(d) {
    if (d.mesh) return;
    let col = this.dropColorCache[d.item.id];
    if (col === undefined) {
      const tileName = d.item.id < 100 ? blockTile(d.item.id) : null;
      if (tileName) {
        const atlas = buildAtlas();
        const i = atlas.idx[tileName], s = 16;
        const gx = (i % 16) * s, gy = Math.floor(i / 16) * s;
        const ctx = atlas.canvas.getContext('2d');
        const data = ctx.getImageData(gx, gy, s, s).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let p = 0; p < data.length; p += 4) { if (data[p + 3] > 128) { r += data[p]; g += data[p + 1]; b += data[p + 2]; n++; } }
        col = n ? (Math.round(r / n) << 16 | Math.round(g / n) << 8 | Math.round(b / n)) : 0x888888;
      } else col = this._itemColor(d.item.id);
      this.dropColorCache[d.item.id] = col;
    }
    const mesh = new THREE.Mesh(this.dropGeo, new THREE.MeshLambertMaterial({ color: col }));
    this.scene.add(mesh); d.mesh = mesh;
  }
  _itemColor(id) {
    const c = { 100: 0x8A6F47, 117: 0xF4A69B, 118: 0xB4713F, 119: 0xC0392B, 120: 0x8B4A2B, 121: 0xD43B3B, 122: 0x2B2B2B, 123: 0xD8D8D8, 124: 0xFCEE4B, 125: 0x4AEDD9 };
    if (id >= 101 && id <= 104) return 0x7A5C30; if (id >= 105 && id <= 108) return 0x7A5C30; if (id >= 109 && id <= 112) return 0x7A5C30;
    if (id >= 113 && id <= 116) return 0x9C7A45;
    return c[id] || 0xBBBBBB;
  }

  _tickArrows(dt) {
    for (const a of this.arrows) {
      a.life -= dt;
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
      a.vel.y -= 18 * dt; a.pos.y += a.vel.y * dt;
      if (a.mesh) { a.mesh.position.set(a.pos.x, a.pos.y, a.pos.z); a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z); }
      const P = this.player;
      const d = Math.hypot(P.x - a.pos.x, P.y + 1 - a.pos.y, P.z - a.pos.z);
      if (!P.dead && d < 1.0) { P.damage(4, 'was shot by a skeleton', this); a.life = 0; }
      const hitB = BLOCKS[this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z))];
      if (hitB && hitB.solid) { a.vel.x = 0; a.vel.y = 0; a.vel.z = 0; a.stuck = true; }
      if (a.stuck) { /* stays */ }
    }
    this.arrows = this.arrows.filter(a => a.life > 0 && !(a.stuck && a.life < 8));
  }
  spawnArrow(x, y, z, tx, ty, tz) {
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const sp = 18;
    const vel = { x: dx / d * sp, y: dy / d * sp + d * 0.35, z: dz / d * sp }; // lob
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), new THREE.MeshBasicMaterial({ color: 0x9C7A45 }));
    this.scene.add(mesh);
    this.arrows.push({ pos: { x, y, z }, vel, mesh, life: 15, stuck: false });
  }

  _tickFurnaces(dt) {
    for (const [k, f] of this.furnaces) {
      if (f.burn > 0) f.burn -= dt;
      if (f.in && f.burn <= 0 && f.fuel <= 0) {
        // try to pull fuel from out->fuel only via UI; here no auto fuel
      }
      if (f.in && f.burn > 0 && SMELT[f.in.id]) {
        f.prog += dt;
        if (f.prog >= 10) {
          f.prog = 0;
          const outId = SMELT[f.in.id];
          f.in.count--; if (f.in.count <= 0) f.in = null;
          f.out = f.out ? { id: outId, count: f.out.count + 1 } : { id: outId, count: 1 };
        }
      } else if (!f.in) f.prog = 0;
    }
  }
  furnaceStateAt(x, y, z) {
    const k = x + ',' + y + ',' + z;
    if (!this.furnaces.has(k)) this.furnaces.set(k, { in: null, fuel: 0, burn: 0, out: null, prog: 0 });
    return this.furnaces.get(k);
  }
  addFurnaceFuel(x, y, z, itemId, n) {
    const f = this.furnaceStateAt(x, y, z);
    const pv = FUEL[itemId]; if (!pv) return false;
    // consume from player inventory
    const need = n;
    const haveI = countItem(this.player.inv, itemId);
    const use = Math.min(haveI, need);
    if (use <= 0) return false;
    let left = use;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.player.inv[i];
      if (s && s.id === itemId) { const t = Math.min(left, s.count); s.count -= t; left -= t; if (s.count <= 0) this.player.inv[i] = null; }
    }
    f.fuel += use * pv;
    return true;
  }
  smeltStart(x, y, z, itemId, n) {
    const f = this.furnaceStateAt(x, y, z);
    if (!SMELT[itemId]) return 'cannot smelt that';
    if (f.in && f.in.id !== itemId) return 'furnace busy with another item';
    const have = countItem(this.player.inv, itemId);
    const use = Math.min(have, n ?? 1);
    if (use <= 0) return 'you have none';
    let left = use;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.player.inv[i];
      if (s && s.id === itemId) { const t = Math.min(left, s.count); s.count -= t; left -= t; if (s.count <= 0) this.player.inv[i] = null; }
    }
    f.in = { id: itemId, count: (f.in ? f.in.count : 0) + use };
    if (f.fuel <= 0) {
      const coal = countItem(this.player.inv, I.COAL);
      if (coal > 0) this.addFurnaceFuel(x, y, z, I.COAL, 1);
      else {
        const planks = countItem(this.player.inv, B.PLANKS);
        if (planks >= 2) this.addFurnaceFuel(x, y, z, B.PLANKS, 2);
        else this.toast('No fuel! Need coal or planks.', 'warn');
      }
    }
    this._logEvent('smelt', 'start ' + ITEMS[itemId].name);
    return 'ok';
  }
  furnaceCollect(x, y, z) {
    const f = this.furnaceStateAt(x, y, z);
    let got = [];
    if (f.out) { const left = this.player.addItem(f.out.id, f.out.count); if (left === 0) got.push(ITEMS[f.out.id].name + ' x' + f.out.count); f.out = null; }
    return got.join(', ') || 'nothing to collect';
  }

  _tickWater(dt) { this._wt = (this._wt || 0) + dt; if (this._wt < 0.25) return; this._wt = 0; }

  // ----- render sync for drops/mobs (meshes) -----
  renderEntities() {
    for (const d of this.drops) {
      if (!d.mesh) this._ensureDropMesh(d);
      if (d.mesh) { d.mesh.position.set(d.x, d.y + 0.15 + Math.sin(this.time * 2 + d.x) * 0.04, d.z); d.mesh.rotation.y = (this.time * 1.5) % (Math.PI * 2); }
    }
    for (const a of this.arrows) if (a.mesh) { /* updated in tick */ }
  }

  // ---------------- agent API (GameAPI defined below) ----------------
  api() { return new GameAPI(this); }

  // respawn & death — GAME MECHANIC (not the AI's job): spawn into a genuinely safe spot,
  // at least SAFE_RADIUS blocks from every hostile, never the same place twice in a row.
  respawnPlayer() {
    const P = this.player;
    const SAFE_RADIUS = 32;
    const base = findSpawn(this.world);
    let best = null, bestDanger = -1;
    // expanding rings: 40 → 200 blocks out; also consider the base spawn itself
    const rings = [40, 60, 80, 100, 130, 160, 200];
    const cands = [base];
    for (const r of rings) for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2 + r * 0.113;
      const wx = base[0] + Math.cos(ang) * r, wz = base[2] + Math.sin(ang) * r;
      const h = this.world.heightAt(Math.floor(wx), Math.floor(wz));
      if (h <= SEA) continue;
      cands.push([wx, h + 2.2, wz]);
    }
    for (const c of cands) {
      // never the same respawn spot as last time
      if (this._lastRespawnKey === (Math.floor(c[0]) + ',' + Math.floor(c[2]))) continue;
      const danger = this.mobs.filter(m => !m.dead && m.def.hostile).reduce((s, m) => Math.min(s, Math.hypot(m.x - c[0], m.z - c[2])), Infinity);
      if (danger > bestDanger) { bestDanger = danger; best = c; }
      if (danger >= SAFE_RADIUS && best && best !== base) break; // good enough, stop scanning
    }
    if (!best) best = base;
    this._lastRespawnKey = Math.floor(best[0]) + ',' + Math.floor(best[2]);
    P.x = best[0]; P.y = best[1]; P.z = best[2];
    P.hp = 20; P.food = 20; P.dead = false; P.air = 300; P.fallStart = null;
    P.inv = new Array(36).fill(null);
    P.vel = { x: 0, y: 0, z: 0 };
    P.deathCause = ''; P.hurtCd = 8; // post-respawn grace
    this.toast('Respawned in a safer area. Inventory lost!', 'warn');
    this._logEvent('respawn', 'Player respawned at ' + P.x.toFixed(0) + ',' + P.z.toFixed(0) + ' (nearest hostile ' + (bestDanger === Infinity ? 'unknown' : bestDanger.toFixed(0)) + ' blocks)');
  }
  onPlayerDeath(cause) { this._logEvent('death', cause); if (!(this.hook && this.hook.agent)) this.hud.death(true, cause); }
  onPlayerHurt() { }
  onEat(name) { this._logEvent('eat', name); }
  onPickup() { }
  onMobGone(m, killed) { if (m.mesh) { this.scene.remove(m.mesh); m.mesh = null; } if (killed) this._logEvent('kill', m.type); }
  daylightOf() { return this.daylight(); }
  dayNumber() { return Math.floor(this.time / DAY_LENGTH) + 1; }

  // mob visuals & spawning
  _tickSpawning(dt) {
    this._spawnT = (this._spawnT || 0) + dt;
    if (this._spawnT < 1.0) return;
    this._spawnT = 0;
    const P = this.player;
    const isNight = this.daylight() < 0.35;
    const hostiles = this.mobs.filter(m => m.def.hostile).length;
    const passives = this.mobs.filter(m => !m.def.hostile).length;
    const tryPos = () => {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 18;
      const x = Math.floor(P.x + Math.cos(a) * r) + 0.5, z = Math.floor(P.z + Math.sin(a) * r) + 0.5;
      const h = this.world.heightAt(Math.floor(x), Math.floor(z));
      if (h <= SEA) return null;
      const ground = this.world.getBlock(Math.floor(x), h, Math.floor(z));
      if (!(BLOCKS[ground] && BLOCKS[ground].solid)) return null;
      return [x, h + 1.02, z, h];
    };
    if (isNight && hostiles < 10) {
      const p = tryPos();
      if (p) {
        const sky = this.world.skyLight(Math.floor(p[0]), p[3] + 1, Math.floor(p[2]));
        if (sky < 8 || isNight) {
          const type = ['zombie', 'skeleton', 'spider'][Math.floor(Math.random() * 3)];
          this._spawnMob(type, p[0], p[1], p[2]);
        }
      }
    }
    if (passives < 8 && Math.random() < 0.5) {
      const p = tryPos();
      if (p) {
        const g = this.world.getBlock(Math.floor(p[0]), p[3], Math.floor(p[2]));
        const onSand = g === B.SAND, onGrass = g === B.GRASS;
        if (onGrass || (onSand && Math.random() < 0.45)) {
          const type = ['cow', 'pig', 'sheep'][Math.floor(Math.random() * 3)];
          this._spawnMob(type, p[0], p[1], p[2]);
        }
      }
    }
    // despawn far mobs
    for (const m of this.mobs) {
      if (Math.hypot(m.x - P.x, m.z - P.z) > 60 && m.gone !== true) { m.gone = true; this.onMobGone(m, false); }
    }
    this.mobs = this.mobs.filter(m => !m.gone);
  }
  _spawnMob(type, x, y, z) {
    const m = new Mob(type, x, y, z);
    this.mobs.push(m);
    this.buildMobMesh(m);
    this._logEvent('spawn', type);
    return m;
  }
  buildMobMesh(m) {
    const g = new THREE.Group();
    const skin = MOB_SKINS[m.type] || { body: 0x888888, head: 0x999999, leg: 0x666666 };
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const bodyG = new THREE.BoxGeometry(0.6, 0.6, m.type === 'spider' ? 1.0 : 0.35);
    const body = new THREE.Mesh(bodyG, mat(skin.body));
    body.position.y = 0.85;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.45), mat(skin.head));
    head.position.set(0, 1.35, m.type === 'spider' ? 0.55 : -0.1);
    g.add(head);
    const legs = [];
    const legG = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    const nLegs = m.type === 'spider' ? 8 : m.type === 'cow' || m.type === 'sheep' ? 4 : 2;
    for (let i = 0; i < nLegs; i++) {
      const leg = new THREE.Mesh(legG, mat(skin.leg));
      const px = (i % (nLegs / 2)) - (nLegs / 2 - 1) * 0.25;
      const pz = i < nLegs / 2 ? 0.28 : -0.28;
      leg.position.set(nLegs === 2 ? 0 : px, 0.28, nLegs === 2 ? 0 : pz * (m.type === 'spider' ? 0.8 : 1));
      g.add(leg); legs.push(leg);
    }
    // face pixels: dark eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: m.def.hostile ? 0xff2222 : 0x111111 }));
    eyeL.position.set(-0.12, 1.38, -0.34);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12;
    g.add(eyeL); g.add(eyeR);
    m.meshParts = { legs };
    m.mesh = g;
    this.scene.add(g);
    m._animLegs = () => {
      const t = m.animT * 8;
      legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t + i * Math.PI) * 0.6; });
      g.rotation.y = m.yaw;
    };
  }
  renderMobs(dt) {
    for (const m of this.mobs) {
      if (!m.mesh) continue;
      m.mesh.position.set(m.x, m.y, m.z);
      if (m.hurtT > 0) m.mesh.rotation.z = Math.sin(m.hurtT * 40) * 0.08;
      else m.mesh.rotation.z = 0;
      m._animLegs && m._animLegs();
      if (m.dead) { m.mesh.rotation.z = Math.PI / 2 * (1 - Math.max(0, m.deathT) / 0.9); m.mesh.position.y = m.y + 0.2 - Math.min(0.6, (0.9 - m.deathT) * 0.7) * 0; }
    }
  }

  // main-loop extras called from main.js
  renderLoop(dt) {
    this.renderEntities(); this.renderMobs(dt);
  }
}

// skins
const MOB_SKINS = {
  zombie: { body: 0x3E7A5E, head: 0x4E9B6E, leg: 0x2F4F8A },
  skeleton: { body: 0xC9C9C9, head: 0xDDDDDD, leg: 0xB0B0B0 },
  spider: { body: 0x2B2B33, head: 0x3A3A44, leg: 0x22222A },
  cow: { body: 0x5A4030, head: 0x6B5233, leg: 0x4A3423 },
  pig: { body: 0xF0A8A0, head: 0xF4B8B0, leg: 0xE0958D },
  sheep: { body: 0xE8E8E8, head: 0xD8C8B8, leg: 0xB0A090 },
};

// =========================================================================
// GameAPI — the automation surface the AI agent (and tests) drive.
// =========================================================================
export class GameAPI {
  constructor(engine) { this.e = engine; this.e.hook = { action: null, log: [] }; }
  get player() { return this.e.player; }
  _ensureAgent() {
    this._agentMode = true;
    this._inputAgent();
  }
  _ai() {
    if (!this._agentInput) this._agentInput = { agentLocked: true, forward: 0, strafe: 0, jump: false, sprint: false, sneak: false, breaking: false, useEdge: false, toggleFlyEdge: false, lookDX: 0, lookDY: 0 };
    return this._agentInput;
  }
  _ensureAgent() { this._ai(); }
  _inputAgent() { return this._ai(); }

  // ---- continuous controls (stateless: act() each frame via hook) ----
  act(fn) {
    // fn(input, engine) called every frame; input is a raw Input-like object
    const inp = this._ai();
    this.e.hook.action = (dt) => {
      // reset per-frame one-shots
      const jump = inp.jump; const useEdge = inp.useEdge; const fly = inp.toggleFlyEdge;
      inp._jumpUsed = false;
      // look
      this.e.player.yaw += (inp.lookDX || 0) * dt; this.e.player.pitch = clamp(this.e.player.pitch + (inp.lookDY || 0) * dt, -1.55, 1.55);
      Object.assign(inp, { lookDX: 0, lookDY: 0 });
      this.e.player.tick(dt, this.e.world, inp, this.e);
      if (useEdge) { const hit = this.e.raycastFromCamera(); if (hit) this.e.useOn(hit); }
      if (inp.toggleFlyEdge) { this.e.player.flying = !this.e.player.flying; this.e.player.vel.y = 0; inp.toggleFlyEdge = false; }
      fn && fn(dt, this);
    };
  }
  stopAct() { this.e.hook.action = null; }

  lookAt(yawDeg, pitchDeg) {
    this._agentInput.lookDX = yawDeg; // act() applies incrementally; for absolute use lookAbs
  }
  lookAbs(yawDeg, pitchDeg) {
    this.e.player.yaw = yawDeg * Math.PI / 180; this.e.player.pitch = clamp(pitchDeg * Math.PI / 180, -1.55, 1.55);
  }
  faceTo(x, z) {
    const P = this.e.player;
    P.yaw = Math.atan2(-(x - P.x), -(z - P.z));
  }

  // ---- discrete actions ----
  mine(durationSec = 4) {
    const a = this._ai();
    a.breaking = true;
    return new Promise(res => {
      let acc = 0, broke = 0; // sim time (tab-throttle-proof) + real blocks broken
      this.act((dt) => {
        acc += dt;
        if (this.e.mineFromLook(dt)) broke++;
        if (acc >= durationSec) { a.breaking = false; this.stopAct(); res({ broke, seconds: durationSec }); }
      });
    });
  }
  place() {
    return new Promise(res => {
      this.act((dt, self) => {
        const P = this.e.player;
        // eating works without a block target (consumes held food into hunger)
        const held = P.held();
        const it = held && itemType(held.id);
        if (it && it.food && P.food < 20) {
          P.sel = P.sel; // ensure selection stable
          P.eatTimer = 1.2;
          this.stopAct();
          return res({ ate: it.name, food: P.food });
        }
        const hit = this.e.raycastFromCamera();
        if (hit) { this.e.useOn(hit); this.stopAct(); res({ placedOn: BLOCKS[hit.id].name }); }
        else { this.stopAct(); res(null); }
      });
    });
  }
  useBlock() {
    return new Promise(res => {
      this.act(null);
      setTimeout(() => { const hit = this.e.raycastFromCamera(); this.e.useOn(hit); this.stopAct(); res(hit ? BLOCKS[hit.id].name : null); }, 50);
    });
  }
  selectSlot(i) { this.player.sel = clamp(i, 0, 8) | 0; return this.player.held(); }
  inventory() {
    return this.player.inv.map((s, i) => s ? { slot: i, id: s.id, name: itemType(s.id)?.name || String(s.id), count: s.count } : { slot: i, empty: true });
  }
  craft(recipeKey) {
    const r = RECIPES.find(x => x.key === recipeKey.toLowerCase().replace(/[^a-z_]/g, ''));
    if (!r) return 'unknown recipe ' + recipeKey;
    const nearTable = this._nearTable();
    if (!canCraft(r, this.player.inv, nearTable)) return 'cannot craft (missing items' + (r.table && !nearTable ? ' / need crafting table' : '') + ')';
    for (const [id, n] of r.ins) {
      let left = n;
      for (let i = 0; i < 36 && left > 0; i++) {
        const s = this.player.inv[i];
        if (s && s.id === id) { const t = Math.min(left, s.count); s.count -= t; left -= t; if (s.count <= 0) this.player.inv[i] = null; }
      }
    }
    this.player.addItem(r.out[0], r.out[1]);
    this.e._logEvent('craft', r.key);
    return 'crafted ' + r.key;
  }
  recipes() { return RECIPES.map(r => r.key); }
  smeltables() { return Object.keys(SMELT).map(id => itemType(+id)?.name); }
  smelt(itemName) {
    const id = this._findIdByName(itemName);
    if (id === null) return 'unknown item';
    const f = this._nearFurnace();
    if (!f) return 'no furnace nearby (place one and face it)';
    const [x, y, z] = f;
    return this.e.smeltStart(x, y, z, id, 8);
  }
  collectFurnace() {
    const f = this._nearFurnace(); if (!f) return 'no furnace';
    return this.e.furnaceCollect(f[0], f[1], f[2]);
  }

  _findIdByName(name) {
    const q = String(name).toLowerCase().replace(/[_\s]/g, '');
    for (const [sid, it] of Object.entries(ITEMS)) {
      if (!it) continue;
      if (it.name.toLowerCase().replace(/[_\s]/g, '') === q) return +sid;
    }
    for (const [sid, it] of Object.entries(ITEMS)) {
      if (!it) continue;
      if (it.name.toLowerCase().replace(/[_\s]/g, '').includes(q)) return +sid;
    }
    return null;
  }
  _nearTable() {
    const P = this.player;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
      if (this.e.world.getBlock(Math.floor(P.x) + dx, Math.floor(P.y) + dy, Math.floor(P.z) + dz) === B.TABLE) return true;
    }
    return false;
  }
  _nearFurnace() {
    const P = this.player;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
      if (this.e.world.getBlock(Math.floor(P.x) + dx, Math.floor(P.y) + dy, Math.floor(P.z) + dz) === B.FURNACE) return [Math.floor(P.x) + dx, Math.floor(P.y) + dy, Math.floor(P.z) + dz];
    }
    return null;
  }

  // ---- sensing ----
  state() {
    const P = this.player, e = this.e;
    return {
      pos: [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2)], yawDeg: +(P.yaw * 180 / Math.PI).toFixed(1), pitchDeg: +(P.pitch * 180 / Math.PI).toFixed(1),
      hp: +P.hp.toFixed(1), maxHp: P.maxHp, food: P.food, inWater: P.inWater, onGround: P.onGround,
      dead: P.dead, deathCause: P.deathCause || null, gameMode: P.gameMode, selected: P.held() ? { id: P.held().id, name: itemType(P.held().id)?.name, count: P.held().count } : null,
      timeOfDay: +((e.time % DAY_LENGTH) / DAY_LENGTH).toFixed(3), day: e.dayNumber(),
      seed: e.seed,
      daylight: +e.daylight().toFixed(2), biome: biomeAt(Math.floor(P.x), Math.floor(P.z), e.seed),
      target: e._selTarget ? { x: e._selTarget.x, y: e._selTarget.y, z: e._selTarget.z, id: e._selTarget.id, name: BLOCKS[e._selTarget.id].name, face: e._selTarget.face, dist: +e._selTarget.dist.toFixed(2) } : null,
      mobsNearby: e.mobs.filter(m => !m.dead && Math.hypot(m.x - P.x, m.z - P.z) < 32).map(m => ({ type: m.type, hostile: m.def.hostile, hp: m.hp, dist: +Math.hypot(m.x - P.x, m.y - P.y, m.z - P.z).toFixed(1), pos: [+m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1)] })),
      dropsNearby: e.drops.slice(0, 12).map(d => ({ id: d.item.id, name: (itemType(d.item.id) || {}).name, count: d.item.count, pos: [+d.x.toFixed(1), +d.y.toFixed(1), +d.z.toFixed(1)], dist: +Math.hypot(d.x - P.x, d.y - P.y, d.z - P.z).toFixed(1) })),
      breakProgress: e.breakingState.tx !== null ? +(e.breakingState.prog / Math.max(0.01, e.breakingState.needed)).toFixed(2) : 0,
    };
  }
  nearestBlock(kind) {
    // kind: 'wood'|'stone'|'ore'|'water'|name-fragment; BFS over loaded chunks (radius 24)
    const P = this.player;
    const targets = new Set();
    if (kind === 'wood' || kind === 'log') { targets.add(B.LOG); }
    else if (kind === 'stone') { targets.add(B.STONE); targets.add(B.COBBLE); }
    else if (kind === 'ore') { [B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE].forEach(x => targets.add(x)); }
    else if (kind === 'water') targets.add(B.WATER);
    else {
      const id = this._findIdByName(kind);
      if (id !== null && id < 100) targets.add(id); else return null;
    }
    const r = 24, px = Math.floor(P.x), py = Math.floor(P.y), pz = Math.floor(P.z);
    let best = null, bestD = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -12; dy <= 12; dy++) {
      const y = py + dy; if (y < 0 || y >= CHUNK_Y) continue;
      const id = this.e.world.getBlockLoaded(px + dx, y, pz + dz);
      if (id === -1 || !targets.has(id)) continue;
      const d = dx * dx + dy * dy * 2 + dz * dz;
      if (d < bestD) { bestD = d; best = [px + dx, y, pz + dz, id]; }
    }
    return best ? { x: best[0], y: best[1], z: best[2], name: BLOCKS[best[3]].name, dist: +Math.sqrt(Math.floor(bestD)).toFixed(1) } : null;
  }
  blocksAround(radius = 6) {
    // compact grid of ids as strings, y+2..y-1, for agent reasoning
    const P = this.player;
    const rows = [];
    for (let dy = 2; dy >= -1; dy--) {
      for (let dz = -radius; dz <= radius; dz += 2) {
        let row = '';
        for (let dx = -radius; dx <= radius; dx += 2) {
          const id = this.e.world.getBlock(Math.floor(P.x) + dx, Math.floor(P.y) + dy, Math.floor(P.z) + dz);
          row += id.toString(16).padStart(2, '0');
        }
        rows.push(row);
      }
    }
    return rows;
  }

  // ---- navigation (BFS path + drive) ----
  async goto(x, z, maxSec = 45) {
    const w = this.e.world, P = this.player;
    const tx = Math.floor(x), tz = Math.floor(z);
    const passable = (bx, by, bz) => {
      const bl = BLOCKS[w.getBlock(bx, by, bz)];
      if (bl && bl.solid && !bl.liquid && !bl.cross) return false; // body
      const bl2 = BLOCKS[w.getBlock(bx, by + 1, bz)];
      if (bl2 && bl2.solid && !bl2.liquid && !bl2.cross) return false; // head
      const below = BLOCKS[w.getBlock(bx, by - 1, bz)];
      return below && below.solid; // floor
    };
    const h0 = w.heightAt(Math.floor(P.x), Math.floor(P.z));
    const start = [Math.floor(P.x), Math.max(1, Math.min(CHUNK_Y - 2, h0 + 1)), Math.floor(P.z)];
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const seen = new Map();
    const qs = [[start, null]];
    seen.set(key(...start), { parent: null });
    let goal = null;
    let expansions = 0;
    while (qs.length && expansions < 5000) {
      const qsn = qs.splice(0, 1)[0];
      const [cx, cy, cz] = qsn[0];
      expansions++;
      if (Math.abs(cx - tx) <= 0 && Math.abs(cz - tz) <= 0) { goal = qsn; break; }
      if (Math.hypot(cx - tx, cz - tz) < 1.2) { goal = qsn; break; }
      const nbrs = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        for (const ny of [cy, cy - 1, cy + 1, cy - 2, cy + 2]) {
          if (passable(cx + dx, ny, cz + dz) && passable(cx + dx, cy - 1, cz + dz) === false) { } // (noop, keep simple)
          if (passable(cx + dx, ny, cz + dz)) nbrs.push([cx + dx, ny, cz + dz]);
        }
      }
      for (const n of nbrs) {
        const k = key(...n);
        if (seen.has(k)) continue;
        seen.set(k, { parent: qsn });
        qs.push([n, qsn]);
      }
    }
    if (!goal) return { ok: false, why: 'no path found within loaded area' };
    const path = [];
    let node = goal;
    while (node) { path.unshift(node[0]); node = node[1]; }
    // drive
    let i = 1;
    return await new Promise(resolve => {
      const a = this._ai();
      a.forward = 0; a.strafe = 0; a.breaking = false;
      let acc = 0; // sim time
      this.act((dt) => {
        acc += dt;
        if (acc > maxSec) { a.forward = 0; this.stopAct(); resolve({ ok: false, why: 'timeout, progress ' + i + '/' + path.length }); return; }
        if (P.dead) { a.forward = 0; this.stopAct(); resolve({ ok: false, why: 'died en route' }); return; }
        // advance waypoint when close
        while (i < path.length) {
          const [wx, wy, wz] = path[i];
          if (Math.hypot(P.x - wx - 0.5, P.z - wz - 0.5) < 0.75 && Math.abs(P.y - wy) < 2.5) i++; else break;
        }
        const [wx, wy, wz] = path[i] || path[path.length - 1];
        const dx = wx + 0.5 - P.x, dz = wz + 0.5 - P.z;
        const dh = Math.hypot(dx, dz);
        // face + move
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - P.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        P.yaw += clamp(dyaw, -6 * dt, 6 * dt);
        a.forward = dh > 0.75 ? 1 : 0; a.strafe = 0;
        a.sprint = false;
        // jump if blocked ahead or waypoint above
        const aheadX = Math.floor(P.x - Math.sin(P.yaw) * 0.8), aheadZ = Math.floor(P.z - Math.cos(P.yaw) * 0.8);
        const blA = BLOCKS[w.getBlock(aheadX, Math.floor(P.y + 0.2), aheadZ)];
        const needJump = (blA && blA.solid && !blA.cross && !blA.liquid) || (wy > Math.floor(P.y) + 0.5 && dh < 2.2);
        a.jump = P.inWater ? true : needJump;
        if (i >= path.length || (dh < 0.75 && i === path.length - 1)) {
          a.forward = 0; a.jump = false; this.stopAct();
          resolve({ ok: true, elapsed: +acc.toFixed(1) });
        }
      });
    });
  }
  stopMove() { if (this._agentInput) { this._agentInput.forward = 0; this._agentInput.breaking = false; } this.stopAct(); }

  async attack() {
    return await new Promise(res => {
      const P = this.e.player;
      let acc = 0; // sim time
      const a = this._ai();
      this.act((dt) => {
        acc += dt;
        // pick nearest mob in front within reach
        let best = null, bd = 3.2;
        for (const m of this.e.mobs) {
          if (m.dead) continue;
          const dx = m.x - P.x, dy = m.y + m.height / 2 - (P.y + 1.2), dz = m.z - P.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < bd) {
            const lv = P.lookVec();
            const dot = (dx / d) * lv.x + (dy / d) * lv.y + (dz / d) * lv.z;
            if (dot > 0.5) { bd = d; best = m; }
          }
        }
        if (best && P.attackCd <= 0) {
          const held = P.held();
          const dmg = held && itemType(held.id)?.tool?.type === 'sword' ? itemType(held.id).dmg : 1;
          best.hurt(dmg, (best.x - P.x) / (bd + 0.01), (best.z - P.z) / (bd + 0.01), this.e);
          P.attackCd = 0.6;
          this.e._logEvent('attack', best.type + ' -> ' + Math.max(0, best.hp) + 'hp');
        }
        if (acc > 0.9) { this.stopAct(); res(best ? { hitType: best.dead ? 'killed' : 'hit', type: best.type, hp: Math.max(0, best.hp) } : { hitType: 'none' }); }
      });
    });
  }
  async followMob(type, maxSec = 60) {
    return await new Promise(res => {
      let acc = 0; // sim time
      const a = this._ai();
      this.act((dt) => {
        acc += dt;
        const m = this.e.mobs.find(m => m.type === type && !m.dead);
        if (!m || acc > maxSec) { a.forward = 0; this.stopAct(); res(m ? 'arrived near ' + type : 'no ' + type + ' found'); return; }
        this._driveToward(m.x, m.z, a, dt => { }, 2.5);
      });
    });
  }
  _driveToward(tx, tz, a, tickFn, arriveDist) {
    const P = this.e.player;
    const dx = tx - P.x, dz = tz - P.z;
    const d = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - P.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    P.yaw += clamp(dyaw, -6 * 0.016, 6 * 0.016);
    a.forward = d > arriveDist ? 1 : 0;
    const aheadX = Math.floor(P.x - Math.sin(P.yaw) * 0.8), aheadZ = Math.floor(P.z - Math.cos(P.yaw) * 0.8);
    const blA = BLOCKS[this.e.world.getBlock(aheadX, Math.floor(P.y + 0.2), aheadZ)];
    a.jump = (blA && blA.solid && !blA.cross && !blA.liquid) || P.inWater;
    return d;
  }

  // shelter skill: dig down 3, drop in, seal the sky (emergency overnight protection)
  burrow() {
    const r = burrow(this.e, (msg) => this.e._logEvent('shelter', msg));
    this.e._logEvent('shelter', 'result: ' + (r.ok ? 'sealed' : r.why));
    return r;
  }

  // ---- meta ----
  teleport(x, y, z) { this.player.x = x; this.player.y = y; this.player.z = z; this.player.vel = { x: 0, y: 0, z: 0 }; }
  give(itemName, n = 1) { const id = this._findIdByName(itemName); if (id === null) return 'unknown'; this.e.give(id, n); return 'given'; }
  setTime(t) { this.e.time = ((t % 1) + 1) % 1 * DAY_LENGTH; }
  setGameMode(m) { this.player.gameMode = m === 'creative' ? 'creative' : 'survival'; if (m === 'survival') this.player.flying = false; }
  chat(msg) { this.e.hud.chatMsg('Agent', msg); this.e._logEvent('chat', msg); }
  events(sinceMs = 0) {
    const now = performance.now();
    return this.e.eventLog.filter(e => now - e.stamp <= sinceMs ? true : sinceMs === 0 ? true : false).slice(-50);
  }
  recentEvents(n = 20) { return this.e.eventLog.slice(-n); }
  screenshotDataURL(width = 640) {
    const src = this.e.canvas;
    const cv = document.createElement('canvas');
    const ar = src.height / src.width;
    cv.width = width; cv.height = Math.round(width * ar);
    const c = cv.getContext('2d');
    c.drawImage(src, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.7);
  }
  respawn() { if (this.player.dead) this.e.respawnPlayer(); }
  save() { this.e.saveNow(); }
}