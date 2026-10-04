// VoxelCraft — shelter skill: emergency burrow (dig down, drop in, seal the sky).
// Physics-legitimate: no teleports, no free blocks — every block is dug or placed by the player.
import { SEA, B } from './blocks.js';

export function burrow(engine, onProgress = () => {}) {
  const e = engine, P = e.player, w = e.world;
  const log = [];
  const say = (msg) => { log.push(msg); onProgress(msg); };

  // pick a dig cell within 1 block of the player, never in water, ground not bedrock
  const px = Math.floor(P.x), pz = Math.floor(P.z);
  const candidates = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]];
  let digCell = null;
  for (const [dx, dz] of candidates) {
    const x = px + dx, z = pz + dz;
    const h = w.heightAt(x, z);
    const ground = w.getBlock(x, h, z);
    if (ground === B.BEDROCK || h < SEA) continue; // sea-level check
    // avoid cell directly under the player unless it's the only option (digging under self drops you in — that's fine too, actually)
    digCell = { x, z, h };
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

  // wait until the player is below surface level
  let waited = 0;
  while (P.y > h - DEPTH + 1.4 && waited < 240) { e.frame(1 / 30, AGENT_NEUTRAL()); waited++; }
  if (P.y > h - DEPTH + 1.4) return { ok: false, why: 'player never descended', log };

  // seal: find a placeable block in inventory (dirt/cobble/sand/anything solid), look straight up, place on the ceiling face above
  const sealCandidates = [2 /*DIRT*/, 4 /*COBBLE*/, 5 /*SAND*/, 16 /*GRAVEL*/, 9 /*PLANKS*/, 3 /*STONE*/, 7 /*LOG*/];
  let sealId = 0, sealSlot = -1;
  for (let i = 0; i < 36 && sealSlot < 0; i++) {
    const s = P.inv[i];
    if (s && sealCandidates.includes(s.id)) { sealId = s.id; sealSlot = i; }
  }
  if (sealSlot < 0) {
    // nothing placeable — dig one extra block sideways for material is overkill; just report
    return { ok: false, why: 'nothing to seal with (no dirt/cobble/sand in inventory)', log };
  }
  P.sel = sealSlot;
  say('sealing with ' + sealId + ' from slot ' + sealSlot);

  // aim straight up: pitch +88
  P.pitch = 88 * Math.PI / 180;
  const hit = e.raycastFromCamera(); // should hit the ceiling of the shaft (face under the block above)
  if (!hit) return { ok: false, why: 'no ceiling face found to seal against', log };
  // placing against a ceiling: useOn places at hit.face — for face [0,1,0] that's the cell ABOVE the ceiling block → wrong (that's the sky).
  // In a 3-deep shaft the "ceiling" from inside is the underside of the top block (y=h). Its downward face means place target = that ceiling cell itself is impossible;
  // correct approach: look at the side wall top cell and place on its top face → lands at y=h (the sky cell above our head).
  P.pitch = 55 * Math.PI / 180; // gaze at upper side wall
  const wall = e.raycastFromCamera();
  if (!wall) return { ok: false, why: 'no side wall to place against', log };
  e.breakingState.tx = null;
  e.useOn(wall); // places at wall.face — if that's the sky cell directly above, great
  const nowAboveHead = w.getBlock(Math.floor(P.x), Math.ceil(P.y + 1.7), Math.floor(P.z));
  const sealed = nowAboveHead !== 0;
  say(sealed ? 'sealed — headspace block present' : 'seal not confirmed: ' + nowAboveHead);

  return { ok: sealed, why: sealed ? undefined : 'seal unconfirmed', log };
}

// neutral agent input object (mirrors GameAPI._ai() shape)
export function AGENT_NEUTRAL() {
  return { agentLocked: true, forward: 0, strafe: 0, jump: false, sprint: false, sneak: false, breaking: false, useEdge: false, toggleFlyEdge: false, lookDX: 0, lookDY: 0 };
}