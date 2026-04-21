const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('./User');

const ADMIN_EMAILS = new Set(
  ['youanadanielle@gmail.com']
    .concat((process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()))
    .filter(Boolean)
);
const isAdminEmail = (email) => ADMIN_EMAILS.has((email || '').toLowerCase());

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

// GET /api/users/me — own full profile.
// Self-heal admin: only the allowlist may carry isAdmin. No backdoors.
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (isAdminEmail(user.email)) {
      if (!user.isAdmin || !user.isVerified) {
        user.isAdmin = true;
        user.isVerified = true;
        await user.save();
      }
    } else if (user.isAdmin) {
      user.isAdmin = false;
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
    const { displayName, bio } = req.body || {};
    const update = {};
    if (typeof displayName === 'string') update.displayName = displayName.trim().slice(0, 40);
    if (typeof bio === 'string') update.bio = bio.trim().slice(0, 160);

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
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
    // Escape regex meta to prevent ReDoS / accidental matches
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40);
    const users = await User.find({ username: { $regex: safe, $options: 'i' } })
      .limit(20)
      .select('_id username displayName isVerified monetizationEnabled monetizationStatus');
    res.json(users);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users/:userId — public profile of any user
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
