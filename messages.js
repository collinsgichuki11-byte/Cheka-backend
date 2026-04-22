const express = require('express');
const router = express.Router();
const Message = require('./Message');
const User = require('./User');
const Follow = require('./Follow');
const { auth, isValidId } = require('./lib/auth');

// GET /api/messages — all conversations for logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const myId = req.user.id;

    const messages = await Message.find({
      $or: [{ from: myId }, { to: myId }]
    }).sort({ createdAt: -1 });

    // Group by conversation partner, keep latest message per convo
    const convoMap = {};
    for (const msg of messages) {
      const isSender = msg.from.toString() === myId;
      const otherId = isSender ? msg.to.toString() : msg.from.toString();
      const otherUsername = isSender ? msg.toUsername : msg.fromUsername;

      if (!convoMap[otherId]) {
        convoMap[otherId] = {
          userId: otherId,
          username: otherUsername,
          lastMessage: msg.text,
          lastTime: msg.createdAt,
          unread: 0
        };
      }

      if (!isSender && !msg.read) {
        convoMap[otherId].unread++;
      }
    }

    res.json(Object.values(convoMap));
  } catch (err) {
    console.error('GET /messages failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/messages/:userId — fetch full message thread with a user
router.get('/:userId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;

    const messages = await Message.find({
      $or: [
        { from: myId, to: otherId },
        { from: otherId, to: myId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error('GET /messages/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:userId — send a message to a user
router.post('/:userId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;
    const { text } = req.body || {};

    if (myId === otherId) return res.status(400).json({ msg: 'Cannot message yourself' });
    if (!text || !text.trim()) return res.status(400).json({ msg: 'Message cannot be empty' });
    if (text.length > 1000) return res.status(400).json({ msg: 'Message too long' });

    const [me, other] = await Promise.all([
      User.findById(myId),
      User.findById(otherId)
    ]);

    if (!me || !other) return res.status(404).json({ msg: 'User not found' });

    // Mutual block check — neither side may message a blocked party.
    const iBlockedThem = (me.blocked || []).map(String).includes(String(otherId));
    const theyBlockedMe = (other.blocked || []).map(String).includes(String(myId));
    if (iBlockedThem || theyBlockedMe) {
      return res.status(403).json({ msg: 'You cannot message this user' });
    }

    // Honor recipient's whoCanMessage privacy setting.
    const policy = other.whoCanMessage || 'everyone';
    if (policy === 'noone') {
      return res.status(403).json({ msg: 'This user does not accept messages' });
    }
    if (policy === 'followers') {
      // "Followers can message this user" — the sender must follow the recipient.
      const allowed = await Follow.findOne({ follower: myId, following: otherId });
      if (!allowed) {
        return res.status(403).json({ msg: 'Only followers can message this user' });
      }
    }

    const message = new Message({
      from: myId,
      to: otherId,
      fromUsername: me.username,
      toUsername: other.username,
      text: text.trim()
    });

    await message.save();
    res.json(message);
  } catch (err) {
    console.error('POST /messages/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PUT /api/messages/:userId/read — mark messages from userId as read
router.put('/:userId/read', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const myId = req.user.id;
    const otherId = req.params.userId;

    await Message.updateMany(
      { from: otherId, to: myId, read: false },
      { $set: { read: true } }
    );

    res.json({ msg: 'Marked as read' });
  } catch (err) {
    console.error('PUT /messages/:userId/read failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
