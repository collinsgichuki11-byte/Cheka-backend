const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Analytics = require('./Analytics');
const User = require('./User');

const ALLOWED_TYPES = new Set([
  'page_view', 'signup', 'login', 'video_view', 'video_like', 'video_unlike',
  'video_upload', 'video_loop', 'comment_post', 'follow', 'unfollow',
  'ad_impression', 'ad_click', 'share'
]);

const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) { req.user = null; return next(); }
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); }
  catch { req.user = null; }
  next();
};

const requireAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminOnly = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) return res.status(403).json({ msg: 'Admin only' });
    next();
  } catch { res.status(500).json({ msg: 'Server error' }); }
};

const sanitizeMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const k of Object.keys(meta).slice(0, 20)) {
    const v = meta[k];
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
};

// POST /api/analytics/event — record an event (auth optional)
router.post('/event', optionalAuth, async (req, res) => {
  try {
    const { type, video, path, meta } = req.body || {};
    if (!type || !ALLOWED_TYPES.has(type)) return res.status(400).json({ msg: 'Bad event type' });
    const event = new Analytics({
      type,
      user: req.user?.id || null,
      video: video || null,
      path: typeof path === 'string' ? path.slice(0, 200) : '',
      meta: sanitizeMeta(meta),
      ua: (req.header('User-Agent') || '').slice(0, 200),
      ip: (req.header('x-forwarded-for') || req.ip || '').toString().split(',')[0].trim().slice(0, 60)
    });
    await event.save();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/analytics/events — batch up to 50 events
router.post('/events', optionalAuth, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
    const ua = (req.header('User-Agent') || '').slice(0, 200);
    const ip = (req.header('x-forwarded-for') || req.ip || '').toString().split(',')[0].trim().slice(0, 60);
    const docs = events
      .filter(e => e && ALLOWED_TYPES.has(e.type))
      .map(e => ({
        type: e.type,
        user: req.user?.id || null,
        video: e.video || null,
        path: typeof e.path === 'string' ? e.path.slice(0, 200) : '',
        meta: sanitizeMeta(e.meta),
        ua,
        ip
      }));
    if (docs.length) await Analytics.insertMany(docs, { ordered: false });
    res.json({ ok: true, saved: docs.length });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/analytics/summary — admin dashboard data
router.get('/summary', requireAuth, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totals, last24h, last7d, topVideos, recent] = await Promise.all([
      Analytics.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Analytics.aggregate([
        { $match: { createdAt: { $gte: dayAgo } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Analytics.aggregate([
        { $match: { createdAt: { $gte: weekAgo } } },
        { $group: {
            _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, t: '$type' },
            count: { $sum: 1 }
        } },
        { $sort: { '_id.d': 1 } }
      ]),
      Analytics.aggregate([
        { $match: { type: 'video_view', video: { $ne: null }, createdAt: { $gte: weekAgo } } },
        { $group: { _id: '$video', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 10 }
      ]),
      Analytics.find().sort({ createdAt: -1 }).limit(50)
        .populate('user', 'username')
        .populate('video', 'title')
    ]);

    const activeUsers24h = await Analytics.distinct('user', {
      createdAt: { $gte: dayAgo }, user: { $ne: null }
    });

    res.json({
      totals: Object.fromEntries(totals.map(t => [t._id, t.count])),
      last24h: Object.fromEntries(last24h.map(t => [t._id, t.count])),
      last7d,
      topVideos,
      recent,
      activeUsers24h: activeUsers24h.length
    });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
