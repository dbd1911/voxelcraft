// VoxelCraft — bootstrap: canvas, pointer lock, main loop, panel wiring, agent hooks.
import { Engine } from './src/engine.js';
import { HUD } from './src/hud.js';
import { InputSystem } from './src/input.js';
import { runDemoAgent } from './src/agent.js';

const canvas = document.getElementById('game-canvas');
const qs = new URLSearchParams(location.search);
const engine = new Engine(canvas, null, { seed: qs.has('seed') ? +qs.get('seed') : undefined, gameMode: qs.get('mode') || 'survival' });
const hud = new HUD(engine);
engine.hud = hud;
engine.on.onCraftMenu = (open) => hud.toggleCraft(open);
engine.on.onFurnaceMenu = (hit) => hud.toggleFurnace([hit.x, hit.y, hit.z]);

const input = new InputSystem();
window.engine = engine;
window.game = engine.api();   // AI agent attaches here (Phase 2)

// ---------- pointer lock ----------
const uiRoot = document.getElementById('ui-root');
let locked = false;
canvas.addEventListener('click', () => {
  if (!locked && !hud.paused && !hud.craftOpen && !hud.furnaceOpen && !engine.player.dead) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
});
document.addEventListener('mousemove', (e) => {
  if (locked && !input.agentLocked) input.feedMouse(e.movementX, e.movementY);
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.target !== canvas) return;
  input.setButton(e.button, true);
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) input.setButton(0, false); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- panels ----------
function panelOpen() { return hud.craftOpen || !!hud.furnaceOpen || hud.paused; }
function syncPanels() {
  if (input.openCraft || input.openInv) hud.toggleCraft();
  if (hud.craftOpen || hud.furnaceOpen) {
    document.exitPointerLock && document.exitPointerLock();
  }
  if (input.pauseEdge) {
    if (hud.craftOpen) hud.toggleCraft(false);
    else if (hud.furnaceOpen) hud.toggleFurnace(null);
    else if (hud.paused) hud.closePause();
    else hud.openPause();
  }
}
// close buttons
document.getElementById('craft-close').onclick = () => hud.toggleCraft(false);
document.getElementById('furnace-close').onclick = () => hud.toggleFurnace(null);
// fuel button in furnace panel
document.getElementById('furnace-fuel').onclick = () => {
  if (!hud.furnaceOpen) return;
  const [x, y, z] = hud.furnaceOpen;
  const f = engine.furnaceStateAt(x, y, z);
  const have = f.fuel || 0;
  if (have > 2) { hud.toast('Furnace already fueled'); return; }
  engine.smeltStart(x, y, z, f.in ? f.in.id : 0, 0); // triggers auto-fuel attempt
  hud.renderFurnace();
};
// inventory click: move backpack item to hotbar
document.getElementById('inv-grid').addEventListener('click', (e) => {
  const slotEl = e.target.closest('[data-slot]');
  if (!slotEl) return;
  const i = +slotEl.dataset.slot;
  if (i < 9 || !engine.player.inv[i]) return;
  for (let j = 0; j < 9; j++) {
    if (!engine.player.inv[j]) { engine.player.inv[j] = engine.player.inv[i]; engine.player.inv[i] = null; break; }
  }
  hud.markInvDirty(); hud.renderCraft();
});

// ---------- agent panel ----------
document.getElementById('agent-toggle').onclick = () => {
  const p = document.getElementById('agent-body');
  p.classList.toggle('hidden');
};
document.getElementById('btn-demo-agent').onclick = async () => {
  document.getElementById('btn-demo-agent').disabled = true;
  try { await runDemoAgent(window.game); } finally { document.getElementById('btn-demo-agent').disabled = false; }
};
// show agent panel by default
document.getElementById('agent-panel').style.display = 'flex';

// keyboard: G toggles agent lock (human hands off / on)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG') {
    input.agentLocked = !input.agentLocked;
    hud.toast(input.agentLocked ? 'AI HAS CONTROL (press G to take over)' : 'Human control', input.agentLocked ? 'warn' : 'info');
  }
  if (e.code === 'KeyR') document.getElementById('debug').classList.toggle('hidden');
});

// ---------- main loop ----------
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { hud.fps(Math.round(fpsN / fpsAcc)); fpsAcc = 0; fpsN = 0; }

  const snap = input.sample();
  syncPanels();

  const paused = hud.paused || panelOpen();
  engine.paused = hud.paused; // craft/furnace panels don't pause the world

  if (!engine.player.dead) { }
  engine.frame(dt, snap);
  engine.renderLoop(dt);
  hud.update(dt);

  // if dead, release pointer
  if (engine.player.dead && locked) document.exitPointerLock();
}
loop();

// first-join toast
setTimeout(() => hud.toast('Click to play · WASD move · G hands off to AI'), 800);