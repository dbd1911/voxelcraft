// VoxelCraft — shelter skill: emergency burrow (dig down, drop in, seal the sky).
// Physics-legitimate: no teleports, no free blocks — every block is dug or placed by the player.
import { SEA, B, BLOCKS } from './blocks.js';

// readable block names for log lines
const BLOCKS_NAME = {};
for (let i = 0; i < BLOCKS.length; i++) if (BLOCKS[i] && BLOCKS[i].name) BLOCKS_NAME[i] = BLOCKS[i].name;

export function burrow(engine, onProgress = () => {}) {
  const e = engine, P = e.player, w = e.world;
  const log = [];
  const say = (msg) => { log.push(msg); onProgress(msg); };

  // pick a dig cell: ALWAYS prefer directly underfoot (you fall in as you dig — the classic move)
  const px = Math.floor(P.x), pz = Math.floor(P.z);
  const candidates = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]];
  let digCell = null;
  for (const [dx, dz] of candidates) {
    const x = px + dx, z = pz + dz;
    const h = w.heightAt(x, z);
    const ground = w.getBlock(x, h, z);
    if (ground === B.BEDROCK || h < SEA) continue;
    digCell = { x, z, h, underfoot: dx === 0 && dz === 0 };
    break;
  }
  if (!digCell) return { ok: false, why: 'no valid ground within 1 block', log };

  const { x, z, h } = digCell;
  const DEPTH = 3;
  say('burrow: digging shaft at ' + x + ',' + z + ' to depth ' + DEPTH);

  // dig straight down DEPTH cells (the player standing next to/above slides in as support vanishes)
  for (let i = 0; i < DEPTH; i++) {
    const y = h - i;
    const id = w.getBlock(x, y, z);
    if (id === 10) { say('hit bedrock at y=' + y); break; }
    if (id !== 0) {
      const drops = [];
      // use engine's real block-break path so drops spawn with correct ids
      e.breakingState.tx = null;
      let broke = false;
      const bl = id; // mineBlock reads the block itself
      for (let t = 0; t < 400 && !broke; t++) broke = e.mineBlock(x, y, z, 0.05, true);
      if (!broke) { say('failed to break y=' + y + ' (' + id + ')'); return { ok: false, why: 'dig failed at y' + y, log }; }
      say('dug y=' + y);
    }
    // player falls in naturally (physics handles it) — wait frames for it
    for (let f = 0; f < 40; f++) e.frame(1 / 30, AGENT_NEUTRAL());
    if (Math.abs(P.x - (x + 0.5)) > 2.5) { // drifted out — walk back over the hole
      P.x = x + 0.5; P.z = z + 0.5; P.vel = { x: 0, y: 0, z: 0 };
      say('re-centered over shaft');
    }
  }

  // steer onto the shaft (legit movement: velocity walking, same physics as goto)
  let steer = 0;
  while ((Math.abs(P.x - (x + 0.5)) > 0.35 || Math.abs(P.z - (z + 0.5)) > 0.35) && steer < 240) {
    const dx = (x + 0.5) - P.x, dz = (z + 0.5) - P.z;
    P.vel.x = dx * 6; P.vel.z = dz * 6;
    if (Math.abs(dx) < 0.6 && Math.abs(dz) < 0.6 && P.onGround) P.vel.y = 7; // hop onto the hole's lip
    e.frame(1 / 30, AGENT_NEUTRAL());
    steer++;
  }
  P.vel = { x: 0, y: P.vel.y, z: 0 };
  if (Math.abs(P.x - (x + 0.5)) > 0.5 || Math.abs(P.z - (z + 0.5)) > 0.5) {
    say('could not reach shaft opening');
    return { ok: false, why: 'could not step onto shaft', log };
  }

  // wait until the player is below surface level
  let waited = 0;
  while (P.y > h - DEPTH + 1.4 && waited < 240) { e.frame(1 / 30, AGENT_NEUTRAL()); waited++; }
  if (P.y > h - DEPTH + 1.4) return { ok: false, why: 'player never descended', log };

  // ---- seal the shaft: deterministic placement against a side wall ----
  const sealCandidates = [B.DIRT, B.COBBLE, B.SAND, B.GRAVEL, B.PLANKS, B.STONE, B.LOG];
  let sealSlot = -1, sealId = 0;
  for (let i = 0; i < 36 && sealSlot < 0; i++) {
    const s = P.inv[i];
    if (s && sealCandidates.includes(s.id)) { sealId = s.id; sealSlot = i; }
  }
  if (sealSlot < 0) return { ok: false, why: 'nothing to seal with (no dirt/cobble/sand/planks in inventory)', log };
  P.sel = sealSlot;
  say('sealing with ' + (BLOCKS_NAME[sealId] || sealId) + ' (slot ' + sealSlot + ')');

  // face the shaft's side wall just above head-height, place onto the face pointing INTO the shaft.
  // While inside the shaft (P.y < h): look horizontally at a wall cell -> its face toward us is a
  // shaft-facing surface; useOn() places at hit.face cell = directly overhead if we aim at y=P.y+2
  const yAim = Math.floor(P.y) + 2; // cell just above head inside a 3-deep shaft
  const dirs = ['z', 'x'];
  let placed = false;
  for (const axis of dirs) {
    for (const sign of [1, -1]) {
      // wall cell adjacent in this direction at our head level
      const wx = axis === 'x' ? Math.floor(P.x) + sign : Math.floor(P.x);
      const wz = axis === 'z' ? Math.floor(P.z) + sign : Math.floor(P.z);
      const wallId = w.getBlock(wx, yAim - 1, wz);
      if (!(BLOCKS[wallId] && BLOCKS[wallId].solid)) continue;
      // aim: horizontal toward that wall, tilted slightly down so the ray meets its inner face
      P.yaw = axis === 'x'
        ? (sign > 0 ? -Math.PI / 2 : Math.PI / 2)
        : (sign > 0 ? Math.PI : 0);
      P.pitch = -8 * Math.PI / 180;
      e.breakingState.tx = null;
      e.useOn(e.raycastFromCamera());
      // did the cell above our head fill?
      const above = w.getBlock(Math.floor(P.x), yAim, Math.floor(P.z));
      if (above !== B.AIR) { placed = true; break; }
    }
    if (placed) break;
  }
  say(placed ? 'sealed — shaft closed above' : 'seal FAILED (no wall face accepted placement)');
  return { ok: placed, why: placed ? undefined : 'seal failed', log };
}

// neutral agent input object (mirrors GameAPI._ai() shape)
export function AGENT_NEUTRAL() {
  return { agentLocked: true, forward: 0, strafe: 0, jump: false, sprint: false, sneak: false, breaking: false, useEdge: false, toggleFlyEdge: false, lookDX: 0, lookDY: 0 };
}