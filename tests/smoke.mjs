// VoxelCraft — headless smoke tests: worldgen determinism, meshes, physics, mining economics, agent API.
// Run: npm test  (or: node tests/smoke.mjs)
import { makeWorld, biomeAt, terrainHeight } from '../src/world.js';
import { B, I, BLOCKS, ITEMS, RECIPES, SMELT, canCraft, miningInfo } from '../src/blocks.js';
import { fbm2D } from '../src/noise.js';
import { Player, moveEntity } from '../src/player.js';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); }
}

console.log('— noise —');
ok(fbm2D(10.5, 20.5, 42) === fbm2D(10.5, 20.5, 42), 'noise deterministic');
ok(fbm2D(10.5, 20.5, 42) !== fbm2D(11.5, 20.5, 42), 'noise varies with x');

console.log('— worldgen —');
const w = makeWorld(1337);
const h0 = terrainHeight(5, 9, 1337);
ok(h0 === terrainHeight(5, 9, 1337), 'height deterministic');
ok(h0 >= 0 && h0 < 64, 'height in range', h0);
let biomes = new Set();
for (let x = -1024; x <= 1024; x += 32) for (let z = -1024; z <= 1024; z += 32) biomes.add(biomeAt(x, z, 1337));
ok(biomes.size >= 3, 'multiple biomes across 2km', [...biomes]);
ok(w.getBlock(5, h0, 9) !== 0 || h0 === 0, 'surface block present');

// find at least one tree somewhere nearby
let foundTree = false;
outer: for (let x = 0; x < 160; x++) for (let z = 0; z < 160; z++) {
  const h = terrainHeight(x, z, 1337);
  if (h > 23 && w.getBlock(x, h + 1, z) === B.LOG) { foundTree = true; break outer; }
}
ok(foundTree, 'trees generate');

console.log('— chunks & edits —');
const c1 = w.getChunk(0, 0);
ok(c1.blocks.length === 16 * 64 * 16, 'chunk size');
w.setBlock(3, 30, 3, B.PLANKS);
ok(w.getBlock(3, 30, 3) === B.PLANKS, 'edit visible');
w.chunks.delete('0,0');
ok(w.getBlock(3, 30, 3) === B.PLANKS, 'edit survives chunk unload');
w.setBlock(3, 30, 3, B.AIR);

console.log('— mining economy —');
ok(ITEMS[I.PICK_IRON].tool.tier === 3, 'iron pick tier 3');
ok(miningInfo(B.STONE, I.PICK_WOOD).canDrop === true, 'stone drops with wood pick');
ok(miningInfo(B.IRON_ORE, I.PICK_WOOD).canDrop === false, 'iron needs stone pick');
ok(miningInfo(B.IRON_ORE, I.PICK_STONE).canDrop === true, 'iron drops with stone pick');
ok(miningInfo(B.DIAMOND_ORE, I.PICK_IRON).canDrop === true, 'diamond drops with iron pick');
ok(miningInfo(B.DIAMOND_ORE, I.PICK_STONE).canDrop === false, 'diamond needs iron-level pick');
ok(miningInfo(B.BEDROCK, I.PICK_DIA).ok === false, 'bedrock unbreakable');
ok(miningInfo(B.STONE, 0).time > miningInfo(B.STONE, I.PICK_STONE).time, 'better tool mines faster');

console.log('— recipes —');
const inv = [{ id: B.LOG, count: 5 }];
ok(canCraft(RECIPES.find(r => r.key === 'planks'), inv, false), 'planks from log');
ok(!canCraft(RECIPES.find(r => r.key === 'torch'), inv, false), 'torch needs coal+table');
ok(SMELT[B.IRON_ORE] === I.IRON_INGOT, 'iron smelts to ingot');

console.log('— inventory —');
const p = new Player(0, 40, 0);
ok(p.addItem(B.DIRT, 100) === 0, 'addItem stacks');
ok(p.addItem(I.PICK_WOOD, 5) === 0, 'tools stack=1 handled');
const pickSlots = p.inv.filter(s => s && s.id === I.PICK_WOOD && s.count === 1).length;
ok(pickSlots === 5, 'tools occupy separate slots', pickSlots);
const pickSlot = p.inv.findIndex(s => s && s.id === I.PICK_WOOD);
p.sel = pickSlot;
ok(p.consumeHeld(10) === false, 'cannot consume more than held');

console.log('— physics (hermetic platform) —');
const flat = makeWorld(7);
// fully controlled region: floor y=37 for x in [-40..20], air everywhere else incl. drop zone x in (20..60]
for (let x = -40; x <= 60; x++) for (let z = -10; z <= 10; z++) {
  for (let y = 0; y < 64; y++) flat.setBlock(x, y, z, (x <= 20 && y === 37) ? B.STONE : B.AIR, { noGravity: true, fromGen: true });
}
const e1 = { x: 0, y: 42, z: 0, vel: { x: 0, y: 0, z: 0 }, width: 0.6, height: 1.8, onGround: false };
let steps = 0;
while (!e1.onGround && steps < 400) { e1.vel.y -= 28 * (1 / 60); moveEntity(flat, e1, 1 / 60); steps++; }
ok(e1.onGround && Math.abs(e1.y - 38) < 0.2, 'entity lands on floor', e1.y);
// walk toward +x; floor ends at x=20 -> should fall off
e1.vel.x = 5;
for (let i = 0; i < 600; i++) {
  e1.vel.y -= 28 * (1 / 60); e1.vel.y = Math.max(e1.vel.y, -40); moveEntity(flat, e1, 1 / 60);
}
ok(e1.x > 18, 'walked along platform to its end', e1.x);
ok(e1.y < 20, 'walks off ledge and falls', [e1.x.toFixed(1), e1.y.toFixed(1)]);
// wall stop: build a wall, walk into it
for (let z = -10; z <= 10; z++) { flat.setBlock(4, 38, z, B.STONE, { noGravity: true, fromGen: true }); flat.setBlock(4, 39, z, B.STONE, { noGravity: true, fromGen: true }); }
const e2 = { x: 0, y: 38, z: 0, vel: { x: 0, y: 0, z: 0 }, width: 0.6, height: 1.8, onGround: false };
e2.vel.x = 4;
for (let i = 0; i < 120; i++) { e2.vel.y -= 28 * (1 / 60); e2.vel.y = Math.max(e2.vel.y, -40); moveEntity(flat, e2, 1 / 60); }
ok(e2.x < 3.7, 'stops at wall', e2.x);
ok(e2.y > 37.5 && e2.y < 38.5, 'stays on floor at wall', e2.y);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);