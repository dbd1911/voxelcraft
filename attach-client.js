// VoxelCraft — AI attach client: connects the resident brain (local server hub) to window.game.
// Activated ONLY with ?ai in the URL — plain play is completely unaffected.
// Security model: explicit command whitelist (no eval), no cheat commands, outbound-only connection.

const isHeadless = /headless/i.test(navigator.userAgent);
const openQs = new URLSearchParams(location.search).get('attach') === 'free';
let ws = null;
let attempts = 0;
const pending = new Map();
let cmdSeq = 0;

// ---- explicit command surface (mirrors GameAPI; cheats deliberately absent) ----
const safeCmds = {
  state: () => window.game.state(),
  inventory: () => window.game.inventory(),
  recentEvents: (n) => window.game.recentEvents(n || 30),
  nearestBlock: (kind) => window.game.nearestBlock(kind),
  blocksAround: (r) => window.game.blocksAround(r || 6),
  faceTo: (x, z) => {
    const g = window.game, e = g.e, P = e.player;
    P.yaw = Math.atan2(-(x - P.x), -(z - P.z));
    // auto-aim: pick the pitch whose ray hits the nearest block (so mine() actually has a target)
    const oldPitch = P.pitch;
    let bestPitch = oldPitch, bestDist = Infinity;
    for (let p = -35; p <= 60; p += 5) {
      P.pitch = p * Math.PI / 180;
      const hit = e.raycastFromCamera();
      if (hit && hit.dist < bestDist) { bestDist = hit.dist; bestPitch = P.pitch; }
    }
    if (bestDist < Infinity) P.pitch = bestPitch; else P.pitch = oldPitch;
    return 'ok';
  },
  lookAbs: (yawDeg, pitchDeg) => { window.game.lookAbs(yawDeg, pitchDeg); return 'ok'; },
  jump: () => { const p = window.game.e.player; if (!p.dead) p.vel.y = 8.6; return 'ok'; },
  stopMove: () => { window.game.stopMove(); return 'ok'; },
  goto: (x, z, maxSec) => window.game.goto(x, z, maxSec || 60),
  mine: (seconds) => window.game.mine(seconds || 4),
  place: () => window.game.place(),
  attack: () => window.game.attack(),
  craft: (key) => window.game.craft(key),
  recipes: () => window.game.recipes(),
  selectSlot: (i) => { const h = window.game.selectSlot(i); return h || null; },
  smelt: (itemName) => window.game.smelt(itemName),
  collectFurnace: () => window.game.collectFurnace(),
  burrow: () => window.game.burrow(),
  chat: (m) => { window.game.chat(String(m).slice(0, 140)); return 'ok'; },
  screenshot: (width) => window.game.screenshotDataURL(width || 480),
  respawn: () => { window.game.respawn(); return 'ok'; },
  save: () => { window.game.save(); return 'ok'; },
};

const send = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  try { ws = new WebSocket(protocol + '://' + location.host + '/ws'); }
  catch (e) { reconnect(); return; }

  ws.onopen = () => {
    attempts = 0;
    send({ type: 'hello', game: 'voxelcraft', href: location.href, headless: isHeadless, title: document.title });
    if (!isHeadless) window.game.chat('🤖 Resident attaching…');
  };

  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'attach') {
      window.game.e.hook.agent = true;   // engine keeps sim ticking in dead state + auto-respawn
      window.game.e.hook.autoRespawn = true;
      window.game.chat('🤖 Resident online. Living independently now.');
      window.game.e._logEvent('agent', 'resident attached');
    } else if (m.type === 'poke') {
      try { send({ type: 'state', data: window.game.state(), events: window.game.recentEvents(12), errs: (window.__errs || []).slice(-3) }); } catch { }
    } else if (m.type === 'cmd') {
      const fn = safeCmds[m.cmd];
      const reply = (data, error) => send({ type: 'result', id: m.id, ok: !error, data, error: error || undefined });
      if (!fn) return reply(null, 'unknown command: ' + m.cmd);
      try {
        Promise.resolve(fn(...(m.args || [])))
          .then(d => reply(d))
          .catch(e => reply(null, String((e && e.message) || e)));
      } catch (e) { reply(null, String((e && e.message) || e)); }
    } else if (m.type === 'detach') {
      window.game.e.hook.agent = false;
      if (m.reason === 'wrongWorld' && Number.isFinite(m.canonicalSeed)) {
        const u = new URL(location.href);
        const cur = u.searchParams.get('seed');
        if (String(m.canonicalSeed) !== cur) {
          u.searchParams.set('seed', String(m.canonicalSeed));
          location.replace(u.pathname + '?' + u.searchParams.toString());
          return;
        }
      }
      window.game.chat('🤖 Resident detached. You have control.');
    }
  };

  ws.onclose = () => { reconnect(); };
  ws.onerror = () => { try { ws.close(); } catch { } };
}

function reconnect() {
  attempts++;
  const delay = Math.min(30000, 1500 * attempts);
  setTimeout(connect, delay);
}

connect();

// ---- outbound telemetry (2s cadence — not game-tick) ----
setInterval(() => {
  if (ws && ws.readyState === 1) {
    try { send({ type: 'state', data: window.game.state(), events: window.game.recentEvents(12), errs: (window.__errs || []).slice(-3) }); } catch { }
  }
}, 2000);