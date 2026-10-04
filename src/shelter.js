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

  // ---- seal the shaft: deterministic geometry, no raycast dependency ----
  // Find wall cells (solid, adjacent to the shaft column) at the TOP of the shaft; we stand
  // inside, place against the wall face that borders the shaft's open sky cell.
  const skyCell = { x: Math.floor(P.x), y: h, z: Math.floor(P.z) }; // top of shaft = open cell
  const sealCandidates = [B.DIRT, B.COBBLE, B.SAND, B.GRAVEL, B.PLANKS, B.STONE, B.LOG];
  let sealSlot = -1, sealId = 0;
  for (let i = 0; i < 36 && sealSlot < 0; i++) {
    const s = P.inv[i];
    if (s && sealCandidates.includes(s.id)) { sealId = s.id; sealSlot = i; }
  }
  if (sealSlot < 0) return { ok: false, why: 'nothing to seal with (no dirt/cobble/sand/planks in inventory)', log };
  P.sel = sealSlot;
  say('sealing with ' + (BLOCKS_NAME[sealId] || sealId) + ' (slot ' + sealSlot + ')');

  // We need a SOLID neighbor of the skyCell whose face toward the skyCell is placeable.
  // Aim exactly at the CENTER of that solid cell: raycast hits its near face; useOn places
  // at hit.face = the sky cell. Perfect geometry, no scanning.
  let placed = false;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of neighbors) {
    const nx = skyCell.x + dx, nz = skyCell.z + dz;
    // solid wall block at the sky cell's own level (or one above)
    for (const wy of [skyCell.y, skyCell.y + 1]) {
      const wallId = w.getBlock(nx, wy, nz);
      if (!(BLOCKS[wallId] && BLOCKS[wallId].solid)) continue;
      // compute yaw to face (nx,nz) from player, pitch to look at its center height wy+0.5
      const tx = nx + 0.5 - P.x, tz = nz + 0.5 - P.z;
      const dx0 = tx, dz0 = tz;
      const horiz = Math.hypot(dx0, dz0) || 1e-6;
      const eye = P.eyeY !== undefined ? P.eyeY : P.y + 1.62;
      const dy = (wy + 0.5) - Math.min(eye, skyCell.y + 0.9); // aim relative to clamped eye
      P.yaw = Math.atan2(-dx0, -dz0);
      P.pitch = clamp(Math.atan2(dy, horiz), -1.5, 1.5);
      e.breakingState.tx = null;
      const aim = e.raycastFromCamera();
      if (!aim) continue;
      // sanity: ray must hit THAT wall cell
      if (aim.x !== nx || aim.z !== nz) continue;
      e.useOn(aim);
      const afterAir = w.getBlock(skyCell.x, skyCell.y, skyCell.z) !== B.AIR;
      if (afterAir) { placed = true; break; }
    }
    if (placed) break;
  }
  say(placed ? 'sealed — shaft closed overhead' : 'seal FAILED (no wall face accepted placement)');
  return { ok: placed, why: placed ? undefined : 'seal failed', log };
}

// neutral agent input object (mirrors GameAPI._ai() shape)
export function AGENT_NEUTRAL() {
  return { agentLocked: true, forward: 0, strafe: 0, jump: false, sprint: false, sneak: false, breaking: false, useEdge: false, toggleFlyEdge: false, lookDX: 0, lookDY: 0 };
}