const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Message = require('./Message');
const User = require('./User');
const Video = require('./Video');
const Notification = require('./Notification');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// In-memory typing tracker. Map<`${from}:${to}`, expiresAtMs>.
// Lightweight, ephemeral — no DB writes for typing.
const typingMap = new Map();
const TYPING_TTL_MS = 5000;
function setTyping(from, to) { typingMap.set(`${from}:${to}`, Date.now() + TYPING_TTL_MS); }
function isTyping(from, to) {
  const exp = typingMap.get(`${from}:${to}`);
  if (!exp) return false;
  if (exp < Date.now()) { typingMap.delete(`${from}:${to}`); return false; }
  return true;
}
// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of typingMap) if (v < now) typingMap.delete(k);
}, 30_000).unref?.();

// GET /api/messages — all conversations for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const messages = await Message.find({
      $or: [{ from: myId }, { to: myId }],
      deleted: { $ne: true }
    }).sort({ createdAt: -1 }).limit(2000);

    const convoMap = {};
    for (const msg of messages) {
      const isSender = msg.from.toString() === myId;
      const otherId = isSender ? msg.to.toString() : msg.from.toString();
      const otherUsername = isSender ? msg.toUsername : msg.fromUsername;

      if (!convoMap[otherId]) {
        convoMap[otherId] = {
          userId: otherId,
          username: otherUsername,
          lastMessage: previewFor(msg),
          lastKind: msg.kind,
          lastTime: msg.createdAt,
          unread: 0
        };
      }
      if (!isSender && !msg.read) convoMap[otherId].unread++;
    }
    res.json(Object.values(convoMap));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

function previewFor(m) {
  if (m.kind === 'image') return '📷 Photo';
  if (m.kind === 'video') return '🎥 Video';
  if (m.kind === 'voice') return `🎤 Voice (${Math.round(m.durationSec || 0)}s)`;
  if (m.kind === 'link') return `🎬 Shared a video`;
  return m.text || '';
}

// GET /api/messages/typing/:userId — is the other user typing to me?
router.get('/typing/:userId', auth, async (req, res) => {
  res.json({ typing: isTyping(req.params.userId, req.user.id) });
});

// POST /api/messages/typing/:userId — I'm typing to user
router.post('/typing/:userId', auth, async (req, res) => {
  setTyping(req.user.id, req.params.userId);
  res.json({ ok: true });
});

// GET /api/messages/:userId — fetch full message thread with a user
router.get('/:userId', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;
    if (!isValidId(otherId)) return res.status(400).json({ msg: 'Bad user id' });

    const messages = await Message.find({
      $or: [
        { from: myId, to: otherId },
        { from: otherId, to: myId }
      ],
      deleted: { $ne: true }
    }).sort({ createdAt: 1 }).limit(500);

    res.json(messages);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:userId — send a message (text / image / video / voice / link)
router.post('/:userId', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;
    if (!isValidId(otherId)) return res.status(400).json({ msg: 'Bad user id' });

    const b = req.body || {};
    const kind = ['text','image','video','voice','link'].includes(b.kind) ? b.kind : 'text';
    const text = String(b.text || '').slice(0, 1000).trim();
    const mediaUrl = String(b.mediaUrl || '').slice(0, 1000);
    const mediaThumb = String(b.mediaThumb || '').slice(0, 1000);
    const durationSec = Math.max(0, Math.min(60, Number(b.durationSec) || 0));

    if (kind === 'text' && !text) return res.status(400).json({ msg: 'Message cannot be empty' });
    if (['image','video','voice'].includes(kind) && !mediaUrl) return res.status(400).json({ msg: 'Missing media' });
    if (kind === 'voice' && durationSec > 10) return res.status(400).json({ msg: 'Voice notes max 10 seconds' });

    const [me, other] = await Promise.all([
      User.findById(myId).select('username displayName whoCanMessage blocked'),
      User.findById(otherId).select('username displayName whoCanMessage blocked')
    ]);
    if (!me || !other) return res.status(404).json({ msg: 'User not found' });

    // Honor block list both directions
    if ((other.blocked || []).map(String).includes(String(myId))) {
      return res.status(403).json({ msg: 'You cannot message this user' });
    }
    if ((me.blocked || []).map(String).includes(String(otherId))) {
      return res.status(403).json({ msg: 'Unblock this user to send a message' });
    }

    // Build link preview from videoId if kind==='link'
    let linkPreview = null;
    if (kind === 'link' && b.linkPreview?.videoId && isValidId(b.linkPreview.videoId)) {
      const v = await Video.findById(b.linkPreview.videoId).select('title creatorName youtubeId videoUrl').lean();
      if (v) {
        const thumb = v.videoUrl
          ? v.videoUrl.replace(/\.(mp4|mov|webm)(\?.*)?$/i, '.jpg')
          : v.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` : '';
        linkPreview = { videoId: String(v._id), title: v.title || '', creatorName: v.creatorName || '', thumbUrl: thumb };
      }
    }

    const message = new Message({
      from: myId,
      to: otherId,
      fromUsername: me.username,
      toUsername: other.username,
      kind,
      text: kind === 'text' ? text : (text || ''),
      mediaUrl,
      mediaThumb,
      durationSec,
      linkPreview
    });
    await message.save();

    // Clear my "typing" state (we just sent)
    typingMap.delete(`${myId}:${otherId}`);

    // Fire a push notification (separate from in-app notif feed by default — single push only).
    Notification.create({
      recipient: String(otherId),
      sender: String(myId),
      type: 'message',
      videoTitle: '',
      videoId: '',
      snippet: previewFor(message)
    }).catch(() => {});

    res.json(message);
  } catch (err) {
    console.error('POST /messages/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/reaction/:msgId — toggle reaction emoji on a message
router.post('/reaction/:msgId', auth, async (req, res) => {
  try {
    const { msgId } = req.params;
    const emoji = String((req.body || {}).emoji || '').slice(0, 8);
    if (!emoji) return res.status(400).json({ msg: 'Emoji required' });
    if (!isValidId(msgId)) return res.status(400).json({ msg: 'Bad msg id' });
    const m = await Message.findById(msgId);
    if (!m) return res.status(404).json({ msg: 'Not found' });
    if (String(m.from) !== req.user.id && String(m.to) !== req.user.id) {
      return res.status(403).json({ msg: 'Not your conversation' });
    }
    const idx = (m.reactions || []).findIndex(r => String(r.user) === req.user.id && r.emoji === emoji);
    if (idx >= 0) m.reactions.splice(idx, 1);
    else m.reactions.push({ user: req.user.id, emoji });
    await m.save();
    res.json({ reactions: m.reactions });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE /api/messages/msg/:msgId — soft-delete own message
router.delete('/msg/:msgId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.msgId)) return res.status(400).json({ msg: 'Bad msg id' });
    const m = await Message.findById(req.params.msgId);
    if (!m) return res.status(404).json({ msg: 'Not found' });
    if (String(m.from) !== req.user.id) return res.status(403).json({ msg: 'Not your message' });
    m.deleted = true;
    await m.save();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// PUT /api/messages/:userId/read — mark messages from userId as read
router.put('/:userId/read', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;
    await Message.updateMany(
      { from: otherId, to: myId, read: false },
      { $set: { read: true } }
    );
    res.json({ msg: 'Marked as read' });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
