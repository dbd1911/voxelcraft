// VoxelCraft — block / item / recipe / mining registries.
// IDs <100 are placeable blocks; >=100 are pure items.

export const CHUNK_X = 16, CHUNK_Y = 64, CHUNK_Z = 16;
export const SEA = 23;
export const DAY_LENGTH = 1200; // seconds per full day/night (Minecraft-authentic 20 min)

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, WATER: 6, LOG: 7,
  LEAVES: 8, PLANKS: 9, BEDROCK: 10, COAL_ORE: 11, IRON_ORE: 12, GOLD_ORE: 13,
  DIAMOND_ORE: 14, SNOW: 15, GRAVEL: 16, CACTUS: 17, GLASS: 18, TORCH: 19,
  TABLE: 20, FURNACE: 21, WOOL: 22, FLOWER: 23, TALLGRASS: 24,
};

export const I = {
  STICK: 100, PICK_WOOD: 101, PICK_STONE: 102, PICK_IRON: 103, PICK_DIA: 104,
  SHOVEL_WOOD: 105, SHOVEL_STONE: 106, SHOVEL_IRON: 107, SHOVEL_DIA: 108,
  AXE_WOOD: 109, AXE_STONE: 110, AXE_IRON: 111, AXE_DIA: 112,
  SWORD_WOOD: 113, SWORD_STONE: 114, SWORD_IRON: 115, SWORD_DIA: 116,
  PORK_RAW: 117, PORK_COOKED: 118, BEEF_RAW: 119, BEEF_COOKED: 120, APPLE: 121,
  COAL: 122, IRON_INGOT: 123, GOLD_INGOT: 124, DIAMOND: 125,
};

// ---- Block registry -------------------------------------------------------
// tex: tile names resolved by textures.js. hard: seconds to break by hand.
// tier: minimum pickaxe tier required for the block to drop anything (0 = hand ok).
// tool: 'pickaxe'|'shovel'|'axe'|null — correct tool type speeds mining.
// drops: [[itemId|min 0 for blockId-self, minCount, maxCount]] or null.
export const BLOCKS = [
  /*0*/ { name: 'Air', solid: false },
  /*1*/ { name: 'Grass Block', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, solid: true, hard: 0.9, tool: 'shovel', tier: 0, drops: [[B.DIRT, 1, 1]] },
  /*2*/ { name: 'Dirt', tex: { all: 'dirt' }, solid: true, hard: 0.75, tool: 'shovel', tier: 0, drops: [[B.DIRT, 1, 1]] },
  /*3*/ { name: 'Stone', tex: { all: 'stone' }, solid: true, hard: 7.5, tool: 'pickaxe', tier: 1, drops: [[B.COBBLE, 1, 1]] },
  /*4*/ { name: 'Cobblestone', tex: { all: 'cobble' }, solid: true, hard: 8, tool: 'pickaxe', tier: 1, drops: [[B.COBBLE, 1, 1]] },
  /*5*/ { name: 'Sand', tex: { all: 'sand' }, solid: true, hard: 0.75, tool: 'shovel', tier: 0, drops: [[B.SAND, 1, 1]], gravity: true },
  /*6*/ { name: 'Water', tex: { all: 'water' }, solid: false, liquid: true, opaque: false },
  /*7*/ { name: 'Oak Log', tex: { top: 'log_top', side: 'log_side', bottom: 'log_top' }, solid: true, hard: 3, tool: 'axe', tier: 0, drops: [[B.LOG, 1, 1]] },
  /*8*/ { name: 'Oak Leaves', tex: { all: 'leaves' }, solid: true, opaque: false, hard: 0.35, tier: 0, drops: [[I.APPLE, 0.04, 1], [B.LEAVES, 0.06, 1]], leaves: true },
  /*9*/ { name: 'Oak Planks', tex: { all: 'planks' }, solid: true, hard: 3, tool: 'axe', tier: 0, drops: [[B.PLANKS, 1, 1]] },
  /*10*/ { name: 'Bedrock', tex: { all: 'bedrock' }, solid: true, unbreakable: true },
  /*11*/ { name: 'Coal Ore', tex: { all: 'coal_ore' }, solid: true, hard: 15, tool: 'pickaxe', tier: 1, drops: [[I.COAL, 1, 1]] },
  /*12*/ { name: 'Iron Ore', tex: { all: 'iron_ore' }, solid: true, hard: 15, tool: 'pickaxe', tier: 2, drops: [[B.IRON_ORE, 1, 1]] },
  /*13*/ { name: 'Gold Ore', tex: { all: 'gold_ore' }, solid: true, hard: 15, tool: 'pickaxe', tier: 3, drops: [[B.GOLD_ORE, 1, 1]] },
  /*14*/ { name: 'Diamond Ore', tex: { all: 'diamond_ore' }, solid: true, hard: 15, tool: 'pickaxe', tier: 3, drops: [[I.DIAMOND, 1, 1]] },
  /*15*/ { name: 'Snowy Grass', tex: { top: 'snow', side: 'snow_side', bottom: 'dirt' }, solid: true, hard: 0.9, tool: 'shovel', tier: 0, drops: [[B.DIRT, 1, 1]] },
  /*16*/ { name: 'Gravel', tex: { all: 'gravel' }, solid: true, hard: 0.9, tool: 'shovel', tier: 0, drops: [[B.GRAVEL, 1, 1]], gravity: true },
  /*17*/ { name: 'Cactus', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, solid: true, hard: 0.6, tier: 0, drops: [[B.CACTUS, 1, 1]], damage: 1 },
  /*18*/ { name: 'Glass', tex: { all: 'glass' }, solid: true, opaque: false, hard: 0.5, tier: 0, drops: null },
  /*19*/ { name: 'Torch', tex: { all: 'torch' }, solid: false, opaque: false, cross: true, hard: 0.1, tier: 0, drops: [[B.TORCH, 1, 1]], emission: 14, placeOnSolid: true },
  /*20*/ { name: 'Crafting Table', tex: { top: 'table_top', side: 'table_side', bottom: 'planks' }, solid: true, hard: 3.5, tool: 'axe', tier: 0, drops: [[B.TABLE, 1, 1]] },
  /*21*/ { name: 'Furnace', tex: { top: 'furnace_side', side: 'furnace_front', bottom: 'furnace_side' }, solid: true, hard: 8, tool: 'pickaxe', tier: 1, drops: [[B.FURNACE, 1, 1]] },
  /*22*/ { name: 'Wool', tex: { all: 'wool' }, solid: true, hard: 0.8, tier: 0, drops: [[B.WOOL, 1, 1]] },
  /*23*/ { name: 'Flower', tex: { all: 'flower_red' }, solid: false, opaque: false, cross: true, hard: 0.05, tier: 0, drops: null, needsSoil: true },
  /*24*/ { name: 'Tall Grass', tex: { all: 'tallgrass' }, solid: false, opaque: false, cross: true, hard: 0.05, tier: 0, drops: null, needsSoil: true },
];
for (const bl of BLOCKS) {
  if (bl.opaque === undefined) bl.opaque = !!bl.solid; // leaves/glass/torch/plants don't cull neighbors
}

