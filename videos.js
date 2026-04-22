const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Video = require('./Video');
const User = require('./User');
const Follow = require('./Follow');
const Notification = require('./Notification');
const PlatformSettings = require('./PlatformSettings');
const Analytics = require('./Analytics');

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

const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) { req.user = null; return next(); }
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); }
  catch { req.user = null; }
  next();
};

const getYoutubeId = (url) => {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

const trackEvent = (type, data) => {
  Analytics.create({ type, ...data }).catch(() => {});
};

const notify = (data) => {
  Notification.create(data).catch(() => {});
};

const normalizeCloudinaryUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com')) return url;
  if (!url.includes('/upload/')) return url;
  if (/\/upload\/[^/]*f_mp4/.test(url)) return url;
  return url.replace('/upload/', '/upload/f_mp4,vc_h264,q_auto/');
};

const decorateVideo = (v) => {
  if (!v) return v;
  const obj = typeof v.toObject === 'function' ? v.toObject() : v;
  if (obj.videoUrl) obj.videoUrl = normalizeCloudinaryUrl(obj.videoUrl);
  return obj;
};

// Pull #hashtags out of title + caption. Lowercased, deduped, max 10.
const extractHashtags = (...sources) => {
  const out = new Set();
  for (const s of sources) {
    if (!s) continue;
    const matches = String(s).match(/#([a-zA-Z0-9_]{1,30})/g);
    if (!matches) continue;
    for (const m of matches) {
      const tag = m.slice(1).toLowerCase();
      if (tag) out.add(tag);
      if (out.size >= 10) break;
    }
  }
  return [...out];
};

const POPULATE_CREATOR = 'username displayName isVerified monetizationEnabled monetizationStatus isPrivate';

// Hide private videos from anonymous viewers and from users who are not the owner.
const visibilityFilter = (req) => {
  const me = req.user?.id;
  // Combine published + privacy clauses with $and so neither $or wipes the other.
  const publishedOr = [
    { publishAt: null },
    { publishAt: { $exists: false } },
    { publishAt: { $lte: new Date() } }
  ];
  if (!me) {
    return { isDraft: { $ne: true }, isPrivate: { $ne: true }, $or: publishedOr };
  }
  // Owner can see their own private posts in mixed feeds; drafts/scheduled stay
  // hidden from feeds and only surface through /drafts/me and /scheduled/me.
  return {
    isDraft: { $ne: true },
    $and: [
      { $or: publishedOr },
      { $or: [{ isPrivate: { $ne: true } }, { creator: me }] }
    ]
  };
};

// GET all videos — smart "For You" feed
// Sort modes: ?sort=foryou (default) | latest | category
router.get('/', optionalAuth, async (req, res) => {
  try {
    const filter = { ...visibilityFilter(req) };
    if (req.query.category) filter.category = req.query.category;
    const sort = String(req.query.sort || 'foryou').toLowerCase();

    if (sort === 'latest') {
      const videos = await Video.find(filter).sort({ createdAt: -1 }).limit(120).populate('creator', POPULATE_CREATOR);
      return res.json(videos.map(decorateVideo));
    }

    // Smart feed: pull recent pool, score, then weave with diversity penalty so
    // a single creator can't dominate the top.
    const pool = await Video.find(filter)
      .sort({ createdAt: -1 })
      .limit(400)
      .populate('creator', POPULATE_CREATOR);

    // Build user interaction signals (cheap — tiny lists already on the doc)
    const me = req.user?.id;
    let likedSet = new Set(), savedSet = new Set(), followingSet = new Set();
    if (me) {
      try {
        const follows = await Follow.find({ follower: me }).select('following').lean();
        followingSet = new Set(follows.map(f => String(f.following)));
      } catch (_) {}
    }

    const now = Date.now();
    const scored = pool.map(v => {
      const ageHrs = Math.max(1, (now - new Date(v.createdAt)) / 3_600_000);
      const recency = 100 / Math.pow(ageHrs, 0.55);
      const engagement = (v.likes || 0) * 3 + (v.views || 0) * 0.5 + (v.loops || 0) * 0.3
        + (v.saves || 0) * 4 + (v.reposts || 0) * 5 + (v.remixCount || 0) * 6;
      const creatorId = String(v.creator?._id || v.creator || '');
      const followingBoost = me && followingSet.has(creatorId) ? 35 : 0;
      const verifiedBoost = v.creator?.isVerified ? 8 : 0;
      const tipBoost = (v.tipsReceived || 0) * 1.5;
      const myLikedPenalty = me && (v.likedBy || []).includes(me) ? -40 : 0; // de-dup what I already liked
      const score = recency + engagement + followingBoost + verifiedBoost + tipBoost + myLikedPenalty;
      return { v, score, creatorId };
    }).sort((a, b) => b.score - a.score);

    // Diversity weave: cap any single creator at 2 in the top 30 slots.
    const out = [];
    const used = new Map(); // creatorId -> count
    const overflow = [];
    for (const item of scored) {
      const c = used.get(item.creatorId) || 0;
      if (c < 2) {
        out.push(item.v);
        used.set(item.creatorId, c + 1);
      } else {
        overflow.push(item.v);
      }
      if (out.length >= 60) break;
    }
    while (out.length < 60 && overflow.length) out.push(overflow.shift());

    res.json(out.map(decorateVideo));
  } catch (err) {
    console.error('GET /videos failed:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET trending — smart score
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const filter = { ...visibilityFilter(req), createdAt: { $gte: oneWeekAgo } };
    const videos = await Video.find(filter).populate('creator', POPULATE_CREATOR);
    const scored = videos.map(v => {
      const ageHours = (Date.now() - new Date(v.createdAt)) / 3600000;
      const recencyBonus = ageHours < 24 ? 50 : ageHours < 48 ? 20 : 0;
      const remixBoost = (v.remixCount || 0) * 5;
      const repostBoost = (v.reposts || 0) * 4;
      const saveBoost = (v.saves || 0) * 2;
      const score = (v.likes * 3) + (v.views * 1) + (v.loops * 0.5) + remixBoost + repostBoost + saveBoost + recencyBonus;
      return { ...decorateVideo(v), score };
    });
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 20));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET following feed — videos from users the auth user follows
router.get('/following-feed', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ follower: req.user.id }).select('following');
    const ids = follows.map(f => f.following);
    if (!ids.length) return res.json([]);
    const videos = await Video.find({ creator: { $in: ids }, isPrivate: { $ne: true } })
      .sort({ createdAt: -1 }).limit(60).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos by hashtag
router.get('/by-hashtag/:tag', optionalAuth, async (req, res) => {
  try {
    const tag = String(req.params.tag || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if (!tag) return res.json([]);
    const filter = { ...visibilityFilter(req), hashtags: tag };
    const videos = await Video.find(filter).sort({ likes: -1, createdAt: -1 }).limit(60).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET trending hashtags (top 20)
router.get('/hashtags/trending', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const agg = await Video.aggregate([
      { $match: { createdAt: { $gte: oneWeekAgo }, isPrivate: { $ne: true }, hashtags: { $exists: true, $ne: [] } } },
      { $unwind: '$hashtags' },
      { $group: { _id: '$hashtags', count: { $sum: 1 }, likes: { $sum: '$likes' }, views: { $sum: '$views' } } },
      { $project: { _id: 0, tag: '$_id', count: 1, likes: 1, views: 1, score: { $add: ['$count', { $divide: ['$likes', 5] }, { $divide: ['$views', 50] }] } } },
      { $sort: { score: -1 } },
      { $limit: 20 }
    ]);
    res.json(agg);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos saved by current user
router.get('/saved/me', auth, async (req, res) => {
  try {
    const videos = await Video.find({ savedBy: req.user.id, isPrivate: { $ne: true } })
      .sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos by username (handle)
router.get('/by-username/:username', optionalAuth, async (req, res) => {
  try {
    const u = await User.findOne({ username: req.params.username }).select('_id isPrivate');
    if (!u) return res.status(404).json({ msg: 'User not found' });
    const isOwner = req.user?.id === String(u._id);
    if (u.isPrivate && !isOwner) return res.json([]);
    const videos = await Video.find({ creator: u._id, isPrivate: isOwner ? undefined : { $ne: true } })
      .sort({ isPinned: -1, createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET single video
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('creator', POPULATE_CREATOR);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (video.isPrivate && String(video.creator?._id || video.creator) !== req.user?.id) {
      return res.status(403).json({ msg: 'This video is private' });
    }
    res.json(decorateVideo(video));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos by user ID — sorted with pinned first
// ?reposts=1 returns videos this user has reposted (not authored)
router.get('/by-user/:userId', optionalAuth, async (req, res) => {
  try {
    const isOwner = req.user?.id === req.params.userId;
    let filter;
    if (req.query.reposts === '1') {
      filter = { repostedBy: req.params.userId, isPrivate: { $ne: true } };
    } else {
      filter = { creator: req.params.userId };
      if (!isOwner) filter.isPrivate = { $ne: true };
    }
    const videos = await Video.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos liked by a user
router.get('/liked/:userId', async (req, res) => {
  try {
    const videos = await Video.find({ likedBy: req.params.userId, isPrivate: { $ne: true } })
      .sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET remixes of a video
router.get('/:id/remixes', async (req, res) => {
  try {
    const remixes = await Video.find({ remixOf: req.params.id, isPrivate: { $ne: true } })
      .sort({ likes: -1, createdAt: -1 })
      .populate('creator', POPULATE_CREATOR);
    res.json(remixes.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit video
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, videoUrl, category, monetized, caption, durationSec, remixOf, isPrivate, isDraft, publishAt, isDuet, audioOf, chapters } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ msg: 'Title is required' });
    const youtubeId = getYoutubeId(youtubeUrl);
    if (!youtubeId && !videoUrl) return res.status(400).json({ msg: 'Please provide a YouTube URL or upload a video' });

    const isObjId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

    let remixOfId = null;
    if (remixOf) {
      if (!isObjId(remixOf)) return res.status(400).json({ msg: 'Invalid remix reference' });
      const original = await Video.findById(remixOf).select('_id creator title');
      if (!original) return res.status(400).json({ msg: 'Original video for remix not found' });
      remixOfId = original._id;
    }

    let audioOfId = null;
    if (audioOf) {
      if (!isObjId(audioOf)) return res.status(400).json({ msg: 'Invalid sound reference' });
      const sound = await Video.findById(audioOf).select('_id');
      if (!sound) return res.status(400).json({ msg: 'Sound not found' });
      audioOfId = sound._id;
    }

    const creator = await User.findById(req.user.id).select('username displayName notifyOnRemix');
    if (!creator) return res.status(401).json({ msg: 'User not found' });
    const ALLOWED_CATEGORIES = new Set(['General','Comedy','Skits','Memes','Roasts','Standup']);
    const safeCategory = ALLOWED_CATEGORIES.has(category) ? category : 'General';

    const cleanTitle = title.trim().slice(0, 120);
    const cleanCaption = (caption || '').toString().trim().slice(0, 300);

    // Schedule: only future ISO strings count; past dates publish immediately.
    let scheduledAt = null;
    if (publishAt) {
      const d = new Date(publishAt);
      if (!isNaN(d) && d.getTime() > Date.now() + 30_000) scheduledAt = d;
    }

    // Chapters validation (max 10, sorted by t)
    const safeChapters = Array.isArray(chapters)
      ? chapters
          .filter(c => c && typeof c.t === 'number' && typeof c.label === 'string')
          .map(c => ({ t: Math.max(0, Math.floor(c.t)), label: String(c.label).slice(0, 60) }))
          .sort((a, b) => a.t - b.t)
          .slice(0, 10)
      : [];

    const video = new Video({
      title: cleanTitle,
      caption: cleanCaption,
      youtubeUrl: youtubeUrl || '',
      youtubeId: youtubeId || '',
      videoUrl: normalizeCloudinaryUrl(videoUrl || ''),
      videoType: videoUrl ? 'direct' : 'youtube',
      durationSec: Math.max(0, Math.min(600, Number(durationSec) || 0)),
      creator: req.user.id,
      creatorName: creator.displayName || creator.username,
      category: safeCategory,
      monetized: monetized !== false,
      isPrivate: !!isPrivate,
      isDraft: !!isDraft,
      publishAt: scheduledAt,
      isDuet: !!isDuet,
      audioOf: audioOfId,
      chapters: safeChapters,
      hashtags: extractHashtags(cleanTitle, cleanCaption),
      remixOf: remixOfId
    });
    await video.save();

    if (remixOfId) {
      const original = await Video.findByIdAndUpdate(remixOfId, { $inc: { remixCount: 1 } }, { new: true }).select('creator title');
      // Notify the original creator (if not self)
      if (original && String(original.creator) !== req.user.id) {
        const owner = await User.findById(original.creator).select('notifyOnRemix');
        if (owner?.notifyOnRemix !== false) {
          notify({ recipient: String(original.creator), sender: req.user.id, type: 'remix', videoTitle: original.title, videoId: String(original._id), snippet: cleanTitle });
        }
      }
    }

    trackEvent('video_upload', { user: req.user.id, video: video._id, meta: { videoType: video.videoType, durationSec: video.durationSec, remix: !!remixOfId } });
    res.json(decorateVideo(video));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like / unlike
router.post('/:id/like', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const alreadyLiked = video.likedBy.includes(userId);
    if (alreadyLiked) {
      video.likes = Math.max(0, video.likes - 1);
      video.likedBy = video.likedBy.filter(id => id !== userId);
    } else {
      video.likes += 1;
      video.likedBy.push(userId);
    }
    await video.save();
    if (!alreadyLiked && String(video.creator) !== userId) {
      const owner = await User.findById(video.creator).select('notifyOnLike');
      if (owner?.notifyOnLike !== false) {
        notify({ recipient: String(video.creator), sender: userId, type: 'like', videoTitle: video.title, videoId: String(video._id) });
      }
    }
    trackEvent(alreadyLiked ? 'video_unlike' : 'video_like', { user: userId, video: video._id });
    res.json({ likes: video.likes, liked: !alreadyLiked });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST save / unsave (bookmark)
router.post('/:id/save', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const already = video.savedBy.includes(userId);
    if (already) {
      video.savedBy = video.savedBy.filter(id => id !== userId);
      video.saves = Math.max(0, video.saves - 1);
    } else {
      video.savedBy.push(userId);
      video.saves += 1;
    }
    await video.save();
    res.json({ saved: !already, saves: video.saves });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST share — increments share counter
router.post('/:id/share', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { shares: 1 } }, { new: true, projection: { shares: 1 } });
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    trackEvent('video_share', { user: req.user?.id || null, video: req.params.id });
    res.json({ shares: video.shares });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST repost / un-repost — adds video to your followers' feed signal
router.post('/:id/repost', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const already = video.repostedBy.includes(userId);
    if (already) {
      video.repostedBy = video.repostedBy.filter(id => id !== userId);
      video.reposts = Math.max(0, video.reposts - 1);
    } else {
      video.repostedBy.push(userId);
      video.reposts += 1;
      if (String(video.creator) !== userId) {
        notify({ recipient: String(video.creator), sender: userId, type: 'repost', videoTitle: video.title, videoId: String(video._id) });
      }
    }
    await video.save();
    res.json({ reposted: !already, reposts: video.reposts });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST pin / unpin own video on profile (max 3 pinned)
router.post('/:id/pin', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    if (!video.isPinned) {
      const pinnedCount = await Video.countDocuments({ creator: req.user.id, isPinned: true });
      if (pinnedCount >= 3) return res.status(400).json({ msg: 'You can pin at most 3 videos' });
    }
    video.isPinned = !video.isPinned;
    await video.save();
    res.json({ isPinned: video.isPinned });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST toggle privacy on own video
router.post('/:id/privacy', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    video.isPrivate = !video.isPrivate;
    await video.save();
    res.json({ isPrivate: video.isPrivate });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST toggle comments lock on own video
router.post('/:id/comments-lock', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    video.commentsDisabled = !video.commentsDisabled;
    await video.save();
    res.json({ commentsDisabled: video.commentsDisabled });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST view (with monetization)
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const [creator, settings] = await Promise.all([
      User.findById(video.creator),
      PlatformSettings.findOne({ key: 'main' })
    ]);
    const monetizationAllowed = settings?.monetizationEnabled !== false;
    if (video.monetized && monetizationAllowed && creator?.monetizationEnabled && creator.monetizationStatus === 'active') {
      const perView = Math.max(0, Number(settings?.platformCpm ?? 3)) / 1000;
      video.estimatedEarnings = Number(((video.estimatedEarnings || 0) + perView).toFixed(4));
      await Promise.all([
        video.save(),
        User.findByIdAndUpdate(video.creator, { $inc: { earningsBalance: perView, totalEarnings: perView } })
      ]);
    }
    trackEvent('video_view', { user: req.user?.id || null, video: video._id });
    res.json({ views: video.views });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST loop counter
router.post('/:id/loop', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { loops: 1 } }, { new: true, projection: { loops: 1 } });
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    trackEvent('video_loop', { user: req.user?.id || null, video: req.params.id });
    res.json({ loops: video.loops });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE video — creator or admin. Also orphans remixes and decrements parent count.
router.delete('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const requester = await User.findById(req.user.id);
    if (video.creator.toString() !== req.user.id && !requester?.isAdmin) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    const parentId = video.remixOf;
    await video.deleteOne();
    await Promise.all([
      Video.updateMany({ remixOf: req.params.id }, { $set: { remixOf: null } }),
      parentId ? Video.findByIdAndUpdate(parentId, { $inc: { remixCount: -1 } }) : Promise.resolve()
    ]);
    res.json({ msg: 'Video deleted' });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET drafts for current user
router.get('/drafts/me', auth, async (req, res) => {
  try {
    const drafts = await Video.find({ creator: req.user.id, isDraft: true })
      .sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(drafts.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET scheduled posts for current user
router.get('/scheduled/me', auth, async (req, res) => {
  try {
    const sched = await Video.find({ creator: req.user.id, publishAt: { $gt: new Date() }, isDraft: { $ne: true } })
      .sort({ publishAt: 1 }).populate('creator', POPULATE_CREATOR);
    res.json(sched.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST publish a draft / scheduled video immediately
router.post('/:id/publish', auth, async (req, res) => {
  try {
    const v = await Video.findById(req.params.id);
    if (!v) return res.status(404).json({ msg: 'Not found' });
    if (String(v.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    v.isDraft = false;
    v.publishAt = null;
    v.createdAt = new Date(); // surface at top of feed
    await v.save();
    res.json(decorateVideo(v));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH update schedule on own video
router.patch('/:id/schedule', auth, async (req, res) => {
  try {
    const v = await Video.findById(req.params.id);
    if (!v) return res.status(404).json({ msg: 'Not found' });
    if (String(v.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    const { publishAt } = req.body || {};
    if (!publishAt) {
      v.publishAt = null;
    } else {
      const d = new Date(publishAt);
      if (isNaN(d) || d.getTime() < Date.now()) return res.status(400).json({ msg: 'Schedule date must be in the future' });
      v.publishAt = d;
      v.isDraft = false;
    }
    await v.save();
    res.json({ publishAt: v.publishAt });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH chapters on own video
router.patch('/:id/chapters', auth, async (req, res) => {
  try {
    const v = await Video.findById(req.params.id);
    if (!v) return res.status(404).json({ msg: 'Not found' });
    if (String(v.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    const list = Array.isArray(req.body?.chapters) ? req.body.chapters : [];
    v.chapters = list
      .filter(c => c && typeof c.t === 'number' && typeof c.label === 'string')
      .map(c => ({ t: Math.max(0, Math.floor(c.t)), label: String(c.label).slice(0, 60) }))
      .sort((a, b) => a.t - b.t).slice(0, 10);
    await v.save();
    res.json({ chapters: v.chapters });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST tip — send coins from current user to a video's creator
router.post('/:id/tip', auth, async (req, res) => {
  try {
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (amount <= 0 || amount > 1000) return res.status(400).json({ msg: 'Amount must be 1–1000 coins' });
    const v = await Video.findById(req.params.id);
    if (!v) return res.status(404).json({ msg: 'Video not found' });
    if (String(v.creator) === req.user.id) return res.status(400).json({ msg: 'You cannot tip yourself' });
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ msg: 'User not found' });
    if ((me.coins || 0) < amount) return res.status(400).json({ msg: 'Not enough coins. Top up first.' });

    me.coins = (me.coins || 0) - amount;
    await me.save();
    await Promise.all([
      User.findByIdAndUpdate(v.creator, { $inc: { coins: amount, totalTipsReceived: amount } }),
      Video.findByIdAndUpdate(v._id, { $inc: { tipsReceived: amount } })
    ]);
    notify({
      recipient: String(v.creator),
      sender: req.user.id,
      type: 'tip',
      videoTitle: v.title,
      videoId: String(v._id),
      snippet: `+${amount} coins`
    });
    trackEvent('tip', { user: req.user.id, video: v._id, meta: { amount } });
    res.json({ ok: true, amount, balance: me.coins });
  } catch (err) {
    console.error('tip error', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos using a given audio/sound (audioOf reference)
router.get('/by-sound/:videoId', optionalAuth, async (req, res) => {
  try {
    const filter = { ...visibilityFilter(req), $or: [{ _id: req.params.videoId }, { audioOf: req.params.videoId }] };
    const list = await Video.find(filter).sort({ likes: -1, createdAt: -1 }).limit(60).populate('creator', POPULATE_CREATOR);
    res.json(list.map(decorateVideo));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET trending sounds (videos referenced as audioOf or original sounds with audioUrl)
router.get('/sounds/trending', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const agg = await Video.aggregate([
      { $match: { audioOf: { $ne: null }, createdAt: { $gte: oneWeekAgo } } },
      { $group: { _id: '$audioOf', uses: { $sum: 1 } } },
      { $sort: { uses: -1 } },
      { $limit: 20 }
    ]);
    const ids = agg.map(a => a._id);
    const sources = await Video.find({ _id: { $in: ids } }).select('title creatorName videoUrl youtubeId').lean();
    const byId = Object.fromEntries(sources.map(s => [String(s._id), s]));
    res.json(agg.map(a => ({ videoId: a._id, uses: a.uses, source: byId[String(a._id)] || null })));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
