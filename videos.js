const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Video = require('./Video');
const Prompt = require('./Prompt');

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

// Optional auth — sets req.user if token present, but doesn't block
const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {}
  }
  next();
};

const getYoutubeId = (url) => {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

const isHttpsUrl = (s) => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s.trim());

function nairobiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

// GET trending videos
router.get('/trending', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const videos = await Video.find({ createdAt: { $gte: oneWeekAgo } });
    const scored = videos.map(v => {
      const ageHours = (Date.now() - new Date(v.createdAt)) / 3600000;
      const recencyBonus = ageHours < 24 ? 50 : ageHours < 48 ? 20 : 0;
      const score = (v.likes * 3) + (v.views * 1) + recencyBonus;
      return { ...v.toObject(), score };
    });
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 10));
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET all videos with optional category filter — only playable ones
router.get('/', async (req, res) => {
  try {
    const filter = req.query.category ? { category: req.query.category } : {};
    let videos = await Video.find(filter).sort({ createdAt: -1 });
    videos = videos.filter(v =>
      (v.videoType === 'direct' && /^https:\/\//.test(v.videoUrl || '')) ||
      (v.videoType === 'youtube' && v.youtubeId && v.youtubeId.length > 3)
    );
    res.set('Cache-Control', 'no-store');
    res.json(videos);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit video — requires auth
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, creatorName, videoUrl, category, enterBattle } = req.body;

    if (!title || !title.trim()) return res.status(400).json({ msg: 'Title is required' });
    if (!creatorName || !creatorName.trim()) return res.status(400).json({ msg: 'Creator name missing — please log in again' });

    const trimmedTitle = String(title).trim().slice(0, 200);
    const trimmedVideoUrl = (videoUrl || '').trim();
    const trimmedYoutubeUrl = (youtubeUrl || '').trim();
    const youtubeId = getYoutubeId(trimmedYoutubeUrl);

    let videoType, finalVideoUrl = '', finalYoutubeId = '', finalYoutubeUrl = '';

    if (trimmedVideoUrl) {
      if (!isHttpsUrl(trimmedVideoUrl)) {
        return res.status(400).json({ msg: 'Video URL is invalid. Please re-upload your video.' });
      }
      videoType = 'direct';
      finalVideoUrl = trimmedVideoUrl;
    } else if (youtubeId) {
      videoType = 'youtube';
      finalYoutubeId = youtubeId;
      finalYoutubeUrl = trimmedYoutubeUrl;
    } else {
      return res.status(400).json({ msg: 'Please upload a video file or paste a valid YouTube URL.' });
    }

    let promptDate = '';
    if (enterBattle) {
      const today = nairobiToday();
      const todayPrompt = await Prompt.findOne({ date: today });
      if (todayPrompt) promptDate = today;
    }

    const allowedCategories = ['General','Comedy','Skits','Memes','Roasts','Standup'];
    const safeCategory = allowedCategories.includes(category) ? category : 'General';

    const video = new Video({
      title: trimmedTitle,
      youtubeUrl: finalYoutubeUrl,
      youtubeId: finalYoutubeId,
      videoUrl: finalVideoUrl,
      videoType,
      creator: req.user.id,
      creatorName: String(creatorName).trim().slice(0, 30),
      category: safeCategory,
      promptDate
    });
    await video.save();
    res.json(video);
  } catch (err) {
    console.error('Video upload error:', err);
    res.status(500).json({ msg: 'Server error: ' + (err.message || 'unknown') });
  }
});

// POST like/unlike — REQUIRES auth, uses token user ID (not body)
router.post('/:id/like', auth, async (req, res) => {
  try {
    const userId = req.user.id; // from token, NOT body — secure
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
    res.json({ likes: video.likes, liked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST increment view count — public but rate-limited per IP via simple in-memory map
const viewCache = new Map();
router.post('/:id/view', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${ip}:${req.params.id}`;
    const now = Date.now();
    const last = viewCache.get(key);
    // Throttle: same IP can't bump views for the same video more than once per 5 minutes
    if (last && now - last < 5 * 60 * 1000) {
      const v = await Video.findById(req.params.id).select('views');
      return res.json({ views: v?.views || 0 });
    }
    viewCache.set(key, now);
    // Cleanup old entries every ~100 calls
    if (viewCache.size > 5000) {
      for (const [k, t] of viewCache) if (now - t > 10 * 60 * 1000) viewCache.delete(k);
    }
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    res.json({ views: video?.views || 0 });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE video (only by creator)
router.delete('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (video.creator.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    await video.deleteOne();
    res.json({ msg: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
