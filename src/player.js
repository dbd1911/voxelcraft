// VoxelCraft — player + shared AABB voxel physics. Controller (Gamepad API) + keyboard.
import { B, BLOCKS, DAY_LENGTH } from './blocks.js';
import { clamp } from './noise.js';

export const PLAYER_W = 0.6, PLAYER_H = 1.8, EYE = 1.62;
const GRAV = 28, JUMP_V = 9.0, WALK = 4.3, SPRINT = 5.7, SNEAK = 1.4, SWIM = 2.6;

// generic voxel AABB move — shared by player, mobs, drops
export function moveEntity(w, e, dt, opts = {}) {
  const { width, height } = e;
  const solidAt = (x, y, z) => { const id = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); const bl = BLOCKS[id]; return !!(bl && bl.solid && !bl.liquid && !bl.cross); };
  const collides = (px, py, pz) => {
    const x0 = Math.floor(px - width / 2 + 1e-4), x1 = Math.floor(px + width / 2 - 1e-4);
    const y0 = Math.floor(py + 1e-4), y1 = Math.floor(py + height - 1e-4);
    const z0 = Math.floor(pz - width / 2 + 1e-4), z1 = Math.floor(pz + width / 2 - 1e-4);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (solidAt(x + 0.5, y + 0.5, z + 0.5)) return true;
    return false;
  };
  e.onGround = false;
  const step = (axis, v) => {
    if (v === 0) return;
    const d = { x: 'x', y: 'y', z: 'z' }[axis];
    e[d] += v;
    if (collides(e.x, e.y, e.z)) {
      e[d] -= v;
      if (axis === 'y') {
        if (v < 0) {
          // descend in 1/8-block increments until contact — precise ground snap, no hover
          const sMax = -v, inc = 0.125;
          let moved = 0;
          while (moved < sMax) {
            const step = Math.min(inc, sMax - moved);
            e.y -= step; moved += step;
            if (collides(e.x, e.y, e.z)) { e.y += step; e.onGround = true; break; }
          }
        }
        e.vel.y = 0;
      } else {
        // step-up assist for 1-block ledges (auto-jump feel, mobs rely on jump AI anyway)
        e[d] += v;
        e.y += 0.6;
        if (collides(e.x, e.y, e.z)) { e[d] -= v; e.y -= 0.6; e.vel[d] = 0; }
        else e.y -= 0.6;
      }
    }
  };
  const v = e.vel;
  const max = v.x * v.x + v.z * v.z;
  if (max > 144) { const s = 12 / Math.sqrt(max); v.x *= s; v.z *= s; } // hard cap 12 m/s
  step('x', v.x * dt);
  step('z', v.z * dt);
  step('y', v.y * dt);
}

export function blockAtFeet(w, e, dy = 0) {
  return w.getBlock(Math.floor(e.x), Math.floor(e.y + dy), Math.floor(e.z));
}
export function isInWater(w, e, dy = 0.5) {
  const id = w.getBlock(Math.floor(e.x), Math.floor(e.y + dy), Math.floor(e.z));
  return id === B.WATER;
}

