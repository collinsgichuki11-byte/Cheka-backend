const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('./User');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// GET my referral info
router.get('/me', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select('referralCode referralCount referralBoostUntil coins');
    if (!me) return res.status(404).json({ msg: 'User not found' });
    res.json({
      code: me.referralCode,
      count: me.referralCount || 0,
      coins: me.coins || 0,
      boostActive: me.referralBoostUntil && me.referralBoostUntil > new Date(),
      boostUntil: me.referralBoostUntil || null
    });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET lookup referrer info by code (used on signup page to confirm valid invite)
router.get('/lookup/:code', async (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  if (!code) return res.json({ valid: false });
  const u = await User.findOne({ referralCode: code }).select('username displayName avatarUrl');
  if (!u) return res.json({ valid: false });
  res.json({ valid: true, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
});

module.exports = router;
