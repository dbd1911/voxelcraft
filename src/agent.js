// VoxelCraft — demo survival agent: a scripted-but-adaptive bot exercising the GameAPI.
// Phase 2 (LLM brain) will replace the decisions with model calls; the action surface stays identical.
import { B, I } from './blocks.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function runDemoAgent(game) {
  const e = game.e;
  game.chat('Demo agent online. Goal: survive — wood → tools → shelter.');
  e._logEvent('agent', 'demo survival run started');

  const state = () => game.state();
  const has = (name, n = 1) => {
    const inv = game.inventory().filter(s => !s.empty);
    const total = inv.filter(s => s.name.toLowerCase().includes(name)).reduce((a, s) => a + s.count, 0);
    return total >= n;
  };
  const step = async (label, fn) => {
    e._logEvent('agent', '▶ ' + label);
    try { return await fn(); } catch (err) { e._logEvent('agent', '✗ ' + label + ': ' + err.message); return null; }
  };

  try {
    // 1) gather wood
    await step('check inventory', async () => {
      if (!has('log', 3)) {
        const tree = game.nearestBlock('oak log') || game.nearestBlock('wood');
        if (tree) {
          game.chat('walking to a tree at ' + tree.x + ',' + tree.y + ',' + tree.z);
          await game.goto(tree.x + 0.5, tree.z + 0.5, 30);
          e.player.lookAbs(Math.atan2(-(tree.x + 0.5 - e.player.x), -(tree.z + 0.5 - e.player.z)) , 0.3);
          // look slightly at trunk then mine
          for (let i = 0; i < 8 && !has('log', 3); i++) {
            await game.mine(1.5);
            // retarget up the trunk if needed
            const t = state().target;
            if (t && t.name === 'Oak Log') await game.mine(2.5);
          }
        }
      }
      return 'wood checked';
    });

    // 2) craft basics
    await step('craft planks/sticks/table', async () => {
      game.craft('planks'); game.craft('planks');
      game.craft('sticks');
      game.craft('table');
      return 'crafted basics';
    });

    // 3) place table + torches nearby
    await step('place crafting table', async () => {
      const sel = game.inventory().find(s => !s.empty && s.name === 'Crafting Table');
      if (sel) {
        const slot = game.inventory().findIndex(s => !s.empty && s.name === 'Crafting Table');
        game.selectSlot(Math.min(8, game.inventory().filter((s, i) => i <= slot && !s.empty).length ? slot : 0));
        // look down and place at feet-adjacent block
        e.player.pitch = 1.2;
        const hit = game.e.raycastFromCamera();
        if (!hit) { e.player.pitch = 1.1; }
        await game.place();
      }
      return 'table placed';
    });

    // 4) stone tools
    await step('craft wooden pickaxe', async () => { game.craft('pick_wood'); return 'ok'; });
    await step('mine stone', async () => {
      const stone = game.nearestBlock('stone');
      if (stone) { await game.goto(stone.x + 0.5, stone.z + 0.5, 30); e.player.pitch = 0.5; await game.mine(8); }
      game.craft('pick_stone'); game.craft('sword_stone');
      return 'stone done';
    });

    // 5) shelter before night
    await step('night check / shelter', async () => {
      const s = state();
      game.chat('daylight ' + s.daylight + ' — ' + (s.daylight < 0.4 ? 'digging in!' : 'still light, gathering food'));
      if (s.daylight < 0.5) {
        // dig into a hillside, place a torch if we have coal, seal behind
        game.craft('torch');
        e.player.pitch = 0.9;
        await game.mine(6); await game.mine(6); await game.mine(6);
        if (has('torch')) { const t = game.inventory().findIndex(x => !x.empty && x.name === 'Torch'); game.selectSlot(Math.min(8, t)); e.player.pitch = -0.4; await game.place(); }
        game.chat('cornered up for the night.');
      }
      return 'shelter ok';
    });

    game.chat('Demo run complete. Watch the event log — Phase 2 swaps my brain for an LLM.');
  } finally {
    game.stopAct();
  }
}