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

// GET current user's referral code and stats
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('username referralCode referralCount');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (!user.referralCode) {
      user.referralCode = user.username + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      await user.save();
    }
    res.json({
      referralCode: user.referralCode,
      referralCount: user.referralCount || 0
    });
  } catch (err) {
    console.error('GET /referrals/me failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST apply a referral code during signup (called from auth route after account creation)
router.post('/apply', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ msg: 'Code required' });
    const referrer = await User.findOne({ referralCode: code });
    if (!referrer) return res.status(404).json({ msg: 'Invalid referral code' });
    if (String(referrer._id) === req.user.id) return res.status(400).json({ msg: 'Cannot use your own code' });
    referrer.referralCount = (referrer.referralCount || 0) + 1;
    await referrer.save();
    res.json({ msg: 'Referral applied', referrer: referrer.username });
  } catch (err) {
    console.error('POST /referrals/apply failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
