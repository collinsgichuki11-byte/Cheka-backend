const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('./User');
const Video = require('./Video');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminAuth = async (req, res, next) => {
  auth(req, res, async () => {
    const user = await User.findById(req.user.id);
    if (!user?.isAdmin) return res.status(403).json({ msg: 'Not authorized' });
    next();
  });
};

// GET all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PUT verify a user
router.put('/users/:id/verify', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isVerified: true }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PUT unverify a user
router.put('/users/:id/unverify', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isVerified: false }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PUT enable monetization
router.put('/users/:id/monetize', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { monetizationEnabled: true, monetizationStatus: 'active' },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// DELETE a video
router.delete('/videos/:id', adminAuth, async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Video deleted' });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET all videos
router.get('/videos', adminAuth, async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.json(videos);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET/PUT ads settings
let adSettings = { adsEnabled: false, adTitle: '', adBody: '', adUrl: '', adCta: 'Learn more' };

router.get('/ads', async (req, res) => {
  res.json(adSettings);
});

router.put('/ads', adminAuth, async (req, res) => {
  adSettings = { ...adSettings, ...req.body };
  res.json(adSettings);
});

// PUT make admin
router.put('/users/:id/makeadmin', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isAdmin: true }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

module.exports = router;
