// VoxelCraft — procedural texture atlas + item icons. Everything painted at runtime; no image assets.
import { mulberry32 } from './noise.js';
import { B, I, BLOCKS, ITEMS } from './blocks.js';

const T = 16, ATLAS_TILES = 16; // 16px tiles, 16x16 atlas grid

// tiny pixel helpers
function P(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function fillNoise(ctx, base, vary, rng, alpha) {
  if (alpha !== undefined) ctx.clearRect(0, 0, T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const n = (rng() - 0.5) * 2 * vary;
    ctx.fillStyle = shift(base, n);
    if (alpha !== undefined) ctx.globalAlpha = alpha * 255;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}
function shift(hex, amt) { // amt -1..1 lightens/darkens
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function blob(ctx, rng, cx, cy, rad, color) {
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    if (x * x + y * y <= rad * rad + rng() * 1.5 - 0.5) P(ctx, cx + x, cy + y, color);
  }
}

export const TILE_PAINTERS = {
  grass_top(c, r) { fillNoise(c, '#7CBD4B', 0.13, r); },
  grass_side(c, r) {
    fillNoise(c, '#8A6244', 0.14, r);
    for (let x = 0; x < T; x++) { const d = 3 + Math.floor(r() * 2); for (let y = 0; y < d; y++) P(c, x, y, shift('#7CBD4B', (r() - 0.5) * 0.25)); }
  },
  dirt(c, r) { fillNoise(c, '#8A6244', 0.16, r); },
  stone(c, r) { fillNoise(c, '#8E8E8E', 0.09, r); for (let i = 0; i < 5; i++) blob(c, r, Math.floor(r() * 16), Math.floor(r() * 16), 1 + Math.floor(r() * 2), shift('#8E8E8E', -(0.1 + r() * 0.1))); },
  cobble(c, r) {
    fillNoise(c, '#7A7A7A', 0.05, r);
    const cells = [[0, 0, 7, 7], [8, 0, 8, 5], [0, 8, 5, 8], [6, 6, 5, 5], [12, 6, 4, 6], [6, 12, 10, 4]];
    for (const [x0, y0, w, h] of cells) {
      for (let y = y0; y < y0 + h && y < T; y++) for (let x = x0; x < x0 + w && x < T; x++) {
        const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        P(c, x, y, shift('#8A8A8A', (r() - 0.5) * 0.22 + (edge ? -0.28 : 0.05)));
      }
    }
  },
  sand(c, r) { fillNoise(c, '#DCD3A0', 0.07, r); },
  water(c, r) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      P(c, x, y, shift('#3D57D6', (r() - 0.5) * 0.12 + Math.sin((x + y) * 0.8) * 0.04));
    }
  },
  log_top(c, r) {
    fillNoise(c, '#6B5233', 0.05, r);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (Math.floor(d) % 2 === 0) P(c, x, y, shift('#8A6F47', (r() - 0.5) * 0.1));
    }
  },
  log_side(c, r) { fillNoise(c, '#6B5233', 0.09, r); for (let x = 0; x < T; x += 2 + Math.floor(r() * 2)) for (let y = 0; y < T; y++) P(c, x, y, shift('#543F24', (r() - 0.5) * 0.15)); },
  leaves(c, r) {
    c.clearRect(0, 0, T, T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (r() < 0.12) continue; // hole
      P(c, x, y, shift('#3E7A2E', (r() - 0.5) * 0.35));
    }
  },
  planks(c, r) {
    fillNoise(c, '#B08D55', 0.08, r);
    for (let y = 3; y < T; y += 4) for (let x = 0; x < T; x++) P(c, x, y, shift('#8A6B3A', (r() - 0.5) * 0.1));
    P(c, 4, 1, '#7A5C30'); P(c, 10, 5, '#7A5C30'); P(c, 13, 9, '#7A5C30'); P(c, 6, 13, '#7A5C30');
  },
  bedrock(c, r) { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) P(c, x, y, shift(r() < 0.5 ? '#3A3A3A' : '#575757', (r() - 0.5) * 0.2)); },
  coal_ore(c, r) { stonePaint(c, r); for (let i = 0; i < 4; i++) blob(c, r, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), '#2B2B2B'); },
  iron_ore(c, r) { stonePaint(c, r); for (let i = 0; i < 4; i++) blob(c, r, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), '#D8AF93'); },
  gold_ore(c, r) { stonePaint(c, r); for (let i = 0; i < 4; i++) blob(c, r, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), '#FCEE4B'); },
  diamond_ore(c, r) { stonePaint(c, r); for (let i = 0; i < 4; i++) blob(c, r, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), '#4AEDD9'); },
  snow(c, r) { fillNoise(c, '#F2FBFB', 0.03, r); },
  snow_side(c, r) {
    fillNoise(c, '#8A6244', 0.14, r);
    for (let x = 0; x < T; x++) { const d = 3 + Math.floor(r() * 2); for (let y = 0; y < d; y++) P(c, x, y, '#F2FBFB'); }
  },
  gravel(c, r) { fillNoise(c, '#867C7C', 0.1, r); for (let i = 0; i < 8; i++) blob(c, r, Math.floor(r() * 16), Math.floor(r() * 16), 1, shift('#867C7C', (r() - 0.5) * 0.5)); },
  cactus_top(c, r) { fillNoise(c, '#0F6B22', 0.08, r); for (let i = 0; i < 10; i++) P(c, Math.floor(r() * 16), Math.floor(r() * 16), '#8FD67A'); },
  cactus_side(c, r) { fillNoise(c, '#0F6B22', 0.08, r); for (let x = 1; x < T; x += 4) for (let y = 0; y < T; y++) P(c, x, y, '#0A4A18'); for (let i = 0; i < 8; i++) P(c, Math.floor(r() * 16), Math.floor(r() * 16), '#DFF7CF'); },
  glass(c, r) {
    c.clearRect(0, 0, T, T);
    c.fillStyle = 'rgba(210,235,245,0.35)'; c.fillRect(0, 0, T, T);
    c.fillStyle = '#DAF0F5';
    c.fillRect(0, 0, T, 1); c.fillRect(0, T - 1, T, 1); c.fillRect(0, 0, 1, T); c.fillRect(T - 1, 0, 1, T);
    for (let i = 0; i < 5; i++) P(c, 3 + i, 8 - i, '#FFFFFF');
  },
  torch(c, r) {
    c.clearRect(0, 0, T, T);
    for (let y = 6; y < 16; y++) { P(c, 7, y, '#8A6F47'); P(c, 8, y, '#6B5233'); }
    P(c, 7, 4, '#FFD83D'); P(c, 8, 4, '#FFD83D'); P(c, 7, 5, '#FFAA00'); P(c, 8, 5, '#FFAA00'); P(c, 7, 3, '#FFF3B0'); P(c, 8, 3, '#FFE580');
  },
  table_top(c, r) {
    TILE_PAINTERS.planks(c, r);
    c.fillStyle = '#6B4E26'; c.fillRect(0, 0, T, 1); c.fillRect(0, 0, 1, T); c.fillRect(15, 0, 1, T); c.fillRect(0, 15, T, 1);
    c.fillRect(7, 0, 1, 7); c.fillRect(0, 7, 7, 1);
  },
  table_side(c, r) {
    TILE_PAINTERS.planks(c, r);
    c.fillStyle = '#6B4E26'; c.fillRect(0, 0, T, 2);
    P(c, 3, 4, '#555'); P(c, 4, 4, '#999'); P(c, 11, 4, '#C8C8C8'); P(c, 12, 4, '#555');
  },
  furnace_side(c, r) { TILE_PAINTERS.cobble(c, r); },
  furnace_front(c, r) {
    TILE_PAINTERS.cobble(c, r);
    c.fillStyle = '#2B2B2B'; c.fillRect(4, 7, 8, 7);
    for (let x = 5; x < 11; x++) P(c, x, 12, '#FF9500');
    P(c, 6, 11, '#FFD83D'); P(c, 9, 11, '#FFD83D'); P(c, 7, 10, '#FFAA00');
  },
  wool(c, r) { fillNoise(c, '#E8E8E8', 0.06, r); },
  flower_red(c, r) {
    c.clearRect(0, 0, T, T);
    for (let y = 8; y < 15; y++) P(c, 8, y, '#3E7A2E');
    P(c, 7, 10, '#3E7A2E'); P(c, 9, 12, '#3E7A2E');
    blob(c, r, 8, 5, 2, '#D43B3B'); P(c, 8, 5, '#FFD83D');
  },
  tallgrass(c, r) {
    c.clearRect(0, 0, T, T);
    for (let i = 0; i < 6; i++) {
      const x0 = 2 + Math.floor(r() * 12), h = 6 + Math.floor(r() * 8);
      for (let y = 15; y > 15 - h; y--) P(c, Math.min(T - 1, Math.max(0, x0 + Math.floor(Math.sin(y * 0.7 + i) * 1.2))), y, shift('#5E9C3A', (r() - 0.5) * 0.3));
    }
  },
};
function stonePaint(c, r) { TILE_PAINTERS.stone(c, r); }

