const express = require('express');
const router = express.Router();
const Notification = require('./Notification');
const User = require('./User');
const { auth } = require('./lib/auth');

// GET my notifications (sender enriched with username)
router.get('/', auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 }).limit(50).lean();
    const senderIds = [...new Set(notifs.map(n => n.sender).filter(Boolean))];
    const senders = await User.find({ _id: { $in: senderIds } }).select('_id username displayName');
    const map = new Map(senders.map(u => [String(u._id), { _id: u._id, username: u.username, displayName: u.displayName }]));
    res.json(notifs.map(n => ({ ...n, sender: map.get(String(n.sender)) || { username: 'someone' } })));
  } catch (err) {
    console.error('GET /notifications failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// NOTE: The previous POST /api/notifications endpoint was removed. It allowed
// any authed user to inject arbitrary notification payloads to any other user
// (a spam vector). Notifications are now created server-side only by the
// routes that trigger them (likes, comments, follows, etc).

// PUT mark all read
router.put('/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id }, { read: true });
    res.json({ msg: 'All read' });
  } catch (err) {
    console.error('PUT /notifications/read failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET unread count
router.get('/count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user.id, read: false });
    res.json({ count });
  } catch (err) {
    console.error('GET /notifications/count failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
