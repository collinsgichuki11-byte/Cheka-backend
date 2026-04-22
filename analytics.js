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

// Helper: build a length-N daily series filling missing days with 0.
function fillDailySeries(rows, days) {
  const map = new Map((rows || []).map(r => [r._id, r.count]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const k = d.toISOString().slice(0, 10);
    out.push({ date: k, count: map.get(k) || 0 });
  }
  return out;
}

// GET /api/analytics/creator/me — overview for the authed user's own content
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
    const periodAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    const [videos, followerCount, totals] = await Promise.all([
      Video.find({ creator: meObjectId })
        .select('_id title hashtags createdAt views likes saves shares reposts remixCount loops estimatedEarnings')
        .lean(),
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
    const totalViews = videos.reduce((s, v) => s + (v.views || 0), 0);
    const totalLoops = videos.reduce((s, v) => s + (v.loops || 0), 0);

    const [views7d, views24h, viewsRows, likesRows, commentsRows, followerRows, topByViews, commentTotal] = await Promise.all([
      Analytics.countDocuments({ type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: weekAgo } }),
      Analytics.countDocuments({ type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: dayAgo } }),
      Analytics.aggregate([
        { $match: { type: 'video_view', video: { $in: videoIds }, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Analytics.aggregate([
        { $match: { type: 'video_like', video: { $in: videoIds }, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { video: { $in: videoIds }, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Follow.aggregate([
        { $match: { following: req.user.id, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Video.find({ creator: meObjectId }).sort({ views: -1 }).limit(10)
        .select('_id title views likes saves shares createdAt').lean(),
      Comment.countDocuments({ video: { $in: videoIds } })
    ]);

    // Trend series — 28 days, every day filled
    const trend = {
      views: fillDailySeries(viewsRows, 28),
      likes: fillDailySeries(likesRows, 28),
      comments: fillDailySeries(commentsRows, 28),
      followers: fillDailySeries(followerRows, 28)
    };

    // Watch completion proxy: loops counter increments each time a direct
    // video reaches its end. completion% = totalLoops / totalViews.
    const completionPct = totalViews > 0
      ? Math.min(100, Math.round((totalLoops / totalViews) * 1000) / 10)
      : 0;

    // Top hashtag — sums views across videos that use each tag.
    const tagViews = new Map();
    for (const v of videos) {
      for (const tag of (v.hashtags || [])) {
        tagViews.set(tag, (tagViews.get(tag) || 0) + (v.views || 0));
      }
    }
    const topHashtag = [...tagViews.entries()]
      .sort((a, b) => b[1] - a[1])[0] || null;

    const sum = totals[0] || { views: 0, likes: 0, saves: 0, shares: 0, reposts: 0, remixes: 0, loops: 0, earnings: 0 };

    res.json({
      videoCount: videos.length,
      followerCount,
      followerGrowth28d: trend.followers.reduce((s, x) => s + x.count, 0),
      totals: { ...sum, comments: commentTotal },
      views7d,
      views24h,
      completionPct,
      topHashtag: topHashtag ? { tag: topHashtag[0], views: topHashtag[1] } : null,
      trend,
      topByViews
    });
  } catch (err) {
    console.error('GET /analytics/creator/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/analytics/creator/heatmap/me — best-posting-hour heatmap.
// Aggregates each of the user's videos by (dayOfWeek, hourOfDay) over total
// views received. dayOfWeek: 1 = Sunday … 7 = Saturday (Mongo convention).
router.get('/creator/heatmap/me', auth, async (req, res) => {
  try {
    const Video = require('./Video');
    const mongoose = require('mongoose');
    const meObjectId = new mongoose.Types.ObjectId(req.user.id);
    const rows = await Video.aggregate([
      { $match: { creator: meObjectId } },
      { $group: {
          _id: {
            dow: { $dayOfWeek: '$createdAt' },
            hour: { $hour: '$createdAt' }
          },
          views: { $sum: '$views' },
          likes: { $sum: '$likes' },
          count: { $sum: 1 }
      } },
      { $project: { _id: 0, dow: '$_id.dow', hour: '$_id.hour', views: 1, likes: 1, count: 1 } }
    ]);
    // Build a 7x24 grid filled with zeros so the UI doesn't have to.
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let bestViews = -1; let best = null;
    for (const r of rows) {
      // Mongo $dayOfWeek: 1=Sun..7=Sat. Convert to 0..6 with 0=Sun for grid.
      const d = (r.dow - 1) % 7;
      grid[d][r.hour] = r.views;
      if (r.views > bestViews) { bestViews = r.views; best = { day: d, hour: r.hour, views: r.views }; }
    }
    res.json({ grid, best, rows });
  } catch (err) {
    console.error('GET /analytics/creator/heatmap/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/analytics/creator/video/:id — per-video drilldown
router.get('/creator/video/:id', auth, async (req, res) => {
  try {
    const Video = require('./Video');
    const Comment = require('./Comment');
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ msg: 'Invalid video id' });
    }
    const video = await Video.findById(req.params.id).lean();
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });

    const periodAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const [viewsRows, likesRows, sharesRows, commentRows, commentCount] = await Promise.all([
      Analytics.aggregate([
        { $match: { type: 'video_view', video: video._id, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Analytics.aggregate([
        { $match: { type: 'video_like', video: video._id, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Analytics.aggregate([
        { $match: { type: 'share', video: video._id, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { video: video._id, createdAt: { $gte: periodAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Comment.countDocuments({ video: video._id })
    ]);

    const completionPct = video.views > 0
      ? Math.min(100, Math.round(((video.loops || 0) / video.views) * 1000) / 10)
      : 0;

    res.json({
      video: {
        _id: video._id, title: video.title, caption: video.caption,
        category: video.category, hashtags: video.hashtags,
        createdAt: video.createdAt,
        views: video.views, likes: video.likes, saves: video.saves,
        shares: video.shares, reposts: video.reposts, remixes: video.remixCount,
        loops: video.loops, estimatedEarnings: video.estimatedEarnings
      },
      commentCount,
      completionPct,
      trend: {
        views: fillDailySeries(viewsRows, 28),
        likes: fillDailySeries(likesRows, 28),
        shares: fillDailySeries(sharesRows, 28),
        comments: fillDailySeries(commentRows, 28)
      }
    });
  } catch (err) {
    console.error('GET /analytics/creator/video/:id failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
