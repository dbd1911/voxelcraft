# VoxelCraft

A Minecraft-style voxel survival game that runs entirely in the browser — **built from scratch, original code and procedural assets, no Mojang content** — with a built-in automation API designed for autonomous AI agents.

**Play:** https://dbd1911.github.io/voxelcraft/

## What it is

- **Infinite streaming world** — seeded terrain (plains / forest / desert / snow / mountains), caves, ore veins (coal→iron→gold→diamond), trees, water, beaches. Chunks (16×64×16) stream in/out around you as you move.
- **Minecraft-style gameplay** — punch trees → planks → crafting table → tools (wood/stone/iron/diamond tiers) → mine ores → smelt in furnace → cook food. Health, hunger, drowning, fall damage. Day/night (20-min cycle); hostile mobs (zombie, skeleton w/ arrows, spider) spawn at night and burn at dawn; passive mobs (cow, pig, sheep) drop food.
- **Look & feel** — first-person, block break/placement, hotbar, torches with real light, block-crack animation, fog, clouds, sun/moon/stars. *All textures are painted procedurally at boot — zero image assets, zero IP risk.*
- **Plays with gamepad or keyboard** — full Gamepad API support (see Controls), plus WASD/mouse.

## Runs anywhere

Plain static files — GitHub Pages hosts it. No build step. `npm start` for a local server, or open `index.html` through any static server.

## The agent API (Phase 2 hook)

The whole point of this build: an AI agent can play this game autonomously through `window.game` — the same surface a human player uses. Attach at <script type=module> via `window.game`.

```js
const g = window.game;

g.state();                 // full snapshot: pos, hp/food, time-of-day, biome, target block, nearby mobs/drops
g.inventory();             // slots with names/counts
g.nearestBlock('oak log'); // BFS search: 'wood'|'stone'|'ore'|'water'|any block name
g.faceTo(x, z);            g.lookAbs(yawDeg, pitchDeg);

await g.goto(x, z, 60);    // A* pathing + walking, jump handling  → {ok, elapsed}
await g.mine(6);           // hold break on the targeted block (sim-seconds)
await g.place();           // place held block on target face
await g.attack();          // melee swing at mob in crosshair
g.craft('pick_wood');      // craft (table-aware, validates materials)
g.smelt('Raw Porkchop');   g.collectFurnace();     // furnace ops (nearest furnace)
g.selectSlot(7);           g.give('Torch', 10);    // hotbar + creative give
g.state().daylight;        // plan around night
g.screenshotDataURL();     // agent vision input
g.recentEvents(20);        // mining/kills/spawns/chat log
```

`src/agent.js` ships a working scripted survival demo (button in UI). Phase 2 swaps that brain for an LLM loop — the API surface stays identical. Run with `?mode=creative` for flying/creative testing.

## Controls

**Keyboard/mouse:** WASD move · mouse look · LMB hold mine · RMB place/use/eat · 1–9/wheel hotbar · E or C inventory+crafting · Esc pause · Ctrl sneak · Shift sprint · F fly (creative) · R debug HUD · G toggle AI control · click canvas to capture mouse.

**Gamepad:** left stick move · right stick look · **RT hold mine** · LT place · A jump · B sneak · Y inventory · X crafting · Start pause · L3 sprint toggle · LB/RB hotbar · D-pad→ hotbar · D-pad↑ fly toggle (creative). Auto-detected when the controller connects.

## Architecture (src/)

| File | Role |
|---|---|
| `noise.js` | deterministic hash/value-noise/fBm/ridged — same seed, same world |
| `blocks.js` | block/item registry, mining tiers & speeds, recipes, smelting, fuels |
| `world.js` | worldgen: biome map, height shaping, caves (3D fBm), ores, trees; chunk store; player-edit journal (survives unload/reload); gravity blocks |
| `player.js` | AABB voxel physics (walk/sprint/sneak/swim/fall), hunger/health/air, auto-eat, DDA block raycast |
| `entities.js` | mobs (wander/chase/flee AI, line-of-sight, arrows, daylight burn), item drops w/ magnet pickup |
| `mesher.js` | chunk → geometry w/ baked skylight + torch light, shader day/night, fog; column-cached hot path |
| `textures.js` | procedural 16px texture atlas painted at boot; item icons; crack stages |
| `engine.js` | renderer, streaming, lighting BFS, interaction, furnaces, spawning, saves, **GameAPI** |
| `hud.js` | hearts/food/air, hotbar, crafting & furnace UI, death screen, pause, agent panel |
| `agent.js` | scripted demo agent |

## Tests

`npm test` — 30 headless checks: noise determinism, worldgen/biomes/trees, chunk borders, edit persistence, mining-tier economy, recipe gating, inventory stacking, physics (landing, ledge falls, wall stops).

## License / IP

Original work. Textures, sounds and code are procedural/original — no Mojang assets. See `THIRD_PARTY.md` (three.js, MIT). "Minecraft" is a Mojang/Microsoft trademark; this is an independent genre-alike.