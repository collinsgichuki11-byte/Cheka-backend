const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Video = require('./Video');

// Middleware to verify token
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

// Helper to extract YouTube ID
const getYoutubeId = (url) => {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

// GET all videos
router.get('/', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST submit a video
router.post('/', auth, async (req, res) => {
  try {
    const { title, youtubeUrl, creatorName } = req.body;
    const youtubeId = getYoutubeId(youtubeUrl);
    if (!youtubeId) return res.status(400).json({ msg: 'Invalid YouTube URL' });

    const video = new Video({
      title,
      youtubeUrl,
      youtubeId,
      creator: req.user.id,
      creatorName
    });

    await video.save();
    res.json(video);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like/unlike a video
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

module.exports = router;
