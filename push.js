const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const PushSubscription = require('./PushSubscription');
const webpush = require('./webpush');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// GET the VAPID public key — clients need this to subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: webpush.publicKey(), enabled: webpush.isConfigured() });
});

// POST subscribe
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ msg: 'Bad subscription' });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          user: String(req.user.id),
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          ua: (req.header('User-Agent') || '').slice(0, 200)
        }
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST unsubscribe
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ msg: 'Missing endpoint' });
    await PushSubscription.deleteOne({ endpoint, user: String(req.user.id) });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST test (auth) — send self a test push
router.post('/test', auth, async (req, res) => {
  const r = await webpush.sendPushTo(req.user.id, {
    type: 'test',
    title: 'Push is working ✅',
    body: 'You will now get notified on Cheka.',
    url: '/notifications.html'
  });
  res.json(r);
});

module.exports = router;
