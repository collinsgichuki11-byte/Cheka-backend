const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Follow = require('./Follow');
const User = require('./User');
const Notification = require('./Notification');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// POST follow/unfollow a creator
router.post('/:creatorId', auth, async (req, res) => {
  try {
    if (req.params.creatorId === req.user.id) {
      return res.status(400).json({ msg: 'Cannot follow yourself' });
    }
    const existing = await Follow.findOne({
      follower: req.user.id,
      following: req.params.creatorId
    });
    if (existing) {
      await existing.deleteOne();
      res.json({ following: false });
    } else {
      await Follow.create({ follower: req.user.id, following: req.params.creatorId });
      const target = await User.findById(req.params.creatorId).select('notifyOnFollow');
      if (target?.notifyOnFollow !== false) {
        Notification.create({
          recipient: req.params.creatorId,
          sender: req.user.id,
          type: 'follow',
          videoTitle: '',
          videoId: ''
        }).catch(() => {});
      }
      res.json({ following: true });
    }
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET followers count for a user
router.get('/:userId/count', async (req, res) => {
  try {
    const count = await Follow.countDocuments({ following: req.params.userId });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET following count for a user
router.get('/:userId/following-count', async (req, res) => {
  try {
    const count = await Follow.countDocuments({ follower: req.params.userId });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET check if current user is following someone
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

// GET list of user objects who follow a user
router.get('/:userId/followers-list', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ following: req.params.userId });
    const followerIds = follows.map(f => f.follower);
    const users = await User.find({ _id: { $in: followerIds } }).select('_id username displayName isVerified');
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET list of user objects a user is following
router.get('/:userId/following-list', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ follower: req.params.userId });
    const followingIds = follows.map(f => f.following);
    const users = await User.find({ _id: { $in: followingIds } }).select('_id username displayName isVerified');
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET my following list (IDs only — kept for compatibility)
router.get('/my/following', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ follower: req.user.id });
    res.json(follows.map(f => f.following));
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
