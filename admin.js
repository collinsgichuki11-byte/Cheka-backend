const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('./User');
const Video = require('./Video');
const PlatformSettings = require('./PlatformSettings');

const router = express.Router();

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

const getSettings = async () => {
  let settings = await PlatformSettings.findOne({ key: 'main' });
  if (!settings) settings = await PlatformSettings.create({ key: 'main' });
  return settings;
};

const adminOnly = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.isAdmin) return res.status(403).json({ msg: 'Admin only' });
  req.admin = user;
  next();
};

router.get('/ads', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      adsEnabled: settings.adsEnabled,
      adTitle: settings.adTitle,
      adBody: settings.adBody,
      adCta: settings.adCta,
      adUrl: settings.adUrl
    });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/dashboard', auth, adminOnly, async (req, res) => {
  try {
    const [settings, users, videoCount] = await Promise.all([
      getSettings(),
      User.find().sort({ createdAt: -1 }).select('-password').limit(100),
      Video.countDocuments()
    ]);
    res.json({
      settings,
      users,
      stats: {
        users: users.length,
        videos: videoCount,
        verified: users.filter(u => u.isVerified).length,
        monetizedCreators: users.filter(u => u.monetizationEnabled).length
      }
    });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.patch('/ads', auth, adminOnly, async (req, res) => {
  try {
    const { adsEnabled, monetizationEnabled, platformCpm, adTitle, adBody, adCta, adUrl } = req.body;
    const update = { updatedAt: new Date() };
    if (adsEnabled !== undefined) update.adsEnabled = !!adsEnabled;
    if (monetizationEnabled !== undefined) update.monetizationEnabled = !!monetizationEnabled;
    if (platformCpm !== undefined) update.platformCpm = Math.max(0, Number(platformCpm) || 0);
    if (adTitle !== undefined) update.adTitle = String(adTitle).trim().slice(0, 80);
    if (adBody !== undefined) update.adBody = String(adBody).trim().slice(0, 180);
    if (adCta !== undefined) update.adCta = String(adCta).trim().slice(0, 40);
    if (adUrl !== undefined) update.adUrl = String(adUrl).trim().slice(0, 300);

    const settings = await PlatformSettings.findOneAndUpdate(
      { key: 'main' },
      { $set: update },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.patch('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const { isVerified, monetizationEnabled, monetizationStatus, isAdmin } = req.body;
    const update = {};
    if (isVerified !== undefined) update.isVerified = !!isVerified;
    if (monetizationEnabled !== undefined) update.monetizationEnabled = !!monetizationEnabled;
    if (monetizationStatus !== undefined) update.monetizationStatus = monetizationStatus;
    if (isAdmin !== undefined && req.params.id !== req.user.id) update.isAdmin = !!isAdmin;

    if (update.monetizationEnabled === true && !update.monetizationStatus) update.monetizationStatus = 'active';
    if (update.monetizationEnabled === false && !update.monetizationStatus) update.monetizationStatus = 'off';

    const user = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;