// VoxelCraft — mobs (AI + physics), floating item drops, mob definitions.
import { B, BLOCKS, I } from './blocks.js';
import { moveEntity, isInWater } from './player.js';
import { mulberry32, clamp } from './noise.js';

export const MOB_DEFS = {
  zombie:   { hp: 20, speed: 2.1, dmg: 3, hostile: true, burns: true, width: 0.6, height: 1.9, drops: [] },
  skeleton: { hp: 20, speed: 2.2, dmg: 3, hostile: true, burns: true, width: 0.6, height: 1.9, ranged: true, drops: [[I.STICK, 0, 2]] },
  spider:   { hp: 16, speed: 2.9, dmg: 2, hostile: true, burns: false, width: 1.2, height: 0.9, drops: [[I.STICK, 0, 1]] },
  cow:      { hp: 10, speed: 1.4, dmg: 0, hostile: false, width: 0.9, height: 1.3, drops: [[I.BEEF_RAW, 1, 2]] },
  pig:      { hp: 10, speed: 1.4, dmg: 0, hostile: false, width: 0.9, height: 0.9, drops: [[I.PORK_RAW, 1, 2]] },
  sheep:    { hp: 8,  speed: 1.4, dmg: 0, hostile: false, width: 0.9, height: 1.3, drops: [[B.WOOL, 1, 1], [I.BEEF_RAW, 1, 1]] },
};

const rng = mulberry32(424242);

export class Mob {
  constructor(type, x, y, z) {
    const d = MOB_DEFS[type];
    this.type = type; this.def = d;
    this.x = x; this.y = y; this.z = z;
    this.vel = { x: 0, y: 0, z: 0 };
    this.width = d.width; this.height = d.height;
    this.yaw = rng() * Math.PI * 2;
    this.hp = d.hp; this.dead = false; this.deathT = 0;
    this.onGround = false; this.hurtT = 0; this.attackCd = 0; this.shootCd = 0;
    this.wanderT = 0; this.moveFwd = 0; this.burnT = 0; this.animT = 0; this.aggroT = 0;
    this.target = null;
  }

  hurt(n, kx, kz, sim) {
    if (this.dead) return;
    this.hp -= n; this.hurtT = 0.5;
    this.aggroT = 8;
    this.vel.x += kx * 6; this.vel.z += kz * 6;
    this.vel.y = Math.max(this.vel.y, 4);
    if (this.hp <= 0) { this.dead = true; this.deathT = 0.9; }
  }

  tick(dt, w, sim) {
    if (this.dead) {
      this.deathT -= dt;
      if (this.deathT <= 0 && this.gone !== true) { this.gone = true; sim.onMobGone(this, true); }
      return;
    }
    if (this.gone) return;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    this.animT += dt * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 2);
    this.aggroT = Math.max(0, this.aggroT - dt);

