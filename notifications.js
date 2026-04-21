const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Notification = require('./Notification');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// GET my notifications
router.get('/', auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 }).limit(50);
    res.json(notifs);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// POST create notification — sender forced to authed user
router.post('/', auth, async (req, res) => {
  try {
    const { recipient, type, videoTitle, videoId } = req.body;
    if (!recipient || !type || !videoTitle || !videoId) {
      return res.status(400).json({ msg: 'Missing fields' });
    }
    if (recipient === req.user.id) return res.json({ msg: 'No self notify' });
    const notif = new Notification({
      recipient,
      sender: req.user.id,
      type,
      videoTitle: String(videoTitle).slice(0, 200),
      videoId: String(videoId)
    });
    await notif.save();
    res.json(notif);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PUT mark all read
router.put('/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id }, { read: true });
    res.json({ msg: 'All read' });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET unread count
router.get('/count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user.id, read: false });
    res.json({ count });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

module.exports = router;
