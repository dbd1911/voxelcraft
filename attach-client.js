// VoxelCraft — AI attach client: connects the resident brain (local server hub) to window.game.
// Activated ONLY with ?ai in the URL — plain play is completely unaffected.
// Security model: explicit command whitelist (no eval), no cheat commands, outbound-only connection.

function start() {
  const qs = new URLSearchParams(location.search);
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  let attempts = 0;
  const pending = new Map(); // cmdId -> {resolve, timer}
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
    chat: (m) => { window.game.chat(String(m).slice(0, 140)); return 'ok'; },
    burrow: () => window.game.burrow(),
    screenshot: (width) => window.game.screenshotDataURL(width || 480),
    respawn: () => { window.game.respawn(); return 'ok'; },
    save: () => { window.game.save(); return 'ok'; },
  };

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  ws = new WebSocket(protocol + '://' + location.host + '/ws');

  ws.onopen = () => {
    attempts = 0;
    send({ type: 'hello', game: 'voxelcraft', href: location.href });
    window.game.chat('🤖 Resident attaching…');
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
        // self-heal: this tab is playing the wrong world — reload into the canonical one
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

  ws.onclose = () => {
    attempts++;
    const delay = Math.min(30000, 1500 * attempts); // bounded backoff
    setTimeout(start, delay);
  };
  ws.onerror = () => { try { ws.close(); } catch { } };

  // ---- outbound telemetry (2s cadence — not game-tick) ----
  setInterval(() => {
    if (ws.readyState === 1) {
      try { send({ type: 'state', data: window.game.state(), events: window.game.recentEvents(12), errs: (window.__errs || []).slice(-3) }); } catch { }
    }
  }, 2000);
  // drop stale pending commands
  setInterval(() => {
    const now = Date.now();
    for (const [id, p] of pending) if (now > p.timer) { pending.delete(id); p.resolve(null); }
  }, 5000);
}
start();