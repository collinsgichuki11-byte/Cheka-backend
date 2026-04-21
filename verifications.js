const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const VerificationRequest = require('./VerificationRequest');
const User = require('./User');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminOnly = async (req, res, next) => {
  const u = await User.findById(req.user.id).select('isAdmin');
  if (!u?.isAdmin) return res.status(403).json({ msg: 'Admin only' });
  next();
};

// POST submit verification request (or refresh existing pending)
router.post('/', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ msg: 'User not found' });
    if (me.isVerified) return res.status(400).json({ msg: 'You are already verified' });

    const { realName, category, links, idDocUrl, notes } = req.body || {};
    if (!realName || realName.trim().length < 2) return res.status(400).json({ msg: 'Real name required' });

    const safeLinks = Array.isArray(links)
      ? links.filter(l => typeof l === 'string' && /^https?:\/\//i.test(l)).slice(0, 5).map(s => s.slice(0, 300))
      : [];

    // Upsert: keep one active request per user
    const existing = await VerificationRequest.findOne({ user: me._id, status: 'pending' });
    const doc = existing || new VerificationRequest({ user: me._id, username: me.username });
    doc.realName = String(realName).trim().slice(0, 100);
    doc.category = ['comedian','creator','public-figure','brand','press','other'].includes(category) ? category : 'creator';
    doc.links = safeLinks;
    doc.idDocUrl = (idDocUrl || '').slice(0, 500);
    doc.notes = (notes || '').toString().slice(0, 500);
    doc.status = 'pending';
    doc.reviewedAt = null;
    doc.reviewedBy = null;
    doc.reviewNote = '';
    await doc.save();

    me.verificationStatus = 'pending';
    await me.save();
    res.json(doc);
  } catch (err) {
    console.error('verification submit', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET my verification request
router.get('/me', auth, async (req, res) => {
  const doc = await VerificationRequest.findOne({ user: req.user.id }).sort({ createdAt: -1 });
  res.json(doc || null);
});

// ADMIN: list pending
router.get('/admin/list', auth, adminOnly, async (req, res) => {
  const status = req.query.status || 'pending';
  const list = await VerificationRequest.find({ status }).sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

// ADMIN: approve / reject
router.patch('/admin/:id', auth, adminOnly, async (req, res) => {
  const { action, note } = req.body || {};
  if (!['approve','reject'].includes(action)) return res.status(400).json({ msg: 'Invalid action' });
  const doc = await VerificationRequest.findById(req.params.id);
  if (!doc) return res.status(404).json({ msg: 'Not found' });
  doc.status = action === 'approve' ? 'approved' : 'rejected';
  doc.reviewedBy = req.user.id;
  doc.reviewNote = (note || '').toString().slice(0, 500);
  doc.reviewedAt = new Date();
  await doc.save();

  await User.findByIdAndUpdate(doc.user, {
    $set: {
      verificationStatus: doc.status,
      isVerified: doc.status === 'approved'
    }
  });
  res.json(doc);
});

module.exports = router;