    const inWater = isInWater(w, this, 0.3);
    const p = sim.player;
    const distP = Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z);

    const isHostile = this.def.hostile;
    const playerAlive = !p.dead && p.gameMode !== 'creative';
    let chasing = false;
    if (isHostile && playerAlive && !p.dead) {
      const canSee = distP < 18 && this._los(w, p.x, p.y + 1.2, p.z);
      if (canSee || this.aggroT > 0) { this.target = p; chasing = distP < 24; }
    }
    if (!isHostile && this.hurtT > 0) { // panic: run away from player
      const dx = this.x - p.x, dz = this.z - p.z;
      this.yaw = Math.atan2(-dx, -dz) + Math.PI; // face away
      this.moveFwd = 1.6;
    } else if (chasing) {
      const dx = p.x - this.x, dz = p.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      const wantDist = this.def.ranged ? 9 : 1.2;
      this.moveFwd = this.def.ranged && distP < wantDist - 2 ? -1 : distP > wantDist ? 1 : 0;
      // melee
      if (!this.def.ranged && distP < 1.7 + this.def.width * 0.4 && this.attackCd <= 0) {
        p.damage(this.def.dmg, 'was slain by a ' + this.type, sim);
        this.attackCd = 1.1;
      }
      // ranged
      if (this.def.ranged && distP < 14 && this.shootCd <= 0 && this._los(w, p.x, p.y + 1.2, p.z)) {
        sim.spawnArrow(this.x, this.y + this.height * 0.85, this.z, p.x, p.y + 0.9, p.z);
        this.shootCd = 2.2;
      }
    } else {
      // wander
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.5 + rng() * 3.5;
        if (rng() < 0.55) { this.moveFwd = 0.7 + rng() * 0.6; this.yaw = rng() * Math.PI * 2; }
        else this.moveFwd = 0;
      }
    }

    // daylight burning
    if (this.def.burns && sim.daylight() > 0.72) {
      const sky = w.skyLight(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z));
      if (sky >= 14) {
        this.burnT += dt;
        if (this.burnT > 1) { this.burnT = 0; this.hp -= 2; if (this.hp <= 0) { this.dead = true; this.deathT = 0.6; } }
      }
    }

    // locomotion
    const sp = this.def.speed * (this.hurtT > 0 && !isHostile ? 2.0 : 1);
    const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    const accel = this.onGround ? 10 : 3;
    this.vel.x += (fwd.x * sp * this.moveFwd - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (fwd.z * sp * this.moveFwd - this.vel.z) * Math.min(1, dt * accel);

    const preVx = this.vel.x, preVz = this.vel.z;
    if (inWater) { this.vel.y += 14 * dt; this.vel.y = clamp(this.vel.y, -3, 3); }
    else this.vel.y -= 28 * dt;
    this.vel.y = Math.max(this.vel.y, -40);
    moveEntity(w, this, dt);
    // hop over obstacles
    const preOnGround = this.onGround;
    if (this.moveFwd > 0 && this.onGround && (Math.abs(preVx - this.vel.x) > 1.0 || Math.abs(preVz - this.vel.z) > 1.0) && (preVx !== 0 || preVz !== 0)) {
      this.vel.y = 8.6; this.onGround = false;
    }
    if (this.onGround) this.fall = 0;
  }

  _los(w, tx, ty, tz) {
    const steps = Math.ceil(Math.hypot(tx - this.x, ty - (this.y + this.height * 0.8), tz - this.z) / 0.8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = this.x + (tx - this.x) * t, y = this.y + this.height * 0.8 + (ty - this.y - this.height * 0.8) * t, z = this.z + (tz - this.z) * t;
      const id = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      const bl = BLOCKS[id];
      if (bl && bl.solid && bl.opaque) return false;
    }
    return true;
  }
}

// ---------------- floating item drops ----------------
export class ItemDrop {
  constructor(itemId, count, x, y, z) {
    this.item = { id: itemId, count };
    this.x = x; this.y = y; this.z = z;
    this.vel = { x: (rng() - 0.5) * 2.5, y: 3 + rng() * 1.5, z: (rng() - 0.5) * 2.5 };
    this.width = 0.25; this.height = 0.25;
    this.onGround = false; this.age = 0;
    this.gone = false;
  }
  tick(dt, w, sim) {
    this.age += dt;
    if (this.age > 300) { this.gone = true; return; }
    const p = sim.player;
    const d = Math.hypot(p.x - this.x, p.y + 0.9 - this.y, p.z - this.z);
    if (!p.dead && this.age > 0.6 && d < 2.4) { // magnet (generous reach — drops often spawn elevated, e.g. tree trunks)
      const s = 6 * dt;
      this.vel.x += (p.x - this.x) / d * s; this.vel.z += (p.z - this.z) / d * s;
      this.vel.y += (p.y + 0.6 - this.y) / d * s;
    }
    this.vel.y -= 22 * dt;
    this.vel.y = Math.max(this.vel.y, -30);
    this.vel.x *= 0.94; this.vel.z *= 0.94;
    if (isInWater(w, this, 0.1)) this.vel.y = Math.min(this.vel.y + 30 * dt, 1.5);
    moveEntity(w, this, dt, {});
    if (!p.dead && this.age > 0.6 && d < 1.5) {
      const left = p.addItem(this.item.id, this.item.count);
      if (left < this.item.count) {
        this.item.count = left;
        sim.onPickup(this.item);
        if (left === 0) this.gone = true;
      }
    }
  }
}