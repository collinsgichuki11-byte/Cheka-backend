const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./User');
const Analytics = require('./Analytics');

const trackEvent = (type, data) => {
  Analytics.create({ type, ...data }).catch(() => {});
};

// Hardcoded primary admin + optional env-based extras (defense in depth).
// Removing the "first user becomes admin" / "next login becomes admin if no admin
// exists" backdoors which were granting admin access to test accounts.
const ADMIN_EMAILS = new Set(
  ['youanadanielle@gmail.com']
    .concat((process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()))
    .filter(Boolean)
);

const isAdminEmail = (email) => ADMIN_EMAILS.has((email || '').toLowerCase());

const userPayload = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  isAdmin: user.isAdmin,
  isVerified: user.isVerified,
  monetizationEnabled: user.monetizationEnabled,
  monetizationStatus: user.monetizationStatus,
  totalEarnings: user.totalEarnings,
  earningsBalance: user.earningsBalance
});

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    let { username, email, password } = req.body || {};
    username = (username || '').trim();
    email = (email || '').trim().toLowerCase();
    password = password || '';

    if (!username || username.length < 3 || username.length > 24) {
      return res.status(400).json({ msg: 'Username must be 3–24 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ msg: 'Username can only contain letters, numbers, _' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ msg: 'Invalid email' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ msg: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const isAdmin = isAdminEmail(email);
    const user = new User({ username, email, password: hashedPassword, isAdmin, isVerified: isAdmin });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    trackEvent('signup', { user: user._id });
    res.json({ token, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body || {};
    email = (email || '').trim().toLowerCase();
    password = password || '';
    if (!email || !password) return res.status(400).json({ msg: 'Missing credentials' });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    // Self-heal: only the designated admin email(s) may have admin rights.
    // Strip stale admin from any account that isn't on the allowlist.
    if (isAdminEmail(email)) {
      if (!user.isAdmin || !user.isVerified) {
        user.isAdmin = true;
        user.isVerified = true;
        await user.save();
      }
    } else if (user.isAdmin) {
      user.isAdmin = false;
      await user.save();
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    trackEvent('login', { user: user._id });
    res.json({ token, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
