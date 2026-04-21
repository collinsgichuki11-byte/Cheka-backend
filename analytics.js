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

// GET creator dashboard — 28-day timeseries + best posting hour heatmap + top hashtags + summary
router.get('/creator/me', requireAuth, async (req, res) => {
  try {
    const Video = require('./Video');
    const me = req.user.id;
    const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const videos = await Video.find({ creator: me }).select('_id title views likes loops saves shares reposts remixCount estimatedEarnings tipsReceived hashtags createdAt durationSec').lean();

    // Per-day totals from analytics events for this creator's videos
    const videoIds = videos.map(v => String(v._id));
    const events = await Analytics.find({
      type: { $in: ['video_view','video_like','video_loop','video_share'] },
      video: { $in: videoIds },
      createdAt: { $gte: since }
    }).select('type video createdAt').lean();

    // Day buckets (YYYY-MM-DD)
    const dayBuckets = {};
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayBuckets[key] = { date: key, views: 0, likes: 0, loops: 0, shares: 0 };
    }
    for (const ev of events) {
      const k = new Date(ev.createdAt).toISOString().slice(0, 10);
      if (!dayBuckets[k]) continue;
      if (ev.type === 'video_view') dayBuckets[k].views++;
      else if (ev.type === 'video_like') dayBuckets[k].likes++;
      else if (ev.type === 'video_loop') dayBuckets[k].loops++;
      else if (ev.type === 'video_share') dayBuckets[k].shares++;
    }
    const timeseries = Object.values(dayBuckets).sort((a, b) => a.date.localeCompare(b.date));

    // Best posting hour: count of cumulative views grouped by upload hour
    const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, views: 0 }));
    for (const v of videos) {
      const h = new Date(v.createdAt).getHours();
      hourBuckets[h].count++;
      hourBuckets[h].views += v.views || 0;
    }

    // Top hashtags
    const tagMap = {};
    for (const v of videos) {
      for (const t of v.hashtags || []) {
        tagMap[t] = (tagMap[t] || 0) + (v.views || 0) + (v.likes || 0) * 3;
      }
    }
    const topHashtags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, score]) => ({ tag, score }));

    // Top videos by engagement
    const topVideos = [...videos].map(v => ({
      ...v,
      engagement: (v.views || 0) + (v.likes || 0) * 5 + (v.loops || 0) * 0.5 + (v.saves || 0) * 4
    })).sort((a, b) => b.engagement - a.engagement).slice(0, 10);

    // Totals
    const totals = videos.reduce((acc, v) => {
      acc.videos++;
      acc.views += v.views || 0;
      acc.likes += v.likes || 0;
      acc.loops += v.loops || 0;
      acc.saves += v.saves || 0;
      acc.shares += v.shares || 0;
      acc.reposts += v.reposts || 0;
      acc.remixes += v.remixCount || 0;
      acc.earnings += v.estimatedEarnings || 0;
      acc.tips += v.tipsReceived || 0;
      return acc;
    }, { videos: 0, views: 0, likes: 0, loops: 0, saves: 0, shares: 0, reposts: 0, remixes: 0, earnings: 0, tips: 0 });
    totals.earnings = Number(totals.earnings.toFixed(4));

    res.json({ totals, timeseries, hourBuckets, topHashtags, topVideos });
  } catch (err) {
    console.error('creator analytics', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET per-video analytics (must be the owner)
router.get('/video/:id', requireAuth, async (req, res) => {
  try {
    const Video = require('./Video');
    const v = await Video.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ msg: 'Not found' });
    if (String(v.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const events = await Analytics.find({
      video: String(v._id),
      type: { $in: ['video_view','video_like','video_loop','video_share'] },
      createdAt: { $gte: since }
    }).select('type createdAt').lean();

    const buckets = {};
    for (let i = 0; i < 14; i++) {
      const k = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      buckets[k] = { date: k, views: 0, likes: 0, loops: 0, shares: 0 };
    }
    for (const ev of events) {
      const k = new Date(ev.createdAt).toISOString().slice(0, 10);
      if (!buckets[k]) continue;
      if (ev.type === 'video_view') buckets[k].views++;
      else if (ev.type === 'video_like') buckets[k].likes++;
      else if (ev.type === 'video_loop') buckets[k].loops++;
      else if (ev.type === 'video_share') buckets[k].shares++;
    }
    res.json({
      video: { _id: v._id, title: v.title, views: v.views, likes: v.likes, loops: v.loops, saves: v.saves, shares: v.shares, reposts: v.reposts, remixCount: v.remixCount, estimatedEarnings: v.estimatedEarnings, tipsReceived: v.tipsReceived, durationSec: v.durationSec },
      timeseries: Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date))
    });
  } catch (err) {
    console.error('video analytics', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
