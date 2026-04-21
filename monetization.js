const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('./User');
const Video = require('./Video');
const Follow = require('./Follow');
const PlatformSettings = require('./PlatformSettings');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

// Meta-inspired eligibility rules adapted for Cheka.
// Mirrors Facebook In-Stream Ads / Reels Play criteria.
const RULES = {
  minFollowers: 1000,           // Meta requires 5,000 page followers; we start at 1,000 to encourage early creators
  minPublishedVideos: 5,        // Meta requires 5 active videos
  minTotalViews: 10000,         // proxy for Meta's 60,000 watch-time minutes
  minAccountAgeDays: 30,        // Meta requires steady activity history
  maxStrikes: 0                 // Meta requires no Community Standards strikes
};

async function computeEligibility(userId) {
  const user = await User.findById(userId).select('-password');
  if (!user) throw new Error('User not found');

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);

  const [followerCount, videos, settings] = await Promise.all([
    Follow.countDocuments({ following: userId }),
    Video.find({ creator: userId }),
    PlatformSettings.findOne({ key: 'main' })
  ]);

  const recentVideos = videos.filter(v => new Date(v.createdAt) >= sixtyDaysAgo);
  const totalViews60d = recentVideos.reduce((s, v) => s + (v.views || 0), 0);
  const ageDays = Math.floor((Date.now() - new Date(user.createdAt)) / (24 * 3600 * 1000));

  const criteria = [
    { key: 'followers', label: `${RULES.minFollowers.toLocaleString()}+ followers`,
      current: followerCount, required: RULES.minFollowers,
      met: followerCount >= RULES.minFollowers },
    { key: 'videos', label: `${RULES.minPublishedVideos}+ published videos`,
      current: videos.length, required: RULES.minPublishedVideos,
      met: videos.length >= RULES.minPublishedVideos },
    { key: 'views', label: `${RULES.minTotalViews.toLocaleString()}+ views in last 60 days`,
      current: totalViews60d, required: RULES.minTotalViews,
      met: totalViews60d >= RULES.minTotalViews },
    { key: 'age', label: `Account ${RULES.minAccountAgeDays}+ days old`,
      current: ageDays, required: RULES.minAccountAgeDays,
      met: ageDays >= RULES.minAccountAgeDays },
    { key: 'strikes', label: 'No community guideline strikes',
      current: user.strikes || 0, required: 0,
      met: (user.strikes || 0) <= RULES.maxStrikes }
  ];

  const platformOn = settings ? !!settings.monetizationEnabled : false;
  const allMet = criteria.every(c => c.met);
  const eligible = allMet && platformOn;

  return {
    eligible,
    platformMonetizationEnabled: platformOn,
    status: user.monetizationStatus || 'inactive',
    enabled: !!user.monetizationEnabled,
    totalEarnings: user.totalEarnings || 0,
    criteria,
    rules: RULES
  };
}

// GET my monetization status
router.get('/me', auth, async (req, res) => {
  try {
    const result = await computeEligibility(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET any user's eligibility (admin only)
router.get('/check/:userId', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id);
    if (!me?.isAdmin && req.user.id !== req.params.userId) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    const result = await computeEligibility(req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST apply for monetization (sets status to pending if eligible)
router.post('/apply', auth, async (req, res) => {
  try {
    const result = await computeEligibility(req.user.id);
    if (!result.eligible) {
      return res.status(400).json({ msg: 'You do not yet meet the monetization requirements', criteria: result.criteria });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { monetizationStatus: 'pending' } },
      { new: true }
    ).select('-password');
    res.json({ msg: 'Application submitted for review', user });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
module.exports.RULES = RULES;
