const express = require('express');
const router = express.Router();
const Video = require('./Video');
const User = require('./User');
const Follow = require('./Follow');
const Notification = require('./Notification');
const PlatformSettings = require('./PlatformSettings');
const Analytics = require('./Analytics');
const Prompt = require('./Prompt');
const Comment = require('./Comment');
const { auth, optionalAuth, isValidId } = require('./lib/auth');
const { rankVideos } = require('./lib/rank');

const getYoutubeId = (url) => {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

const trackEvent = (type, data) => {
  Analytics.create({ type, ...data }).catch(err => console.error('analytics failed:', err.message));
};

const notify = (data) => {
  Notification.create(data).catch(err => console.error('notify failed:', err.message));
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
  if (!me) return { isPrivate: { $ne: true } };
  return { $or: [{ isPrivate: { $ne: true } }, { creator: me }] };
};

// GET all videos (For You feed) with optional category filter.
// Uses smart ranking by default; pass ?sort=new for raw recency.
router.get('/', optionalAuth, async (req, res) => {
  try {
    const filter = { ...visibilityFilter(req) };
    if (req.query.category) filter.category = req.query.category;
    const limit = Math.min(120, Math.max(20, Number(req.query.limit) || 60));
    if (req.query.sort === 'new') {
      const videos = await Video.find(filter).sort({ createdAt: -1 }).limit(limit)
        .populate('creator', POPULATE_CREATOR);
      return res.json(videos.map(decorateVideo));
    }
    // Pull a recent candidate pool then re-rank in memory.
    const pool = await Video.find(filter).sort({ createdAt: -1 }).limit(400)
      .populate('creator', POPULATE_CREATOR);
    let followedIds = null;
    if (req.user?.id) {
      const follows = await Follow.find({ follower: req.user.id }).select('following').lean();
      followedIds = new Set(follows.map(f => String(f.following)));
    }
    const ranked = rankVideos(pool, { followedIds });
    res.json(ranked.slice(0, limit).map(decorateVideo));
  } catch (err) {
    console.error('GET /videos failed:', err);
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
  } catch (err) {
    console.error('GET /videos/trending failed:', err);
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
  } catch (err) {
    console.error('GET /videos/following-feed failed:', err);
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
  } catch (err) {
    console.error('GET /videos/by-hashtag/:tag failed:', err);
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
  } catch (err) {
    console.error('GET /videos/hashtags/trending failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos saved by current user
router.get('/saved/me', auth, async (req, res) => {
  try {
    const videos = await Video.find({ savedBy: req.user.id, isPrivate: { $ne: true } })
      .sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch (err) {
    console.error('GET /videos/saved/me failed:', err);
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
  } catch (err) {
    console.error('GET /videos/by-username/:username failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET single video
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const video = await Video.findById(req.params.id).populate('creator', POPULATE_CREATOR);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (video.isPrivate && String(video.creator?._id || video.creator) !== req.user?.id) {
      return res.status(403).json({ msg: 'This video is private' });
    }
    res.json(decorateVideo(video));
  } catch (err) {
    console.error('GET /videos/:id failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos by user ID — sorted with pinned first
// ?reposts=1 returns videos this user has reposted (not authored)
router.get('/by-user/:userId', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
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
  } catch (err) {
    console.error('GET /videos/by-user/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos liked by a user
router.get('/liked/:userId', async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const videos = await Video.find({ likedBy: req.params.userId, isPrivate: { $ne: true } })
      .sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos.map(decorateVideo));
  } catch (err) {
    console.error('GET /videos/liked/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET remixes of a video
router.get('/:id/remixes', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const remixes = await Video.find({ remixOf: req.params.id, isPrivate: { $ne: true } })
      .sort({ likes: -1, createdAt: -1 })
      .populate('creator', POPULATE_CREATOR);
    res.json(remixes.map(decorateVideo));
  } catch (err) {
    console.error('GET /videos/:id/remixes failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit video
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, videoUrl, category, monetized, caption, durationSec, remixOf, isPrivate } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ msg: 'Title is required' });
    const youtubeId = getYoutubeId(youtubeUrl);
    if (!youtubeId && !videoUrl) return res.status(400).json({ msg: 'Please provide a YouTube URL or upload a video' });

    let remixOfId = null;
    if (remixOf) {
      if (!isValidId(remixOf)) return res.status(400).json({ msg: 'Invalid remix source id' });
      const original = await Video.findById(remixOf).select('_id creator title');
      if (!original) return res.status(400).json({ msg: 'Original video for remix not found' });
      remixOfId = original._id;
    }

    const creator = await User.findById(req.user.id).select('username displayName notifyOnRemix');
    if (!creator) return res.status(401).json({ msg: 'User not found' });
    const ALLOWED_CATEGORIES = new Set(['General','Comedy','Skits','Memes','Roasts','Standup']);
    const safeCategory = ALLOWED_CATEGORIES.has(category) ? category : 'General';

    const cleanTitle = title.trim().slice(0, 120);
    const cleanCaption = (caption || '').toString().trim().slice(0, 300);

    // Stamp the video with today's prompt date if there is an active prompt for
    // the day, so /api/battles can group entries without a separate join.
    const today = new Date().toISOString().slice(0, 10);
    const todaysPrompt = await Prompt.findOne({ date: today }).select('_id').catch(() => null);
    const promptDate = todaysPrompt ? today : '';

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
      hashtags: extractHashtags(cleanTitle, cleanCaption),
      remixOf: remixOfId,
      promptDate
    });
    await video.save();

    if (remixOfId) {
      const original = await Video.findByIdAndUpdate(remixOfId, { $inc: { remixCount: 1 } }, { new: true }).select('creator title');
      if (original && String(original.creator) !== req.user.id) {
        const owner = await User.findById(original.creator).select('notifyOnRemix');
        if (owner?.notifyOnRemix !== false) {
          notify({ recipient: String(original.creator), sender: req.user.id, type: 'remix', videoTitle: original.title, videoId: String(original._id), snippet: cleanTitle });
        }
      }
    }

    trackEvent('video_upload', { user: req.user.id, video: video._id, meta: { videoType: video.videoType, durationSec: video.durationSec, remix: !!remixOfId } });
    res.json(decorateVideo(video));
  } catch (err) {
    console.error('POST /videos failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like / unlike
router.post('/:id/like', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const userId = String(req.user.id);
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const likedByStrings = (video.likedBy || []).map(String);
    const alreadyLiked = likedByStrings.includes(userId);
    if (alreadyLiked) {
      video.likes = Math.max(0, video.likes - 1);
      video.likedBy = likedByStrings.filter(id => id !== userId);
    } else {
      video.likes += 1;
      video.likedBy = [...likedByStrings, userId];
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
  } catch (err) {
    console.error('POST /videos/:id/like failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST save / unsave (bookmark)
router.post('/:id/save', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const userId = String(req.user.id);
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const savedByStrings = (video.savedBy || []).map(String);
    const already = savedByStrings.includes(userId);
    if (already) {
      video.savedBy = savedByStrings.filter(id => id !== userId);
      video.saves = Math.max(0, video.saves - 1);
    } else {
      video.savedBy = [...savedByStrings, userId];
      video.saves += 1;
    }
    await video.save();
    res.json({ saved: !already, saves: video.saves });
  } catch (err) {
    console.error('POST /videos/:id/save failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST share — increments share counter
router.post('/:id/share', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { shares: 1 } }, { new: true, projection: { shares: 1 } });
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    trackEvent('video_share', { user: req.user?.id || null, video: req.params.id });
    res.json({ shares: video.shares });
  } catch (err) {
    console.error('POST /videos/:id/share failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST repost / un-repost — adds video to your followers' feed signal
router.post('/:id/repost', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const userId = String(req.user.id);
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const repostedStrings = (video.repostedBy || []).map(String);
    const already = repostedStrings.includes(userId);
    if (already) {
      video.repostedBy = repostedStrings.filter(id => id !== userId);
      video.reposts = Math.max(0, video.reposts - 1);
    } else {
      video.repostedBy = [...repostedStrings, userId];
      video.reposts += 1;
      if (String(video.creator) !== userId) {
        notify({ recipient: String(video.creator), sender: userId, type: 'repost', videoTitle: video.title, videoId: String(video._id) });
      }
    }
    await video.save();
    res.json({ reposted: !already, reposts: video.reposts });
  } catch (err) {
    console.error('POST /videos/:id/repost failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST pin / unpin own video on profile (max 3 pinned)
router.post('/:id/pin', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
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
  } catch (err) {
    console.error('POST /videos/:id/pin failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST toggle privacy on own video
router.post('/:id/privacy', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    video.isPrivate = !video.isPrivate;
    await video.save();
    res.json({ isPrivate: video.isPrivate });
  } catch (err) {
    console.error('POST /videos/:id/privacy failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST toggle comments lock on own video
router.post('/:id/comments-lock', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (String(video.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    video.commentsDisabled = !video.commentsDisabled;
    await video.save();
    res.json({ commentsDisabled: video.commentsDisabled });
  } catch (err) {
    console.error('POST /videos/:id/comments-lock failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST view (with monetization)
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
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
  } catch (err) {
    console.error('POST /videos/:id/view failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST loop counter
router.post('/:id/loop', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { loops: 1 } }, { new: true, projection: { loops: 1 } });
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    trackEvent('video_loop', { user: req.user?.id || null, video: req.params.id });
    res.json({ loops: video.loops });
  } catch (err) {
    console.error('POST /videos/:id/loop failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE video — creator or admin. Also orphans remixes and decrements parent count.
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid video id' });
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
  } catch (err) {
    console.error('DELETE /videos/:id failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