export class Player {
  constructor(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.width = PLAYER_W; this.height = PLAYER_H;
    this.onGround = false;
    this.hp = 20; this.maxHp = 20; this.food = 20; this.exhaustion = 0;
    this.air = 300; // ticks (10s @30tps)
    this.dead = false; this.respawnTimer = 0;
    this.fallStart = null;
    this.attackCd = 0; this.useCd = 0; this.eatTimer = 0; this.hurtCd = 0;
    this.inWater = false; this.headInWater = false;
    this.sprinting = false; this.flying = false; this.gameMode = 'survival';
    this.hotbar = new Array(9).fill(null);
    this.inv = new Array(36).fill(null); // 0..8 hotbar, 9..35 backpack; {id,count}
    this.sel = 0;
    this.autoEat = true;
    this.deathCause = '';
  }
  get eyeY() { return this.y + EYE; }
  lookVec() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }
  held() { return this.inv[this.sel]; }

  addItem(id, count) {
    const stack = (id >= 100) ? (ITEM_STACK(id)) : 64;
    let left = count;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.inv[i];
      if (s && s.id === id && s.count < stack) { const add = Math.min(left, stack - s.count); s.count += add; left -= add; }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.inv[i]) { const add = Math.min(left, stack); this.inv[i] = { id, count: add }; left -= add; }
    }
    return left; // leftover that doesn't fit
  }
  consumeHeld(n = 1) {
    const s = this.inv[this.sel];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.inv[this.sel] = null;
    return true;
  }
  damage(n, cause, sim) {
    if (this.dead || this.hurtCd > 0 || this.gameMode === 'creative') return;
    this.hp -= n; this.hurtCd = 0.5;
    if (sim) sim.onPlayerHurt(n, cause);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathCause = cause; this.respawnTimer = 3; if (sim) sim.onPlayerDeath(cause); }
  }

  tick(dt, w, input, sim) {
    if (this.dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0 && sim) sim.respawnPlayer();
      return;
    }
    this.hurtCd = Math.max(0, this.hurtCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.useCd = Math.max(0, this.useCd - dt);
    // self-heal inconsistent state (shouldn't happen, but belt-and-braces for long runs)
    if (!this.dead && this.hp <= 0) { this.dead = true; this.deathCause = this.deathCause || 'mysterious causes'; this.respawnTimer = 3; if (sim) sim.onPlayerDeath(this.deathCause); }

    const inWaterBody = isInWater(w, this, 0.4);
    const headWater = isInWater(w, this, EYE);
    this.inWater = inWaterBody; this.headInWater = headWater;

    // ---- movement intent (agent input objects carry their own actions; no gating here) ----
    let mx = 0, mz = 0, wantSprint = false, wantJump = false, sneak = false;
    mx = input.strafe; mz = input.forward;
    wantSprint = input.sprint; wantJump = input.jump; sneak = input.sneak;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (-sy * mz + cy * mx), wz = (-cy * mz - sy * mx);

    if (this.gameMode === 'creative' && input.toggleFlyEdge) { this.flying = !this.flying; this.vel.y = 0; input.toggleFlyEdge = false; }

    let speed = sneak ? SNEAK : (wantSprint && this.food > 6 && mz > 0.1 ? SPRINT : WALK);
    if (this.gameMode === 'creative' && wantSprint && this.flying) speed = 14;
    this.sprinting = speed === SPRINT && len > 0.1;

    if (this.flying) {
      this.vel.x = wx * speed; this.vel.z = wz * speed;
      this.vel.y = (wantJump ? 9 : 0) + (input.sneak ? -9 : 0);
    } else {
      if (inWaterBody) {
        this.vel.x += (wx * speed * 0.5 - this.vel.x) * Math.min(1, dt * 8);
        this.vel.z += (wz * speed * 0.5 - this.vel.z) * Math.min(1, dt * 8);
        this.vel.y += (wantJump ? 16 : -6) * dt;
        this.vel.y = clamp(this.vel.y, -4, 3.5);
      } else {
        const accel = this.onGround ? 14 : 4;
        this.vel.x += (wx * speed - this.vel.x) * Math.min(1, dt * accel);
        this.vel.z += (wz * speed - this.vel.z) * Math.min(1, dt * accel);
        if (wantJump && this.onGround) { this.vel.y = JUMP_V; this.onGround = false; this.exhaustion += sprintJump(wantSprint); }
      }
      this.vel.y -= GRAV * dt * (inWaterBody ? 0.35 : 1);
      this.vel.y = Math.max(this.vel.y, inWaterBody ? -4 : -60);
    }

    // fall tracking
    if (!this.onGround && !inWaterBody && this.vel.y < 0 && this.fallStart === null) this.fallStart = this.y;
    const wasGround = this.onGround;

    moveEntity(w, this, dt);
    if (this.flying) this.onGround = false;

    // landing / fall damage
    if (this.onGround && !wasGround) {
      if (this.fallStart !== null) {
        const dist = this.fallStart - this.y;
        if (dist > 3.2 && !inWaterBody && this.gameMode !== 'creative') this.damage(Math.floor(dist - 3), 'fell from a high place', sim);
      }
      this.fallStart = null;
    }
    if (inWaterBody || this.onGround) this.fallStart = this.fallStart === null ? null : (inWaterBody ? null : this.fallStart);

    // ---- drowning
    if (headWater && this.gameMode === 'survival') {
      this.air -= dt * 30;
      if (this.air < -20) { this.air = 0; this.damage(2, 'drowned', sim); }
    } else this.air = Math.min(300, this.air + dt * 60);

    // ---- cactus / suffocation
    const feet = w.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    const headB = w.getBlock(Math.floor(this.x), Math.floor(this.y + EYE), Math.floor(this.z));
    if (feet === B.CACTUS || headB === B.CACTUS) this.damage(1, 'was pricked to death', sim);
    if (this.y < -4) this.damage(2, 'fell out of the world', sim);

    // ---- hunger system
    if (this.gameMode === 'survival') {
      const speedFactor = this.sprinting ? 0.6 : 0.15;
      this.exhaustion += speedFactor * dt * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK);
      if (this.exhaustion >= 4) { this.exhaustion -= 4; this.food = Math.max(0, this.food - 1); }
      if (this.food >= 18 && this.hp < this.maxHp) { this.hp = Math.min(this.maxHp, this.hp + dt / 3); this.exhaustion += dt; }
      if (this.food <= 0) { this.starveT = (this.starveT || 0) + dt; if (this.starveT > 3) { this.starveT = 0; if (this.hp > 2) this.damage(1, 'starved to death', sim); } }
    }

    // ---- auto-eat
    if (this.autoEat && this.gameMode === 'survival' && this.food < 14 && this.eatTimer <= 0) {
      for (let i = 0; i < 36; i++) {
        const s = this.inv[i];
        if (s && s.id >= 100 && ITEMS_FOOD[s.id]) { this.sel = i; this.eatTimer = 1.2; break; }
      }
    }
    if (this.eatTimer > 0) {
      this.eatTimer -= dt;
      const s = this.inv[this.sel];
      if (this.eatTimer <= 0 && s && ITEMS_FOOD[s.id]) {
        this.food = Math.min(20, this.food + ITEMS_FOOD[s.id]);
        this.consumeHeld(1); if (sim) sim.onEat(ITEMS_FOOD_NAME[s.id]);
      }
    }
  }
}
function sprintJump(s) { return s ? 0.2 : 0.05; }
// food table duplicated from blocks.js item defs (id -> hunger restored)
import { ITEMS } from './blocks.js';
const ITEMS_FOOD = {};
const ITEMS_FOOD_NAME = {};
for (const it of Object.values(ITEMS)) if (it && it.food) { ITEMS_FOOD[it.id] = it.food; ITEMS_FOOD_NAME[it.id] = it.name; }
function ITEM_STACK(id) {
  const it = ITEMS[id];
  return it && it.stack ? it.stack : 64;
}

// ---------------- DDA raycast ----------------
// returns { x,y,z, face:[nx,ny,nz], id } of first solid-or-cross block within reach
export function raycastBlock(w, ox, oy, oz, dx, dy, dz, reach = 5) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tDeltaX = Math.abs(1 / (dx || 1e-10)), tDeltaY = Math.abs(1 / (dy || 1e-10)), tDeltaZ = Math.abs(1 / (dz || 1e-10));
  let tMaxX = tDeltaX * (stepX > 0 ? (x + 1 - ox) : (ox - x));
  let tMaxY = tDeltaY * (stepY > 0 ? (y + 1 - oy) : (oy - y));
  let tMaxZ = tDeltaZ * (stepZ > 0 ? (z + 1 - oz) : (oz - z));
  let face = [0, 0, 0], t = 0;
  for (let i = 0; i < 160; i++) {
    if (t > reach) return null;
    const id = w.getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER) {
      if (t > 0 || i > 0) return { x, y, z, face: face.slice(), id, dist: t };
      // first cell inside a block (head in block) — return immediate
      return { x, y, z, face: [0, 1, 0], id, dist: 0 };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
  }
  return null;
}