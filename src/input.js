// VoxelCraft — input: keyboard + mouse (fed by main) + Gamepad API, agent-lock aware.
export class InputSystem {
  constructor() {
    this.forward = 0; this.strafe = 0; this.jump = false; this.sprint = false; this.sneak = false;
    this.breaking = false; this.placing = false; this.useEdge = false;
    this.lookDX = 0; this.lookDY = 0;
    this.hotbarNext = 0; this.hotbarPrev = 0; this.hotbarSel = -1;
    this.openCraft = false; this.openInv = false; this.pauseEdge = false; this.toggleFlyEdge = false;
    this.agentLocked = false; // when true, human input ignored (agent drives)
    this.gamepadActive = false;
    this._keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'KeyE') this.openInv = true;
      if (e.code === 'KeyC') this.openCraft = true;
      if (e.code === 'Escape') this.pauseEdge = true;
      if (e.code === 'KeyF') this.toggleFlyEdge = true;
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) this.hotbarSel = n - 1; }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
    window.addEventListener('wheel', (e) => { this.hotbarNext += e.deltaY > 0 ? 1 : -1; }, { passive: true });
    window.addEventListener('blur', () => this._keys.clear());
  }
  feedMouse(dx, dy) { this.lookDX += dx; this.lookDY += dy; }
  setButton(which, down) { // from main.js pointer events
    if (which === 0) this.mouseBreak = down;
    if (which === 2 && down) this.useEdge = true;
  }
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && Array.from(pads).find(x => x && x.connected);
    this.gamepadActive = !!p;
    if (!p) { this.gpRT = false; return; }
    const dz = (v) => Math.abs(v) < 0.16 ? 0 : v;
    this.lookDX += dz(p.axes[2] || 0) * 2.6 * 8;
    this.lookDY += dz(p.axes[3] || 0) * 1.8 * 8;
    this.padMove = { x: dz(p.axes[0] || 0), y: dz(p.axes[1] || 0) };
    const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const edge = (i, store) => { const now = btn(i); const was = this['gp_' + store]; this['gp_' + store] = now; return now && !was; };
    this.gpRT = btn(7);                    // RT hold = mine
    if (btn(6)) this.useEdge = true;       // LT = place/use
    if (edge(0, 'A')) this.jumpHeldEdge = true;
    this.jumpHeld = btn(0);                // A hold = jump/swim
    if (edge(3, 'Y')) this.openInv = true;
    if (edge(2, 'X')) this.openCraft = true;
    if (edge(9, 'Start')) this.pauseEdge = true;
    if (edge(12, 'Up')) this.toggleFlyEdge = true;  // D-pad Up = fly toggle (creative)
    if (edge(10, 'L3')) this.sprintToggle = !this.sprintToggle; // L3 click = sprint toggle
    this.sneak = btn(1);                   // B hold = sneak
    if (edge(4, 'LB')) this.hotbarPrev += 1;
    if (edge(5, 'RB')) this.hotbarNext += 1;
    this.gpDpadR = btn(15);
    this.gpDpadRPrev = edge(15, 'DR');     // consumed below
    if (this.gpDpadRPrev) this.hotbarNext += 1;
  }
  consume(dt) {
    // called once per frame by sim AFTER poll; returns and clears one-shot edges
  }

  sample() { // per-frame snapshot (consumes one-shots)
    this.pollGamepad();
    const k = this._keys;
    let fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (this.padMove) { fwd = clamp1(fwd + -this.padMove.y); str = clamp1(str + this.padMove.x); }
    const out = {
      forward: fwd, strafe: str,
      jump: k.has('Space') || this.jumpHeld,
      sprint: k.has('ShiftLeft') || !!this.sprintToggle,
      sneak: k.has('ControlLeft') || this.sneak || false,
      lookDX: this.lookDX, lookDY: this.lookDY,
      breaking: this.mouseBreak || k.has('KeyQ') || this.gpRT || false, useEdge: this.useEdge,
      hotbarNext: this.hotbarNext, hotbarPrev: this.hotbarPrev, hotbarSel: this.hotbarSel,
      openCraft: this.openCraft, openInv: this.openInv, pauseEdge: this.pauseEdge, toggleFlyEdge: this.toggleFlyEdge,
    };
    this.lookDX = 0; this.lookDY = 0;
    this.useEdge = false; this.openCraft = false; this.openInv = false; this.pauseEdge = false; this.toggleFlyEdge = false;
    this.hotbarNext = 0; this.hotbarPrev = 0; this.hotbarSel = -1; this.padMove = null; this.sneak = false;
    return out;
  }
}
function clamp1(v) { return v < -1 ? -1 : v > 1 ? v : v; }