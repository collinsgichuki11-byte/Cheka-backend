const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  fromUsername: { type: String, required: true },
  to: { type: String, required: true },
  toUsername: { type: String, required: true },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

// GET my conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const msgs = await Message.find({
      $or: [{ from: req.user.id }, { to: req.user.id }]
    }).sort({ createdAt: -1 });

    const convMap = {};
    msgs.forEach(m => {
      const otherId = m.from === req.user.id ? m.to : m.from;
      const otherUsername = m.from === req.user.id ? m.toUsername : m.fromUsername;
      if (!convMap[otherId]) {
        convMap[otherId] = { userId: otherId, username: otherUsername, lastMessage: m.text, lastTime: m.createdAt, unread: 0 };
      }
      if (m.to === req.user.id && !m.read) convMap[otherId].unread++;
    });

    res.json(Object.values(convMap));
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET messages with a user
router.get('/:userId', auth, async (req, res) => {
  try {
    const msgs = await Message.find({
      $or: [
        { from: req.user.id, to: req.params.userId },
        { from: req.params.userId, to: req.user.id }
      ]
    }).sort({ createdAt: 1 });

    await Message.updateMany(
      { from: req.params.userId, to: req.user.id, read: false },
      { read: true }
    );

    res.json(msgs);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// POST send message
router.post('/:userId', auth, async (req, res) => {
  try {
    const { text, toUsername } = req.body;
    if (!text) return res.status(400).json({ msg: 'Message cannot be empty' });

    const msg = await Message.create({
      from: req.user.id,
      fromUsername: req.body.fromUsername,
      to: req.params.userId,
      toUsername,
      text
    });

    res.json(msg);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET unread count
router.get('/unread/count', auth, async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.user.id, read: false });
    res.json({ count });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

module.exports = router;
