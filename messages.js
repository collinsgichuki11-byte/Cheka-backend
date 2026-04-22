const express = require('express');
const router = express.Router();
const Message = require('./Message');
const User = require('./User');
const Follow = require('./Follow');
const Video = require('./Video');
const { auth, isValidId } = require('./lib/auth');
const { dmEmit } = require('./dmSignal');

// Detect a Cheka video link (any host) inside a message body and return
// {videoId} if found. We tolerate /watch.html?id=... and /feed.html?v=...
const VIDEO_LINK_RE = /\/(?:watch|feed)\.html\?(?:[^"\s]*?)(?:id|v)=([A-Fa-f0-9]{24})/;
function extractVideoId(text) {
  if (!text) return null;
  const m = String(text).match(VIDEO_LINK_RE);
  return m ? m[1] : null;
}

async function buildLinkedVideo(videoId) {
  if (!videoId || !isValidId(videoId)) return null;
  try {
    const v = await Video.findById(videoId).select('title creatorName videoType videoUrl youtubeId');
    if (!v) return null;
    let thumb = '';
    if (v.videoType === 'youtube' && v.youtubeId) {
      thumb = `https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg`;
    } else if (v.videoUrl) {
      thumb = v.videoUrl;
    }
    return { videoId: v._id, title: v.title, creatorName: v.creatorName, thumb };
  } catch { return null; }
}

// Friendly preview shown in the conversation list when the latest message
// has no text body (media-only). Keeps the convo list useful for old clients.
function previewFor(msg) {
  if (msg.text && msg.text.trim()) return msg.text;
  switch (msg.kind) {
    case 'image': return '📷 Photo';
    case 'video': return '🎥 Video';
    case 'voice': return '🎤 Voice note';
    case 'link':  return '🔗 ' + (msg.linkedVideo?.title || 'Shared a video');
    default:      return '';
  }
}

// Shared block / privacy gate used by every send-style endpoint.
async function canSend(myId, otherId) {
  if (String(myId) === String(otherId)) return { ok: false, status: 400, msg: 'Cannot message yourself' };
  const [me, other] = await Promise.all([User.findById(myId), User.findById(otherId)]);
  if (!me || !other) return { ok: false, status: 404, msg: 'User not found' };
  const iBlockedThem = (me.blocked || []).map(String).includes(String(otherId));
  const theyBlockedMe = (other.blocked || []).map(String).includes(String(myId));
  if (iBlockedThem || theyBlockedMe) return { ok: false, status: 403, msg: 'You cannot message this user' };
  const policy = other.whoCanMessage || 'everyone';
  if (policy === 'noone') return { ok: false, status: 403, msg: 'This user does not accept messages' };
  if (policy === 'followers') {
    const allowed = await Follow.findOne({ follower: myId, following: otherId });
    if (!allowed) return { ok: false, status: 403, msg: 'Only followers can message this user' };
  }
  return { ok: true, me, other };
}

// GET /api/messages — all conversations for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const messages = await Message.find({ $or: [{ from: myId }, { to: myId }] }).sort({ createdAt: -1 });

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
          lastTime: msg.createdAt,
          unread: 0
        };
      }
      if (!isSender && !msg.read) convoMap[otherId].unread++;
    }
    res.json(Object.values(convoMap));
  } catch (err) {
    console.error('GET /messages failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/messages/:userId — full thread with a user
router.get('/:userId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;
    const messages = await Message.find({
      $or: [{ from: myId, to: otherId }, { from: otherId, to: myId }]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error('GET /messages/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:userId — send a TEXT message (auto-detects video links)
router.post('/:userId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ msg: 'Message cannot be empty' });
    if (text.length > 1000) return res.status(400).json({ msg: 'Message too long' });

    const gate = await canSend(myId, otherId);
    if (!gate.ok) return res.status(gate.status).json({ msg: gate.msg });

    const linkedVideo = await buildLinkedVideo(extractVideoId(text));
    const message = new Message({
      from: myId, to: otherId,
      fromUsername: gate.me.username, toUsername: gate.other.username,
      text: text.trim(),
      kind: linkedVideo ? 'link' : 'text',
      linkedVideo
    });
    await message.save();
    dmEmit(otherId, { type: 'message', message });
    res.json(message);
  } catch (err) {
    console.error('POST /messages/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:userId/media — send an image / video / voice note.
// Body: { mediaUrl, mediaType: 'image'|'video'|'voice', mediaThumb?, audioDur?, text? }
router.post('/:userId/media', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;
    const { mediaUrl, mediaType, mediaThumb, audioDur, text } = req.body || {};

    if (!mediaUrl || typeof mediaUrl !== 'string') return res.status(400).json({ msg: 'mediaUrl required' });
    if (!['image', 'video', 'voice'].includes(mediaType)) return res.status(400).json({ msg: 'Invalid mediaType' });
    if (mediaUrl.length > 600) return res.status(400).json({ msg: 'mediaUrl too long' });

    const gate = await canSend(myId, otherId);
    if (!gate.ok) return res.status(gate.status).json({ msg: gate.msg });

    // Server-side cap on voice note length (10s).
    let dur = 0;
    if (mediaType === 'voice') {
      dur = Math.max(0, Math.min(10, Number(audioDur) || 0));
    }

    const message = new Message({
      from: myId, to: otherId,
      fromUsername: gate.me.username, toUsername: gate.other.username,
      text: (text || '').toString().slice(0, 300),
      kind: mediaType,
      mediaUrl,
      mediaThumb: (mediaThumb || '').toString().slice(0, 600),
      audioDur: dur
    });
    await message.save();
    dmEmit(otherId, { type: 'message', message });
    res.json(message);
  } catch (err) {
    console.error('POST /messages/:userId/media failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:msgId/react — toggle a single emoji reaction.
// Body: { emoji }
router.post('/react/:msgId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.msgId)) return res.status(400).json({ msg: 'Invalid message id' });
    const myId = req.user.id;
    const emoji = String(req.body?.emoji || '').slice(0, 8);
    if (!emoji) return res.status(400).json({ msg: 'emoji required' });

    const msg = await Message.findById(req.params.msgId);
    if (!msg) return res.status(404).json({ msg: 'Message not found' });
    if (String(msg.from) !== myId && String(msg.to) !== myId) {
      return res.status(403).json({ msg: 'Not your conversation' });
    }

    const existing = msg.reactions.find(r => String(r.user) === myId);
    if (existing && existing.emoji === emoji) {
      msg.reactions = msg.reactions.filter(r => String(r.user) !== myId);
    } else if (existing) {
      existing.emoji = emoji;
    } else {
      msg.reactions.push({ user: myId, emoji });
    }
    await msg.save();

    const otherId = String(msg.from) === myId ? String(msg.to) : String(msg.from);
    dmEmit(otherId, { type: 'reaction', messageId: String(msg._id), reactions: msg.reactions });
    res.json({ reactions: msg.reactions });
  } catch (err) {
    console.error('POST /messages/react/:msgId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PUT /api/messages/:userId/read — mark all messages from userId as read,
// stamp readAt, and notify the sender so they see the read receipt live.
router.put('/:userId/read', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;
    const now = new Date();
    const result = await Message.updateMany(
      { from: otherId, to: myId, read: false },
      { $set: { read: true, readAt: now } }
    );
    if (result.modifiedCount > 0) {
      dmEmit(otherId, { type: 'read', byUser: myId, at: now.toISOString() });
    }
    res.json({ msg: 'Marked as read', count: result.modifiedCount });
  } catch (err) {
    console.error('PUT /messages/:userId/read failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
