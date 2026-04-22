const express = require('express');
const router = express.Router();
const PushSubscription = require('./PushSubscription');
const { auth } = require('./lib/auth');
const { publicKey } = require('./lib/pushSender');

// GET /api/push/public-key — clients fetch this to call subscribe()
router.get('/public-key', (req, res) => {
  res.json({ key: publicKey() });
});

// POST /api/push/subscribe — register a new push subscription for the user
router.post('/subscribe', auth, async (req, res) => {
  try {
    const sub = req.body?.subscription;
    if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ msg: 'Invalid subscription' });
    }
    const ua = (req.header('User-Agent') || '').slice(0, 200);
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { user: String(req.user.id), endpoint: sub.endpoint, keys: sub.keys, ua },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /push/subscribe failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/push/unsubscribe — remove a subscription by endpoint
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ msg: 'Endpoint required' });
    await PushSubscription.deleteOne({ endpoint, user: String(req.user.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /push/unsubscribe failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
