const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const LiveStream = require('./LiveStream');

// Mounts a WebSocket signalling layer on the existing HTTP server.
// Handshake URL: /ws/live?streamId=XXX&token=JWT
function mountLiveSignal(server) {
  const wss = new WebSocketServer({ noServer: true });

  // streamId -> { broadcasterId, broadcasterWs, viewers: Map<viewerId, ws> }
  const rooms = new Map();

  function roomCount(room) {
    let n = 0;
    for (const ws of room.viewers.values()) {
      if (ws.readyState === ws.OPEN) n++;
    }
    return n;
  }

  function broadcastToRoom(room, payload, exceptId) {
    const data = JSON.stringify(payload);
    if (room.broadcasterWs && room.broadcasterWs.readyState === room.broadcasterWs.OPEN
        && room.broadcasterId !== exceptId) {
      try { room.broadcasterWs.send(data); } catch {}
    }
    for (const [vid, ws] of room.viewers) {
      if (vid === exceptId) continue;
      if (ws.readyState === ws.OPEN) { try { ws.send(data); } catch {} }
    }
  }

  async function updateViewerCount(streamId, room) {
    const count = roomCount(room);
    broadcastToRoom(room, { type: 'viewer-count', count });
    try {
      const update = { viewerCount: count };
      const stream = await LiveStream.findById(streamId).select('peakViewers');
      if (stream && count > (stream.peakViewers || 0)) update.peakViewers = count;
      await LiveStream.updateOne({ _id: streamId }, { $set: update });
    } catch {}
  }

  function closeRoom(streamId) {
    const room = rooms.get(streamId);
    if (!room) return;
    const data = JSON.stringify({ type: 'end' });
    for (const ws of room.viewers.values()) {
      try { ws.send(data); ws.close(); } catch {}
    }
    if (room.broadcasterWs) { try { room.broadcasterWs.close(); } catch {} }
    rooms.delete(streamId);
  }
  // expose for REST end-route to invoke
  global.__chekaCloseLiveRoom = closeRoom;

  server.on('upgrade', (req, socket, head) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname !== '/ws/live') return; // not ours
    const { streamId, token } = parsed.query || {};
    if (!streamId || !token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    let payload;
    try { payload = jwt.verify(String(token), process.env.JWT_SECRET); }
    catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._userId = payload.id;
      ws._streamId = String(streamId);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws) => {
    const streamId = ws._streamId;
    const userId = ws._userId;
    let stream;
    try { stream = await LiveStream.findById(streamId); } catch {}
    if (!stream || !stream.isActive) {
      try { ws.send(JSON.stringify({ type: 'end' })); ws.close(); } catch {}
      return;
    }
    const isBroadcaster = stream.broadcaster === userId;
    let room = rooms.get(streamId);
    if (!room) {
      room = { broadcasterId: stream.broadcaster, broadcasterWs: null, viewers: new Map() };
      rooms.set(streamId, room);
    }

    if (isBroadcaster) {
      // Replace any prior broadcaster socket.
      if (room.broadcasterWs && room.broadcasterWs !== ws) {
        try { room.broadcasterWs.close(); } catch {}
      }
      room.broadcasterWs = ws;
      // Tell broadcaster about every existing viewer so it can offer to them.
      for (const vid of room.viewers.keys()) {
        try { ws.send(JSON.stringify({ type: 'viewer-join', viewerId: vid })); } catch {}
      }
    } else {
      room.viewers.set(userId, ws);
      // Notify broadcaster of new viewer so it can create an offer.
      if (room.broadcasterWs && room.broadcasterWs.readyState === ws.OPEN) {
        try { room.broadcasterWs.send(JSON.stringify({ type: 'viewer-join', viewerId: userId })); } catch {}
      }
      updateViewerCount(streamId, room);
    }

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const r = rooms.get(streamId);
      if (!r) return;
      const t = msg.type;

      // WebRTC signalling — relay to specified target.
      if (t === 'offer' || t === 'answer' || t === 'ice') {
        const targetId = msg.target;
        if (!targetId) return;
        let targetWs = null;
        if (targetId === r.broadcasterId) targetWs = r.broadcasterWs;
        else targetWs = r.viewers.get(targetId);
        if (targetWs && targetWs.readyState === ws.OPEN) {
          try { targetWs.send(JSON.stringify({ type: t, from: userId, payload: msg.payload })); } catch {}
        }
        return;
      }

      if (t === 'chat') {
        const text = String(msg.text || '').slice(0, 300);
        if (!text) return;
        // Don't echo back to sender — sender appends locally for instant feedback.
        broadcastToRoom(r, { type: 'chat', from: userId, name: msg.name || '', text, ts: Date.now() }, userId);
        LiveStream.updateOne({ _id: streamId }, { $inc: { chatCount: 1 } }).catch(() => {});
        return;
      }

      if (t === 'heart') {
        // Don't echo back to sender — sender spawns the heart locally for instant feedback.
        broadcastToRoom(r, { type: 'heart', from: userId, ts: Date.now() }, userId);
        LiveStream.updateOne({ _id: streamId }, { $inc: { heartCount: 1 } }).catch(() => {});
        return;
      }

      if (t === 'end' && userId === r.broadcasterId) {
        try {
          await LiveStream.updateOne(
            { _id: streamId },
            { $set: { isActive: false, endedAt: new Date() } }
          );
        } catch {}
        closeRoom(streamId);
        return;
      }
    });

    ws.on('close', async () => {
      const r = rooms.get(streamId);
      if (!r) return;
      if (isBroadcaster && r.broadcasterWs === ws) {
        // Broadcaster left: end stream after a short grace.
        setTimeout(async () => {
          const cur = rooms.get(streamId);
          if (!cur) return;
          if (!cur.broadcasterWs || cur.broadcasterWs.readyState !== ws.OPEN) {
            try {
              await LiveStream.updateOne(
                { _id: streamId, isActive: true },
                { $set: { isActive: false, endedAt: new Date() } }
              );
            } catch {}
            closeRoom(streamId);
          }
        }, 10000);
      } else if (!isBroadcaster) {
        if (r.viewers.get(userId) === ws) r.viewers.delete(userId);
        // Tell broadcaster the viewer left so it can tear down the peer connection.
        if (r.broadcasterWs && r.broadcasterWs.readyState === ws.OPEN) {
          try { r.broadcasterWs.send(JSON.stringify({ type: 'viewer-leave', viewerId: userId })); } catch {}
        }
        updateViewerCount(streamId, r);
      }
    });
  });

  return wss;
}

module.exports = { mountLiveSignal };