// ---------------- atlas ----------------
let atlas = null;
export function buildAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = T * ATLAS_TILES;
  const ctx = canvas.getContext('2d');
  const names = Object.keys(TILE_PAINTERS);
  const idx = {};
  names.forEach((name, i) => {
    const tx = (i % ATLAS_TILES) * T, ty = Math.floor(i / ATLAS_TILES) * T;
    ctx.save(); ctx.translate(tx, ty);
    ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip();
    TILE_PAINTERS[name](ctx, mulberry32(1000 + i * 77));
    ctx.restore();
    idx[name] = i;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  atlas = { canvas, texture, idx, tileCount: names.length };
  return atlas;
}
// uv rect for tile name (v flipped: three.js uv origin bottom-left)
export function tileUV(name) {
  const a = buildAtlas();
  const i = a.idx[name];
  const u0 = (i % ATLAS_TILES) / ATLAS_TILES, v1 = 1 - Math.floor(i / ATLAS_TILES) / ATLAS_TILES;
  return [u0, v1 - 1 / ATLAS_TILES, u0 + 1 / ATLAS_TILES, v1];
}
export function tileIndex(name) { return buildAtlas().idx[name]; }

// ---------------- block -> representative tile for icons/drops -------------
export function blockTile(id) {
  const b = BLOCKS[id];
  if (!b || !b.tex) return null;
  return b.tex.side || b.tex.all || b.tex.top;
}

// ---------------- item icons (32x32 canvases) ----------------
const iconCache = {};
export function itemIcon(id) {
  if (iconCache[id]) return iconCache[id];
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  const it = ITEMS[id];
  if (it && id < 100 && BLOCKS[id] && BLOCKS[id].tex) {
    const a = buildAtlas(); const t = blockTile(id);
    const i = a.idx[t]; const sx = (i % ATLAS_TILES) * T, sy = Math.floor(i / ATLAS_TILES) * T;
    if (id === B.TORCH || id === B.FLOWER || id === B.TALLGRASS) c.drawImage(a.canvas, sx, sy, T, T, 4, 4, 24, 24);
    else {
      // pseudo-3d cube icon: top skewed + front
      c.drawImage(a.canvas, sx, sy, T, T, 2, 8, 20, 20); // front
      c.globalAlpha = 0.7;
      c.drawImage(a.canvas, sx, sy, T, T, 2, 2, 20, 8); // top band
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(22, 8, 8, 20);
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(2, 2, 20, 6);
    }
  } else drawItemPixels(c, id);
  iconCache[id] = cv;
  return cv;
}

function drawItemPixels(c, id) {
  const line = (x0, y0, x1, y1, col, w = 2) => {
    const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 0; i <= n; i++) { c.fillStyle = col; c.fillRect(Math.round(x0 + dx * i / n), Math.round(y0 + dy * i / n), w, w); }
  };
  const H = '#8A6F47', D = '#6B5233';
  const mats = { wood: '#9C7A45', stone: '#8E8E8E', iron: '#D8D8D8', diamond: '#4AEDD9' };
  const mat = id >= I.PICK_WOOD && id <= I.SWORD_DIA ? mats[['wood', 'stone', 'iron', 'diamond'][Math.floor((id - I.PICK_WOOD) / 4)]] : null;
  switch (id) {
    case I.STICK: line(8, 24, 24, 8, H); break;
    case I.PICK_WOOD: case I.PICK_STONE: case I.PICK_IRON: case I.PICK_DIA:
      line(7, 25, 22, 10, H);
      line(6, 9, 26, 7, mat); line(5, 12, 26, 10, mat, 1); line(8, 6, 24, 4, mat, 1);
      break;
    case I.SHOVEL_WOOD: case I.SHOVEL_STONE: case I.SHOVEL_IRON: case I.SHOVEL_DIA:
      line(8, 26, 20, 14, H);
      c.fillStyle = mat; c.fillRect(18, 4, 8, 9); c.clearRect(19, 4, 6, 2);
      break;
    case I.AXE_WOOD: case I.AXE_STONE: case I.AXE_IRON: case I.AXE_DIA:
      line(8, 26, 21, 13, H);
      c.fillStyle = mat; c.fillRect(14, 4, 10, 9); c.clearRect(21, 8, 3, 5); c.clearRect(14, 4, 3, 3);
      break;
    case I.SWORD_WOOD: case I.SWORD_STONE: case I.SWORD_IRON: case I.SWORD_DIA:
      line(12, 12, 25, 3, mat, 3); line(25, 2, 27, 2, mat, 1);
      line(7, 12, 13, 18, '#5A4428', 2); line(10, 8, 14, 12, '#8A6F47', 2);
      break;
    case I.PORK_RAW: case I.PORK_COOKED: case I.BEEF_RAW: case I.BEEF_COOKED: {
      const meat = id === I.PORK_RAW ? '#F4A69B' : id === I.PORK_COOKED ? '#B4713F' : id === I.BEEF_RAW ? '#C0392B' : '#8B4A2B';
      blob(c, { } , 0, 0, 0, ''); // noop keeps jshint calm
      c.fillStyle = meat; c.fillRect(8, 8, 16, 14);
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(8, 8, 16, 3);
      c.fillStyle = '#F5F0E1'; c.fillRect(22, 18, 6, 3); c.fillRect(24, 21, 3, 4);
      break;
    }
    case I.APPLE:
      c.fillStyle = '#D43B3B'; c.fillRect(9, 10, 14, 13);
      c.fillRect(8, 12, 16, 9); c.fillStyle = '#F5F0E1'; c.fillRect(11, 12, 2, 4);
      c.fillStyle = '#5A4428'; c.fillRect(15, 6, 2, 4); c.fillStyle = '#3E7A2E'; c.fillRect(17, 7, 3, 2);
      break;
    case I.COAL: c.fillStyle = '#2B2B2B'; c.fillRect(9, 10, 13, 12); c.fillRect(11, 8, 9, 16); c.fillStyle = '#4A4A4A'; c.fillRect(12, 11, 3, 3); break;
    case I.IRON_INGOT: c.fillStyle = '#D8D8D8'; c.fillRect(7, 13, 18, 9); c.fillStyle = '#F5F5F5'; c.fillRect(7, 13, 18, 3); c.fillStyle = '#9C9C9C'; c.fillRect(7, 19, 18, 3); break;
    case I.GOLD_INGOT: c.fillStyle = '#FCEE4B'; c.fillRect(7, 13, 18, 9); c.fillStyle = '#FFF9A0'; c.fillRect(7, 13, 18, 3); c.fillStyle = '#C8B428'; c.fillRect(7, 19, 18, 3); break;
    case I.DIAMOND: c.fillStyle = '#4AEDD9'; c.fillRect(11, 10, 10, 4); c.fillRect(9, 14, 14, 4); c.fillRect(12, 18, 8, 3); c.fillRect(14, 21, 4, 2); c.fillStyle = '#CFFCf5'; c.fillRect(12, 11, 3, 2); break;
  }
}

// crack overlay textures (10 stages)
let cracks = null;
export function crackTextures() {
  if (cracks) return cracks;
  cracks = [];
  for (let s = 0; s < 10; s++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = T;
    const c = cv.getContext('2d');
    const r = mulberry32(999); // same crack layout, growing
    const strokes = 2 + s * 3;
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * T), y = Math.floor(r() * T);
      const len = 2 + Math.floor(r() * 5);
      const dx = Math.floor(r() * 3) - 1, dy = Math.floor(r() * 3) - 1;
      const active = i < strokes;
      if (!active) continue;
      c.fillStyle = 'rgba(20,20,20,0.85)';
      for (let k = 0; k < len; k++) c.fillRect((x + dx * k + T) % T, (y + dy * k + T) % T, 1, 1);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    cracks.push(tex);
  }
  return cracks;
}