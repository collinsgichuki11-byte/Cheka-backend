const express = require('express');
const router = express.Router();
const Analytics = require('./Analytics');
const User = require('./User');
const { auth, optionalAuth } = require('./lib/auth');

const ALLOWED_TYPES = new Set([
  'page_view', 'signup', 'login', 'video_view', 'video_like', 'video_unlike',
  'video_upload', 'video_loop', 'comment_post', 'follow', 'unfollow',
  'ad_impression', 'ad_click', 'share'
]);

const adminOnly = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) return res.status(403).json({ msg: 'Admin only' });
    next();
  } catch (err) {
    console.error('analytics adminOnly failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
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
  } catch (err) {
    console.error('POST /analytics/event failed:', err);
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
  } catch (err) {
    console.error('POST /analytics/events failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/analytics/summary — admin dashboard data
router.get('/summary', auth, adminOnly, async (req, res) => {
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
  } catch (err) {
    console.error('GET /analytics/summary failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/analytics/creator/me — analytics for the authed user's own videos
router.get('/creator/me', auth, async (req, res) => {
  try {
    const Video = require('./Video');
    const Follow = require('./Follow');
    const Comment = require('./Comment');
    const mongoose = require('mongoose');
    const meObjectId = new mongoose.Types.ObjectId(req.user.id);

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [videos, followerCount, totals] = await Promise.all([
      Video.find({ creator: meObjectId }).select('_id title createdAt views likes saves shares reposts remixCount loops estimatedEarnings').lean(),
      Follow.countDocuments({ following: req.user.id }),
      Video.aggregate([
        { $match: { creator: meObjectId } },
        { $group: {
          _id: null,
          views: { $sum: '$views' }, likes: { $sum: '$likes' },
          saves: { $sum: '$saves' }, shares: { $sum: '$shares' },
          reposts: { $sum: '$reposts' }, remixes: { $sum: '$remixCount' },
          loops: { $sum: '$loops' }, earnings: { $sum: '$estimatedEarnings' }
        } }
      ])
    ]);

    const videoIds = videos.map(v => v._id);

    const [views7d, views24h, viewsByDay, topByViews] = await Promise.all([
      Analytics.countDocuments({ type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: weekAgo } }),
      Analytics.countDocuments({ type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: dayAgo } }),
      Analytics.aggregate([
        { $match: { type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: monthAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      Video.find({ creator: meObjectId }).sort({ views: -1 }).limit(10)
        .select('_id title views likes saves shares createdAt').lean()
    ]);

    const sum = totals[0] || { views: 0, likes: 0, saves: 0, shares: 0, reposts: 0, remixes: 0, loops: 0, earnings: 0 };

    res.json({
      videoCount: videos.length,
      followerCount,
      totals: sum,
      views7d,
      views24h,
      viewsByDay,
      topByViews
    });
  } catch (err) {
    console.error('GET /analytics/creator/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
