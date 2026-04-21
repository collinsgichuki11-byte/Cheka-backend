const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Message = require('./Message');
const User = require('./User');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ msg: 'Invalid token' });
  }
};

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

      // Count unread messages from the other person to me
      if (!isSender && !msg.read) {
        convoMap[otherId].unread++;
      }
    }

    res.json(Object.values(convoMap));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/messages/:userId — fetch full message thread with a user
router.get('/:userId', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;

    const messages = await Message.find({
      $or: [
        { from: myId, to: otherId },
        { from: otherId, to: myId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/messages/:userId — send a message to a user
router.post('/:userId', auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;
    const { text } = req.body;

    if (!text || !text.trim()) return res.status(400).json({ msg: 'Message cannot be empty' });
    if (text.length > 1000) return res.status(400).json({ msg: 'Message too long' });

    const [me, other] = await Promise.all([
      User.findById(myId),
      User.findById(otherId)
    ]);

    if (!me || !other) return res.status(404).json({ msg: 'User not found' });

    const message = new Message({
      from: myId,
      to: otherId,
      fromUsername: me.username,
      toUsername: other.username,
      text: text.trim()
    });

    await message.save();
    res.json(message);
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
