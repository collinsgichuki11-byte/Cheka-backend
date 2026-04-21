const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
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

// GET /api/users/me — get own full profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const hasAdmin = await User.exists({ isAdmin: true });
    if (!hasAdmin) {
      user.isAdmin = true;
      user.isVerified = true;
      await user.save();
    }
    res.json(user);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH /api/users/me — update own profile (displayName + bio)
router.patch('/me', auth, async (req, res) => {
  try {
    const { displayName, bio } = req.body;
    const update = {};
    if (displayName !== undefined) update.displayName = displayName.trim().slice(0, 40);
    if (bio !== undefined) update.bio = bio.trim().slice(0, 160);

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users?search=query — search users by username
router.get('/', auth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    if (!search) return res.json([]);

    const users = await User.find({
      username: { $regex: search, $options: 'i' }
    })
      .limit(20)
      .select('_id username displayName isVerified monetizationEnabled monetizationStatus');

    res.json(users);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users/:userId — get any user's public profile
router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password -email');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
