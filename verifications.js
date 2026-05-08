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

// GET verification status for the current user
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('isVerified verificationStatus');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json({
      isVerified: user.isVerified || false,
      verificationStatus: user.verificationStatus || 'none'
    });
  } catch (err) {
    console.error('GET /verifications/status failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST request verification badge
router.post('/request', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('isVerified verificationStatus');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (user.isVerified) return res.status(400).json({ msg: 'Already verified' });
    if (user.verificationStatus === 'pending') return res.status(400).json({ msg: 'Request already pending' });
    user.verificationStatus = 'pending';
    await user.save();
    res.json({ msg: 'Verification request submitted', verificationStatus: 'pending' });
  } catch (err) {
    console.error('POST /verifications/request failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
