const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Video = require('./Video');
const User = require('./User');
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

const POPULATE_CREATOR = 'username displayName isVerified monetizationEnabled monetizationStatus';

// GET all videos with optional category filter
router.get('/', async (req, res) => {
  try {
    const filter = req.query.category ? { category: req.query.category } : {};
    const videos = await Video.find(filter).sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET trending videos - smart algorithm
router.get('/trending', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const videos = await Video.find({ createdAt: { $gte: oneWeekAgo } }).populate('creator', POPULATE_CREATOR);
    const scored = videos.map(v => {
      const ageHours = (Date.now() - new Date(v.createdAt)) / 3600000;
      const recencyBonus = ageHours < 24 ? 50 : ageHours < 48 ? 20 : 0;
      const score = (v.likes * 3) + (v.views * 1) + (v.loops * 0.5) + recencyBonus;
      return { ...v.toObject(), score };
    });
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 10));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET single video
router.get('/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('creator', POPULATE_CREATOR);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    res.json(video);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos by a specific creator (by userId)
router.get('/by-user/:userId', async (req, res) => {
  try {
    const videos = await Video.find({ creator: req.params.userId }).sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET videos liked by a specific user
router.get('/liked/:userId', async (req, res) => {
  try {
    const videos = await Video.find({ likedBy: req.params.userId }).sort({ createdAt: -1 }).populate('creator', POPULATE_CREATOR);
    res.json(videos);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit video
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, creatorName, videoUrl, category, monetized, caption, durationSec } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ msg: 'Title is required' });
    const youtubeId = getYoutubeId(youtubeUrl);
    if (!youtubeId && !videoUrl) return res.status(400).json({ msg: 'Please provide a YouTube URL or upload a video' });

    const video = new Video({
      title: title.trim().slice(0, 120),
      caption: (caption || '').toString().trim().slice(0, 300),
      youtubeUrl: youtubeUrl || '',
      youtubeId: youtubeId || '',
      videoUrl: videoUrl || '',
      videoType: videoUrl ? 'direct' : 'youtube',
      durationSec: Math.max(0, Math.min(600, Number(durationSec) || 0)),
      creator: req.user.id,
      creatorName,
      category,
      monetized: monetized !== false
    });
    await video.save();
    trackEvent('video_upload', { user: req.user.id, video: video._id, meta: { videoType: video.videoType, durationSec: video.durationSec } });
    res.json(video);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like/unlike — auth required, uses token user
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
    trackEvent(alreadyLiked ? 'video_unlike' : 'video_like', { user: userId, video: video._id });
    res.json({ likes: video.likes, liked: !alreadyLiked });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST increment view count + monetization accrual
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
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
        User.findByIdAndUpdate(video.creator, {
          $inc: { earningsBalance: perView, totalEarnings: perView }
        })
      ]);
    }
    trackEvent('video_view', { user: req.user?.id || null, video: video._id });
    res.json({ views: video.views });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST loop — Vine-style replay counter
router.post('/:id/loop', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { loops: 1 } },
      { new: true, projection: { loops: 1 } }
    );
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    trackEvent('video_loop', { user: req.user?.id || null, video: req.params.id });
    res.json({ loops: video.loops });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE video (only by creator or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    const requester = await User.findById(req.user.id);
    if (video.creator.toString() !== req.user.id && !requester?.isAdmin) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    await video.deleteOne();
    res.json({ msg: 'Video deleted' });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
