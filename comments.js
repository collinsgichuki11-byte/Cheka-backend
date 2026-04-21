const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Comment = require('./Comment');
const User = require('./User');

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
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(comments);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST add a comment — username pulled from server-side User record (no spoofing).
router.post('/:videoId', auth, async (req, res) => {
  try {
    const text = (req.body?.text || '').toString().trim();
    if (!text) return res.status(400).json({ msg: 'Comment cannot be empty' });
    if (text.length > 500) return res.status(400).json({ msg: 'Comment too long (500 max)' });

    const me = await User.findById(req.user.id).select('username');
    if (!me) return res.status(404).json({ msg: 'User not found' });

    const comment = new Comment({
      video: req.params.videoId,
      user: req.user.id,
      username: me.username,
      text
    });
    await comment.save();
    res.json(comment);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE a comment — author or admin
router.delete('/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ msg: 'Not found' });
    const me = await User.findById(req.user.id).select('isAdmin');
    if (comment.user.toString() !== req.user.id && !me?.isAdmin) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    await comment.deleteOne();
    res.json({ msg: 'Deleted' });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
