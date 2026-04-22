// Real-time WebSocket layer for direct messages.
// Mounts a parallel WS endpoint on the SAME http server as /ws/live so we
// don't open a second port. Handshake: /ws/dm?token=<JWT>
//
// Server is the source of truth — clients send {to, type:'typing'} only;
// 'message' / 'reaction' / 'read' events are emitted by the REST routes
// via the exported dmEmit() helper. This avoids trusting the client to
// fan out a message it claims to have sent.
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const User = require('./User');

// userId -> Set<ws>
const sockets = new Map();

function getSocketsFor(userId) {
  return sockets.get(String(userId)) || null;
}

// Public emit used by REST routes. No-op if recipient isn't connected.
function dmEmit(userId, payload) {
  const set = getSocketsFor(userId);
  if (!set || !set.size) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch {}
    }
  }
}

function mountDmSignal(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname !== '/ws/dm') return; // not ours; liveSignal will handle /ws/live
    const { token } = parsed.query || {};
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    let payload;
    try { payload = jwt.verify(String(token), process.env.JWT_SECRET); }
    catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._userId = String(payload.id);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const uid = ws._userId;
    let set = sockets.get(uid);
    if (!set) { set = new Set(); sockets.set(uid, set); }
    set.add(ws);

    // Heartbeat — drop stale connections (Render closes idle sockets ~110s).
    ws._alive = true;
    ws.on('pong', () => { ws._alive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      // Only typing indicators flow client->server->peer. Everything else
      // (message/reaction/read) is initiated through REST so we can apply
      // block / privacy / rate-limit checks centrally.
      if (msg.type === 'typing') {
        const to = String(msg.to || '');
        if (!to || to === uid) return;
        // Cheap block check so we don't leak typing to people who blocked us.
        try {
          const other = await User.findById(to).select('blocked');
          if (other && (other.blocked || []).map(String).includes(uid)) return;
        } catch { return; }
        dmEmit(to, { type: 'typing', from: uid, isTyping: !!msg.isTyping });
      }
    });

    ws.on('close', () => {
      const s = sockets.get(uid);
      if (!s) return;
      s.delete(ws);
      if (s.size === 0) sockets.delete(uid);
    });
  });

  // Heartbeat sweep every 30s.
  const interval = setInterval(() => {
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (!ws._alive) { try { ws.terminate(); } catch {} continue; }
        ws._alive = false;
        try { ws.ping(); } catch {}
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

module.exports = { mountDmSignal, dmEmit };
