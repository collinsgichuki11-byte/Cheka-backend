const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Prompt = require('./Prompt');
const User = require('./User');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const adminAuth = (req, res, next) => {
  auth(req, res, async () => {
    try {
      const user = await User.findById(req.user.id);
      if (!user?.isAdmin) return res.status(403).json({ msg: 'Not authorized' });
      next();
    } catch { res.status(500).json({ msg: 'Server error' }); }
  });
};

// Helper: today's date in UTC (YYYY-MM-DD). Uniform globally so the daily prompt
// resets at the same moment for every user.
function nairobiToday() {
  return new Date().toISOString().slice(0, 10);
}

// GET today's prompt + countdown info
router.get('/today', async (req, res) => {
  try {
    const date = nairobiToday();
    const prompt = await Prompt.findOne({ date });
    // Next drop at the next 00:00 UTC.
    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 0, 0, 0);
    res.json({ date, prompt, nextDropAt: nextMidnight.toISOString() });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET prompt by date
router.get('/:date', async (req, res) => {
  try {
    const prompt = await Prompt.findOne({ date: req.params.date });
    if (!prompt) return res.status(404).json({ msg: 'No prompt for that date' });
    res.json(prompt);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// GET recent prompts
router.get('/', async (req, res) => {
  try {
    const prompts = await Prompt.find().sort({ date: -1 }).limit(30);
    res.json(prompts);
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

// POST create/schedule a prompt (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { date, text, theme } = req.body;
    if (!date || !text) return res.status(400).json({ msg: 'Date and text required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    const prompt = await Prompt.findOneAndUpdate(
      { date },
      { $set: { text, theme: theme || '' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(prompt);
  } catch (err) { res.status(500).json({ msg: 'Server error' }); }
});

// DELETE a prompt (admin)
router.delete('/:date', adminAuth, async (req, res) => {
  try {
    await Prompt.deleteOne({ date: req.params.date });
    res.json({ msg: 'Deleted' });
  } catch { res.status(500).json({ msg: 'Server error' }); }
});

module.exports = router;
module.exports.nairobiToday = nairobiToday;
