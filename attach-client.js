// VoxelCraft — AI attach client v3.
// v3 changes:
//  - Web Locks single-tab guard: only ONE game tab in this browser ever connects (no ping-pong)
//  - clientVersion: 3 stamped on hello (hub rejects stale versions with a reload request)
//  - detach reasons handled: oldClient → reload; wrongWorld → reload with canonical seed
// Security model: explicit command whitelist (no eval), no cheat commands, outbound-only.
const CLIENT_VERSION = 3;

const isHeadless = /headless/i.test(navigator.userAgent);
let ws = null;
let connected = false;

const safeCmds = {
  state: () => window.game.state(),
  inventory: () => window.game.inventory(),
  recentEvents: (n) => window.game.recentEvents(n || 30),
  nearestBlock: (kind) => window.game.nearestBlock(kind),
  blocksAround: (r) => window.game.blocksAround(r || 6),
  faceTo: (x, z) => {
    const g = window.game, e = g.e, P = e.player;
    P.yaw = Math.atan2(-(x - P.x), -(z - P.z));
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

function attachHandlers() {
  ws.onopen = () => {
    send({ type: 'hello', game: 'voxelcraft', href: location.href, headless: isHeadless, clientVersion: CLIENT_VERSION, href: location.href });
    if (!isHeadless) window.game.chat('🤖 Resident attaching…');
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'attach') {
      connected = true;
      window.game.e.hook.agent = true;
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
        Promise.resolve(fn(...(m.args || []))).then(d => reply(d)).catch(e => reply(null, String((e && e.message) || e)));
      } catch (e) { reply(null, String((e && e.message) || e)); }
    } else if (m.type === 'detach') {
      window.game.e.hook.agent = false;
      if (m.reason === 'oldClient') { location.reload(); return; }
      if (m.reason === 'wrongWorld' && Number.isFinite(m.canonicalSeed)) {
        const u = new URL(location.href);
        if (String(m.canonicalSeed) !== u.searchParams.get('seed')) {
          u.searchParams.set('seed', String(m.canonicalSeed));
          location.replace(u.pathname + '?' + u.searchParams.toString());
          return;
        }
      }
      if (m.reason === 'superseded') {
        // another tab took over: stop connecting (Web Locks will arbitrate who's live)
        try { ws.close(); } catch { }
        return;
      }
      window.game.chat('🤖 Resident detached.');
    }
  };
  ws.onclose = () => {
    connected = false;
    if (ws && ws.readyState !== 1 && !ws.__doNotRetry) setTimeout(pollAndConnect, Math.min(20000, 2500));
  };
  ws.onerror = () => { try { ws.close(); } catch { } };
}

function pollAndConnect() {
  // only connect when this tab owns the browser-wide slot lock
  if (!navigator.locks) { openSocket(); return; } // old browser: best-effort (hub arbiter still guards)
  navigator.locks.request('voxelcraft_resident_slot', { ifAvailable: true }, async (lock) => {
    if (!lock) return; // another tab holds it — stay idle; retry later
    openSocket();
    await new Promise(res => { pollAndConnect._release = res; }); // hold lock while connected
  });
}

function openSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  try { ws = new WebSocket(protocol + '://' + location.host + '/ws'); }
  catch { setTimeout(pollAndConnect, 4000); return; }
  ws.__doNotRetry = false;
  attachHandlers();
  // wait for close → release the lock so another tab can take over
  const origClose = ws.onclose;
  ws.addEventListener('close', () => { if (pollAndConnect._release) { pollAndConnect._release(); pollAndConnect._release = null; } });
}

// periodic watch: if another tab died, this tab can pick the slot up (when lock free) —
// pollAndConnect is re-invoked on a slow cadence when not connected
setInterval(() => { if (!connected) pollAndConnect(); }, 8000);
pollAndConnect();