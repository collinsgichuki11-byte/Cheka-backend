const express = require('express');
const router = express.Router();
const Prompt = require('./Prompt');
const User = require('./User');
const { auth } = require('./lib/auth');

const adminAuth = (req, res, next) => {
  auth(req, res, async () => {
    try {
      const user = await User.findById(req.user.id);
      if (!user?.isAdmin) return res.status(403).json({ msg: 'Not authorized' });
      next();
    } catch (err) {
      console.error('promptsAdminAuth failed:', err);
      res.status(500).json({ msg: 'Server error' });
    }
  });
};

// Today's date in UTC (YYYY-MM-DD).
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// GET today's prompt + countdown info
router.get('/today', async (req, res) => {
  try {
    const date = todayDate();
    const prompt = await Prompt.findOne({ date });
    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 0, 0, 0);
    res.json({ date, prompt, nextDropAt: nextMidnight.toISOString() });
  } catch (err) {
    console.error('GET /prompts/today failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET recent prompts — must come before /:date so 'recent' isn't treated as a date
router.get('/', async (req, res) => {
  try {
    const prompts = await Prompt.find().sort({ date: -1 }).limit(30);
    res.json(prompts);
  } catch (err) {
    console.error('GET /prompts failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET prompt by date
router.get('/:date', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    const prompt = await Prompt.findOne({ date: req.params.date });
    if (!prompt) return res.status(404).json({ msg: 'No prompt for that date' });
    res.json(prompt);
  } catch (err) {
    console.error('GET /prompts/:date failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST create/schedule a prompt (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { date, text, theme } = req.body || {};
    if (!date || !text) return res.status(400).json({ msg: 'Date and text required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    const prompt = await Prompt.findOneAndUpdate(
      { date },
      { $set: { text, theme: theme || '' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(prompt);
  } catch (err) {
    console.error('POST /prompts failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE a prompt (admin)
router.delete('/:date', adminAuth, async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    await Prompt.deleteOne({ date: req.params.date });
    res.json({ msg: 'Deleted' });
  } catch (err) {
    console.error('DELETE /prompts/:date failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
module.exports.todayDate = todayDate;
// Back-compat: older requires used `nairobiToday`. Keep alias.
module.exports.nairobiToday = todayDate;
