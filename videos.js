const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Video = require('./Video');

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

const getYoutubeId = (url) => {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

// GET all videos with optional category filter
router.get('/', async (req, res) => {
  try {
    const filter = req.query.category ? { category: req.query.category } : {};
    const videos = await Video.find(filter).sort({ createdAt: -1 });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit video
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, creatorName } = req.body;
    const youtubeId = getYoutubeId(youtubeUrl);
    if (!youtubeId) return res.status(400).json({ msg: 'Invalid YouTube URL' });
    const video = new Video({
      title, youtubeUrl, youtubeId,
      creator: req.user.id, creatorName
    });
    await video.save();
    res.json(video);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like/unlike
router.post('/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const video = await Video.findById(req.params.id);
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

// POST increment view count
router.post('/:id/view', async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    res.json({ views: video.views });
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

// GET trending videos (most liked this week)
router.get('/trending', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const videos = await Video.find({ createdAt: { $gte: oneWeekAgo } })
      .sort({ likes: -1 })
      .limit(10);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
