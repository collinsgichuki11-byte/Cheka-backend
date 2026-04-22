const express = require('express');
const router = express.Router();
const User = require('./User');
const Report = require('./Report');
const { auth, isValidId } = require('./lib/auth');

const ADMIN_EMAILS = new Set(
  ['youanadanielle@gmail.com']
    .concat((process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()))
    .filter(Boolean)
);
const isAdminEmail = (email) => ADMIN_EMAILS.has((email || '').toLowerCase());

// GET /api/users/me — own full profile (with admin self-heal).
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
  } catch (err) {
    console.error('GET /users/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH /api/users/me — update own profile (allowed fields only)
router.patch('/me', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const update = {};
    if (typeof b.displayName === 'string') update.displayName = b.displayName.trim().slice(0, 40);
    if (typeof b.bio === 'string') update.bio = b.bio.trim().slice(0, 160);
    if (typeof b.link === 'string') update.link = b.link.trim().slice(0, 200);
    if (typeof b.isPrivate === 'boolean') update.isPrivate = b.isPrivate;
    const enums = { whoCanComment: ['everyone','followers','noone'], whoCanDuet: ['everyone','followers','noone'], whoCanMessage: ['everyone','followers','noone'] };
    for (const k of Object.keys(enums)) {
      if (typeof b[k] === 'string' && enums[k].includes(b[k])) update[k] = b[k];
    }
    for (const k of ['notifyOnLike','notifyOnComment','notifyOnFollow','notifyOnRemix']) {
      if (typeof b[k] === 'boolean') update[k] = b[k];
    }
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('PATCH /users/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/users/block/:userId — block / unblock
router.post('/block/:userId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    if (req.params.userId === req.user.id) return res.status(400).json({ msg: 'Cannot block yourself' });
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ msg: 'User not found' });
    const target = await User.findById(req.params.userId).select('_id');
    if (!target) return res.status(404).json({ msg: 'Target not found' });
    const blockedSet = new Set((me.blocked || []).map(String));
    let blocked;
    if (blockedSet.has(req.params.userId)) {
      blockedSet.delete(req.params.userId);
      blocked = false;
    } else {
      blockedSet.add(req.params.userId);
      blocked = true;
    }
    me.blocked = [...blockedSet];
    await me.save();
    res.json({ blocked });
  } catch (err) {
    console.error('POST /users/block/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users/blocked/list — my blocked users (full objects)
router.get('/blocked/list', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select('blocked');
    if (!me?.blocked?.length) return res.json([]);
    const users = await User.find({ _id: { $in: me.blocked } }).select('_id username displayName isVerified');
    res.json(users);
  } catch (err) {
    console.error('GET /users/blocked/list failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/users/report — report a user, video, or comment
router.post('/report', auth, async (req, res) => {
  try {
    const { targetType, targetId, reason } = req.body || {};
    if (!['video','comment','user'].includes(targetType)) return res.status(400).json({ msg: 'Invalid target type' });
    if (!targetId || !isValidId(targetId)) return res.status(400).json({ msg: 'Invalid target id' });
    const cleanReason = String(reason || '').trim().slice(0, 200);
    if (!cleanReason) return res.status(400).json({ msg: 'Reason required' });
    await Report.create({ reporter: req.user.id, targetType, targetId, reason: cleanReason });
    if (targetType === 'video') {
      const Video = require('./Video');
      await Video.findByIdAndUpdate(targetId, { $inc: { reportCount: 1 } });
    }
    res.json({ msg: 'Report submitted' });
  } catch (err) {
    console.error('POST /users/report failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users?search=query — search users
router.get('/', auth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    if (!search) return res.json([]);
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40);
    const users = await User.find({ username: { $regex: safe, $options: 'i' } })
      .limit(20)
      .select('_id username displayName isVerified monetizationEnabled monetizationStatus isPrivate');
    res.json(users);
  } catch (err) {
    console.error('GET /users failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/users/:userId — public profile
router.get('/:userId', async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ msg: 'Invalid user id' });
    const user = await User.findById(req.params.userId).select('-password -email -blocked -notifyOnLike -notifyOnComment -notifyOnFollow -notifyOnRemix');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('GET /users/:userId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
