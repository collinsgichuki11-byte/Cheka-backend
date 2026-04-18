const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Comment = require('./Comment');

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

// GET comments for a video
router.get('/:videoId', async (req, res) => {
  try {
    const comments = await Comment.find({ video: req.params.videoId })
      .sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST add a comment
router.post('/:videoId', auth, async (req, res) => {
  try {
    const { text, username } = req.body;
    if (!text) return res.status(400).json({ msg: 'Comment cannot be empty' });

    const comment = new Comment({
      video: req.params.videoId,
      user: req.user.id,
      username,
      text
    });

    await comment.save();
    res.json(comment);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
