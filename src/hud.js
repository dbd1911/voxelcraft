// VoxelCraft — HUD: hotbar, health/food/air, debug, toast, craft & furnace panels, death/pause, agent panel.
import { I, BLOCKS, ITEMS, RECIPES, countItem, canCraft, itemType } from './blocks.js';
import { itemIcon } from './textures.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(engine) {
    this.e = engine;
    this.pane = $('hud');
    this.root = $('ui-root');
    this.craftOpen = false;
    this.furnaceOpen = null; // [x,y,z] or null
    this.paused = false;
    this._lastHud = 0;
    this.buildStatic();
    this.toastMsg = null; this.toastT = 0;
  }

  toast(msg, kind = 'info') {
    this.toastMsg = msg; this.toastKind = kind; this.toastT = 2.6;
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind === 'warn' ? ' warn' : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.className = 'toast', 2400);
  }
  chatMsg(who, msg) {
    const box = $('chatlog');
    const div = document.createElement('div');
    div.textContent = (who ? '<' + who + '> ' : '') + msg;
    box.appendChild(div);
    box.appendChild(document.createElement('div'));
    while (box.children.length > 12) box.removeChild(box.firstChild);
  }
  death(on, cause) {
    const d = $('death-screen');
    if (on) { d.style.display = 'flex'; $('death-cause').textContent = cause ? 'You ' + cause : 'You died'; }
    else d.style.display = 'none';
  }

  buildStatic() {
    // hotbar slots
    const hb = $('hotbar');
    hb.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot'; s.dataset.i = i;
      s.title = (i + 1);
      hb.appendChild(s);
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyR') $('debug').classList.toggle('hidden');
    });
    // pause menu buttons
    $('btn-resume').onclick = () => this.closePause();
    $('btn-save').onclick = () => { this.e.saveNow(); };
    $('btn-mode').onclick = () => { this.e.toggleGameMode(); $('mode-label').textContent = this.e.player.gameMode; };
    $('btn-new').onclick = () => {
      const seed = Math.floor(Math.random() * 2 ** 31);
      localStorage.removeItem('voxelcraft_save');
      location.href = location.pathname + '?seed=' + seed;
    };
    $('btn-help').onclick = () => { $('help').classList.toggle('hidden'); this.e.paused = $('help').classList.contains('hidden') ? false : true; };
    // render distance
    const rd = $('render-dist');
    rd.value = this.e.viewChunks;
    rd.oninput = () => { this.e.viewChunks = +rd.value; $('rd-label').textContent = rd.value; };
    // respawn button
    $('btn-respawn').onclick = () => { this.e.respawnPlayer(); this.death(false); };
  }

  closePause() { this.paused = false; $('pause-menu').style.display = 'none'; }

  openPause() {
    this.paused = true;
    $('pause-menu').style.display = 'flex';
    $('mode-label').textContent = this.e.player.gameMode;
  }

  toggleCraft(force) {
    this.craftOpen = force !== undefined ? force : !this.craftOpen;
    $('craft-panel').style.display = this.craftOpen ? 'flex' : 'none';
    if (this.craftOpen) this.renderCraft();
  }
  toggleFurnace(pos) {
    this.furnaceOpen = pos;
    const p = $('furnace-panel');
    p.style.display = pos ? 'flex' : 'none';
    if (pos) this.renderFurnace();
  }

  renderCraft() {
    const inv = this.e.player.inv;
    const atTable = this.e._nearTable ? this.e._nearTable() : false;
    const wrap = $('craft-list');
    wrap.innerHTML = '';
    $('craft-mode-label').textContent = atTable ? 'Crafting Table' : 'Hand (basic recipes)';
    const rec = RECIPES.slice().sort((a, b) => (canCraft(a, inv, atTable) ? 0 : 1) - (canCraft(b, inv, atTable) ? 0 : 1));
    for (const r of rec) {
      const ok = canCraft(r, inv, atTable);
      const div = document.createElement('div');
      div.className = 'recipe' + (ok ? ' ok' : '');
      const icon = itemIcon(r.out[0]).toDataURL();
      div.innerHTML = '<img src="' + icon + '" width="28" height="28"/><span class="rname">' + r.key.replace(/_/g, ' ') + (r.out[1] > 1 ? ' x' + r.out[1] : '') + '</span><span class="rmat">' +
        r.ins.map(([id, n]) => (ITEMS[id] ? ITEMS[id].name : BLOCKS[id].name) + ' x' + n).join(', ') + '</span>' +
        (r.table ? '<span class="rneed">[table]</span>' : '');
      if (ok) div.onclick = () => { const msg = this.e.api().craft(r.key); this.toast(msg); this.renderCraft(); this.renderHotbar(); };
      wrap.appendChild(div);
    }
  }

  renderFurnace() {
    if (!this.furnaceOpen) return;
    const [x, y, z] = this.furnaceOpen;
    const f = this.e.furnaceStateAt(x, y, z);
    $('furnace-state').textContent = f.burn > 0 ? 'Burning (' + Math.ceil(f.burn) + 's left)' : (f.in ? 'Has input, needs fuel' : 'Idle');
    $('furnace-io').textContent = 'In: ' + (f.in ? ITEMS[f.in.id].name + ' x' + f.in.count : '—') +
      '   Fuel store: ' + (f.fuel || 0).toFixed(1) + ' items' +
      '   Out: ' + (f.out ? ITEMS[f.out.id].name + ' x' + f.out.count : '—');
  }

  renderHotbar() {
    const inv = this.e.player.inv, sel = this.e.player.sel;
    const slots = $('hotbar').children;
    for (let i = 0; i < 9; i++) {
      const el = slots[i], s = inv[i];
      el.classList.toggle('sel', i === sel);
      if (!s) { el.innerHTML = ''; continue; }
      const icon = itemIcon(s.id).toDataURL();
      el.innerHTML = '<img draggable="false" src="' + icon + '"/>' + (s.count > 1 ? '<b>' + s.count + '</b>' : '');
    }
  }

  update(dt) {
    const P = this.e.player;
    this.toastT -= dt;
    // hearts & food & air
    this._bars($('hearts'), Math.ceil(P.hp / 2), 10, '#E3352C');
    this._bars($('food'), Math.ceil(P.food / 2), 10, '#B4632F');
    $('air-row').style.display = P.air < 300 ? 'flex' : 'none';
    this._bars($('air'), Math.ceil((P.air / 300) * 10), 10, '#5FB4E5');
    if (this._lh !== P.hp || this._lf !== P.food) {
      this._lh = P.hp; this._lf = P.food;
    }
    // hotbar refresh when dirty
    if (this._dirtyInv) { this.renderHotbar(); this._dirtyInv = false; }
    this._invKey = JSON.stringify(P.inv) + P.sel;
    if (this._invKey !== this._lastInvKey) {
      this._lastInvKey = this._invKey;
      this.renderHotbar();
      if (this.craftOpen) this.renderCraft();
    }
    // debug line
    const dbl = $('debug-inline');
    dbl.textContent = 'XYZ ' + P.x.toFixed(1) + ' / ' + P.y.toFixed(1) + ' / ' + P.z.toFixed(1) +
      '  ·  Day ' + this.e.dayNumber() + ' ' + this._clockStr() +
      '  ·  ' + this.e.player.gameMode +
      '  ·  FPS ' + (this.e._fps || '-');
    // torch count
    const tp = $('torch-hint');
    if (tp) tp.textContent = this.e.torchMap.size ? this.e.torchMap.size + ' torches lit' : '';
    if (this.furnaceOpen) this.renderFurnace();
    // agent panel status
    const A = this.e.agent;
    if (A && $('agent-panel').style.display !== 'none') {
      const st = A.status();
      $('agent-status').textContent = st;
      const el = $('agent-events');
      const evs = this.e.eventLog.slice(-8);
      el.textContent = evs.map(x => '• ' + x.kind + ': ' + x.text).join('\n');
    }
  }
  _clockStr() {
    const t = (this.e.time % 1200) / 1200;
    const hours = Math.floor(((t * 24) + 6) % 24);
    const mins = Math.floor((((t * 24) + 6) % 1) * 60);
    return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }
  _bars(el, n, total, color) {
    if (el.dataset.n === String(n) && el.dataset.c === color) return;
    el.dataset.n = String(n); el.dataset.c = color;
    el.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      d.style.background = i < n ? color : 'rgba(0,0,0,0.35)';
      el.appendChild(d);
    }
  }
  markInvDirty() { this._dirtyInv = true; }
  fps(v) { this.e._fps = v; }
}