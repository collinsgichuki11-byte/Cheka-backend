const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('./User');
const Video = require('./Video');
const Settings = require('./Settings');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminAuth = (req, res, next) => {
  auth(req, res, async () => {
    try {
      const user = await User.findById(req.user.id);
      if (!user?.isAdmin) return res.status(403).json({ msg: 'Not authorized' });
      next();
    } catch { res.status(500).json({ msg: 'Server error' }); }
  });
};

async function getSettings() {
  let s = await Settings.findOne({ key: 'platform' });
  if (!s) s = await Settings.create({ key: 'platform' });
  return s;
}

// GET combined dashboard: stats + settings + users
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const [users, videos, settings] = await Promise.all([
      User.find().select('-password').sort({ createdAt: -1 }),
      Video.countDocuments(),
      getSettings()
    ]);
    const verified = users.filter(u => u.isVerified).length;
    const monetizedCreators = users.filter(u => u.monetizationEnabled).length;
    res.json({
      stats: { users: users.length, videos, verified, monetizedCreators },
      settings,
      users
    });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET public ad settings (used by feed)
router.get('/ads', async (req, res) => {
  try {
    const s = await getSettings();
    res.json(s);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PATCH ad/monetization settings
router.patch('/ads', adminAuth, async (req, res) => {
  try {
    const allowed = ['adsEnabled', 'monetizationEnabled', 'adTitle', 'adBody', 'adCta', 'adUrl', 'platformCpm'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    update.updatedAt = new Date();
    const s = await Settings.findOneAndUpdate(
      { key: 'platform' },
      { $set: update },
      { new: true, upsert: true }
    );
    res.json(s);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// PATCH update any user fields (admin)
router.patch('/users/:id', adminAuth, async (req, res) => {
  try {
    const allowed = ['isVerified', 'isAdmin', 'monetizationEnabled', 'monetizationStatus', 'totalEarnings'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const user = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET all videos
router.get('/videos', adminAuth, async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.json(videos);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// DELETE a video
router.delete('/videos/:id', adminAuth, async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Video deleted' });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// Legacy routes (kept for backward compatibility)
router.put('/users/:id/verify', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isVerified: true }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

router.put('/users/:id/unverify', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isVerified: false }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

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

router.put('/users/:id/makeadmin', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isAdmin: true }, { new: true }).select('-password');
    res.json(user);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

module.exports = router;
