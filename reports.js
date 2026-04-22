const express = require('express');
const router = express.Router();
const Report = require('./Report');
const User = require('./User');
const { auth, isValidId } = require('./lib/auth');

const adminOnly = async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id).select('isAdmin');
    if (!me?.isAdmin) return res.status(403).json({ msg: 'Admin only' });
    next();
  } catch (err) {
    console.error('reports adminOnly failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// GET /api/reports — admin: list open reports (newest first)
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const reports = await Report.find({ status }).sort({ createdAt: -1 }).limit(200);
    res.json(reports);
  } catch (err) {
    console.error('GET /reports failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH /api/reports/:id — admin: update status
router.patch('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid report id' });
    const { status } = req.body || {};
    if (!['open','reviewed','dismissed','actioned'].includes(status)) return res.status(400).json({ msg: 'Bad status' });
    const r = await Report.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true });
    if (!r) return res.status(404).json({ msg: 'Not found' });
    res.json(r);
  } catch (err) {
    console.error('PATCH /reports/:id failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
