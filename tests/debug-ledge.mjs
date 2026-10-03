// debug ledge walk
import { makeWorld } from '../src/world.js';
import { B } from '../src/blocks.js';
import { moveEntity } from '../src/player.js';

const flat = makeWorld(7);
for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
  for (let y = 0; y < 64; y++) flat.setBlock(x, y, z, y === 37 ? B.STONE : B.AIR, { noGravity: true, fromGen: true });
}
const e1 = { x: 0, y: 42, z: 0, vel: { x: 0, y: 0, z: 0 }, width: 0.6, height: 1.8, onGround: false };
let steps = 0;
while (!e1.onGround && steps < 400) { e1.vel.y -= 28 * (1 / 60); moveEntity(flat, e1, 1 / 60); steps++; }
console.log('landed?', e1.onGround, 'y=', e1.y.toFixed(3));
e1.vel.x = 5;
for (let i = 0; i < 300 && e1.y > 20; i++) {
  e1.vel.y -= 28 * (1 / 60); e1.vel.y = Math.max(e1.vel.y, -40);
  moveEntity(flat, e1, 1 / 60);
  if (i % 25 === 0) console.log(i, 'x=', e1.x.toFixed(2), 'y=', e1.y.toFixed(2), 'vx=', e1.vel.x.toFixed(2), 'vy=', e1.vel.y.toFixed(2), 'ground=', e1.onGround);
}
console.log('final x=', e1.x.toFixed(2), 'y=', e1.y.toFixed(2));