const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Follow = require('./Follow');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// POST follow/unfollow a creator
router.post('/:creatorId', auth, async (req, res) => {
  try {
    const existing = await Follow.findOne({
      follower: req.user.id,
      following: req.params.creatorId
    });
    if (existing) {
      await existing.deleteOne();
      res.json({ following: false });
    } else {
      await Follow.create({ follower: req.user.id, following: req.params.creatorId });
      res.json({ following: true });
    }
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET followers count for a creator
router.get('/:creatorId/count', async (req, res) => {
  try {
    const count = await Follow.countDocuments({ following: req.params.creatorId });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET check if following
router.get('/:creatorId/check', auth, async (req, res) => {
  try {
    const existing = await Follow.findOne({
      follower: req.user.id,
      following: req.params.creatorId
    });
    res.json({ following: !!existing });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET my following list
router.get('/my/following', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ follower: req.user.id });
    res.json(follows.map(f => f.following));
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