// ---- Item registry --------------------------------------------------------
const TOOL_TIER = { wood: 1, stone: 2, iron: 3, diamond: 4 };
const TOOL_SPEED = { wood: 4, stone: 6, iron: 9, diamond: 12 };

export const ITEMS = {}; // id -> def
function item(id, name, extra = {}) { ITEMS[id] = { id, name, stack: 64, ...extra }; }

for (let id = 1; id < BLOCKS.length; id++) {
  if (id === B.AIR || id === B.WATER || id === B.FLOWER || id === B.TALLGRASS) continue;
  item(id, BLOCKS[id].name);
}
item(I.STICK, 'Stick');
const tool = (id, name, type, mat) => item(id, name, {
  stack: 1, tool: { type, tier: TOOL_TIER[mat], speed: TOOL_SPEED[mat] },
  dmg: name.includes('Sword') ? ({ wood: 4, stone: 5, iron: 6, diamond: 7 })[mat] : 1,
});
tool(I.PICK_WOOD, 'Wooden Pickaxe', 'pickaxe', 'wood');
tool(I.PICK_STONE, 'Stone Pickaxe', 'pickaxe', 'stone');
tool(I.PICK_IRON, 'Iron Pickaxe', 'pickaxe', 'iron');
tool(I.PICK_DIA, 'Diamond Pickaxe', 'pickaxe', 'diamond');
tool(I.SHOVEL_WOOD, 'Wooden Shovel', 'shovel', 'wood');
tool(I.SHOVEL_STONE, 'Stone Shovel', 'shovel', 'stone');
tool(I.SHOVEL_IRON, 'Iron Shovel', 'shovel', 'iron');
tool(I.SHOVEL_DIA, 'Diamond Shovel', 'shovel', 'diamond');
tool(I.AXE_WOOD, 'Wooden Axe', 'axe', 'wood');
tool(I.AXE_STONE, 'Stone Axe', 'axe', 'stone');
tool(I.AXE_IRON, 'Iron Axe', 'axe', 'iron');
tool(I.AXE_DIA, 'Diamond Axe', 'axe', 'diamond');
tool(I.SWORD_WOOD, 'Wooden Sword', 'sword', 'wood');
tool(I.SWORD_STONE, 'Stone Sword', 'sword', 'stone');
tool(I.SWORD_IRON, 'Iron Sword', 'sword', 'iron');
tool(I.SWORD_DIA, 'Diamond Sword', 'sword', 'diamond');
item(I.PORK_RAW, 'Raw Porkchop', { food: 3 });
item(I.PORK_COOKED, 'Cooked Porkchop', { food: 8 });
item(I.BEEF_RAW, 'Raw Beef', { food: 3 });
item(I.BEEF_COOKED, 'Steak', { food: 8 });
item(I.APPLE, 'Apple', { food: 4 });
item(I.COAL, 'Coal');
item(I.IRON_INGOT, 'Iron Ingot');
item(I.GOLD_INGOT, 'Gold Ingot');
item(I.DIAMOND, 'Diamond');

