const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Report = require('./Report');
const User = require('./User');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminOnly = async (req, res, next) => {
  const me = await User.findById(req.user.id).select('isAdmin');
  if (!me?.isAdmin) return res.status(403).json({ msg: 'Admin only' });
  next();
};

// GET /api/reports — admin: list open reports (newest first)
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const reports = await Report.find({ status }).sort({ createdAt: -1 }).limit(200);
    res.json(reports);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH /api/reports/:id — admin: update status
router.patch('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['open','reviewed','dismissed','actioned'].includes(status)) return res.status(400).json({ msg: 'Bad status' });
    const r = await Report.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true });
    if (!r) return res.status(404).json({ msg: 'Not found' });
    res.json(r);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
