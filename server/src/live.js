'use strict';

/* The live channel: one WebSocket per open app, at /v1/live.

   It does three things. It knows who is online, which is what the friend
   list's "Online" chip means. It delivers race invites the moment a race is
   created. And it relays race telemetry — distance, pace, position, several
   times a second — between the runners in the same race, which is the job
   BroadcastChannel did between two tabs in the demo.

   A browser cannot put a token in a WebSocket's headers, so the first
   message has to be { type: 'auth', token }; anything else first, or nothing
   for ten seconds, closes the socket. */

const { WebSocketServer } = require('ws');
const { authenticate } = require('./auth');
const { isUuid } = require('./validate');

const AUTH_DEADLINE_MS = 10 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const MESSAGES_PER_SECOND = 20;
const RACE_OPEN_HOURS = 6;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Only what a race board draws, with the sender's identity set by us. */
function cleanTelemetry(t, user) {
  if (!t || typeof t !== 'object') return null;
  const p = t.position;
  const position = p && num(p.lat) !== null && num(p.lng) !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    ? { lat: p.lat, lng: p.lng } : null;
  return {
    name: user.name,
    initials: user.initials,
    // The real runner replaces the pace bot standing in for them.
    standsFor: user.id,
    distance: Math.max(0, num(t.distance) || 0),
    duration: Math.max(0, num(t.duration) || 0),
    currentPace: num(t.currentPace),
    finishedAt: num(t.finishedAt),
    position,
  };
}

function createLive(deps) {
  const db = deps.db;
  const log = deps.log || console;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const online = new Map();      // user id → Set of sockets
  const rooms = new Map();       // race id → Set of sockets

  const send = (ws, message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  function leaveRoom(ws, raceId) {
    const room = rooms.get(raceId);
    if (!room || !room.has(ws)) return;
    room.delete(ws);
    ws.rooms.delete(raceId);
    room.forEach((peer) => send(peer, { type: 'left', race: raceId, from: ws.user.id, at: Date.now() }));
    if (!room.size) rooms.delete(raceId);
  }

  async function mayJoin(userId, raceId) {
    if (!isUuid(raceId)) return false;
    const row = await db.one(
      `select 1 from races r
        where r.id = $1 and r.created_at > now() - make_interval(hours => $3)
          and (r.host_id = $2 or exists (select 1 from race_entrants e where e.race_id = r.id and e.user_id = $2))`,
      [raceId, userId, RACE_OPEN_HOURS]);
    return !!row;
  }

  async function onMessage(ws, msg) {
    if (!ws.user) {
      if (msg.type !== 'auth') { ws.close(4001, 'auth first'); return; }
      const user = await authenticate(db, msg.token);
      if (!user) { send(ws, { type: 'error', code: 'unauthorized' }); ws.close(4001, 'unauthorized'); return; }
      ws.user = { id: user.id, name: user.name, initials: user.initials };
      clearTimeout(ws.authTimer);
      if (!online.has(user.id)) online.set(user.id, new Set());
      online.get(user.id).add(ws);
      send(ws, { type: 'ready', user: user.id });
      return;
    }

    if (msg.type === 'join') {
      const raceId = String(msg.race || '');
      if (!(await mayJoin(ws.user.id, raceId))) { send(ws, { type: 'error', code: 'not_in_race', race: raceId }); return; }
      if (!rooms.has(raceId)) rooms.set(raceId, new Set());
      rooms.get(raceId).add(ws);
      ws.rooms.add(raceId);
      send(ws, { type: 'joined', race: raceId });
      return;
    }
    if (msg.type === 'leave') { leaveRoom(ws, String(msg.race || '')); return; }

    if (msg.type === 'hello' || msg.type === 'telemetry') {
      const raceId = String(msg.race || '');
      const room = rooms.get(raceId);
      if (!room || !room.has(ws)) return;
      const out = { type: msg.type, race: raceId, from: ws.user.id, at: Date.now() };
      if (msg.type === 'telemetry') {
        out.telemetry = cleanTelemetry(msg.telemetry, ws.user);
        if (!out.telemetry) return;
      }
      room.forEach((peer) => { if (peer !== ws) send(peer, out); });
    }
  }

  wss.on('connection', (ws) => {
    ws.user = null;
    ws.rooms = new Set();
    ws.alive = true;
    ws.window = { start: Date.now(), count: 0 };
    ws.authTimer = setTimeout(() => { if (!ws.user) ws.close(4001, 'auth timeout'); }, AUTH_DEADLINE_MS);

    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - ws.window.start > 1000) ws.window = { start: now, count: 0 };
      if (++ws.window.count > MESSAGES_PER_SECOND) return;           // dropped, not fatal
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch (err) { return; }
      if (!msg || typeof msg !== 'object') return;
      onMessage(ws, msg).catch((err) => log.error('[live]', err.message));
    });
    ws.on('close', () => {
      clearTimeout(ws.authTimer);
      Array.from(ws.rooms).forEach((raceId) => leaveRoom(ws, raceId));
      if (ws.user && online.has(ws.user.id)) {
        online.get(ws.user.id).delete(ws);
        if (!online.get(ws.user.id).size) online.delete(ws.user.id);
      }
    });
    ws.on('error', () => { /* a dropped phone; close follows */ });
  });

  // Phones vanish without closing their sockets; a socket that misses a
  // ping is gone.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.alive) { ws.terminate(); return; }
      ws.alive = false;
      try { ws.ping(); } catch (err) { /* already gone */ }
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    attach(server) {
      server.on('upgrade', (req, socket, head) => {
        let path = '';
        try { path = new URL(req.url, 'http://localhost').pathname; } catch (err) { /* malformed */ }
        if (path !== '/v1/live') {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
    },

    isOnline: (userId) => online.has(userId),

    /** Sends a message to every open app of each of these runners. */
    notify(userIds, message) {
      userIds.forEach((id) => (online.get(id) || []).forEach((ws) => send(ws, message)));
    },

    close() {
      clearInterval(heartbeat);
      wss.clients.forEach((ws) => ws.terminate());
      wss.close();
    },
  };
}

module.exports = { createLive, cleanTelemetry };