export const itemType = (id) => (id < 100 ? (id === B.WATER ? null : ITEMS[id]) : ITEMS[id]);

// Mining: returns { time, canDrop } — hand = hard seconds; matching tool divides by speed.
export function miningInfo(blockId, equippedItemId) {
  const bl = BLOCKS[blockId];
  if (!bl || !bl.solid && !bl.cross || bl.liquid || bl.unbreakable) return { time: Infinity, canDrop: false, ok: false };
  if (!bl.hard) return { time: 0, canDrop: false, ok: false };
  let speed = 1;
  const it = equippedItemId && itemType(equippedItemId);
  if (it && it.tool && bl.tool && it.tool.type === bl.tool) speed = it.tool.speed;
  const canDrop = (bl.tier || 0) === 0 || (it && it.tool && it.tool.type === bl.tool && it.tool.tier >= bl.tier);
  const time = canDrop ? bl.hard / speed : bl.hard * 3;
  return { time, canDrop, ok: true };
}

// ---- Crafting -------------------------------------------------------------
// ins: [[id,count],...]  out: [id,count]
export const RECIPES = [
  { key: 'planks', ins: [[B.LOG, 1]], out: [B.PLANKS, 4], table: false },
  { key: 'sticks', ins: [[B.PLANKS, 2]], out: [I.STICK, 4], table: false },
  { key: 'table', ins: [[B.PLANKS, 4]], out: [B.TABLE, 1], table: false },
  { key: 'torch', ins: [[I.STICK, 1], [I.COAL, 1]], out: [B.TORCH, 4], table: true },
  { key: 'furnace', ins: [[B.COBBLE, 8]], out: [B.FURNACE, 1], table: true },
  { key: 'pick_wood', ins: [[B.PLANKS, 3], [I.STICK, 2]], out: [I.PICK_WOOD, 1], table: true },
  { key: 'shovel_wood', ins: [[B.PLANKS, 1], [I.STICK, 2]], out: [I.SHOVEL_WOOD, 1], table: true },
  { key: 'axe_wood', ins: [[B.PLANKS, 3], [I.STICK, 2]], out: [I.AXE_WOOD, 1], table: true },
  { key: 'sword_wood', ins: [[B.PLANKS, 2], [I.STICK, 1]], out: [I.SWORD_WOOD, 1], table: true },
  { key: 'pick_stone', ins: [[B.COBBLE, 3], [I.STICK, 2]], out: [I.PICK_STONE, 1], table: true },
  { key: 'shovel_stone', ins: [[B.COBBLE, 1], [I.STICK, 2]], out: [I.SHOVEL_STONE, 1], table: true },
  { key: 'axe_stone', ins: [[B.COBBLE, 3], [I.STICK, 2]], out: [I.AXE_STONE, 1], table: true },
  { key: 'sword_stone', ins: [[B.COBBLE, 2], [I.STICK, 1]], out: [I.SWORD_STONE, 1], table: true },
  { key: 'pick_iron', ins: [[I.IRON_INGOT, 3], [I.STICK, 2]], out: [I.PICK_IRON, 1], table: true },
  { key: 'shovel_iron', ins: [[I.IRON_INGOT, 1], [I.STICK, 2]], out: [I.SHOVEL_IRON, 1], table: true },
  { key: 'axe_iron', ins: [[I.IRON_INGOT, 3], [I.STICK, 2]], out: [I.AXE_IRON, 1], table: true },
  { key: 'sword_iron', ins: [[I.IRON_INGOT, 2], [I.STICK, 1]], out: [I.SWORD_IRON, 1], table: true },
  { key: 'pick_diamond', ins: [[I.DIAMOND, 3], [I.STICK, 2]], out: [I.PICK_DIA, 1], table: true },
  { key: 'shovel_diamond', ins: [[I.DIAMOND, 1], [I.STICK, 2]], out: [I.SHOVEL_DIA, 1], table: true },
  { key: 'axe_diamond', ins: [[I.DIAMOND, 3], [I.STICK, 2]], out: [I.AXE_DIA, 1], table: true },
  { key: 'sword_diamond', ins: [[I.DIAMOND, 2], [I.STICK, 1]], out: [I.SWORD_DIA, 1], table: true },
];

// Furnace: fuel values in "items smelted per unit"
export const FUEL = { [I.COAL]: 8, [B.LOG]: 1.5, [B.PLANKS]: 1.5, [I.STICK]: 0.5 };
export const SMELT = { [B.IRON_ORE]: I.IRON_INGOT, [B.GOLD_ORE]: I.GOLD_INGOT, [I.PORK_RAW]: I.PORK_COOKED, [I.BEEF_RAW]: I.BEEF_COOKED, [B.SAND]: B.GLASS, [B.COBBLE]: B.STONE };

export function canCraft(recipe, inv, atTable) {
  if (recipe.table && !atTable) return false;
  return recipe.ins.every(([id, n]) => countItem(inv, id) >= n);
}
export function countItem(inv, id) {
  return inv.reduce((s, it) => s + (it && it.id === id ? it.count : 0), 0);
}