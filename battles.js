const express = require('express');
const router = express.Router();
const Prompt = require('./Prompt');
const Video = require('./Video');
const promptsModule = require('./prompts');

function nairobiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

function scoreVideo(v) {
  return (v.likes || 0) * 3 + (v.views || 0);
}

// GET today's battle: prompt + sorted entries
router.get('/today', async (req, res) => {
  try {
    const date = nairobiToday();
    const [prompt, videos] = await Promise.all([
      Prompt.findOne({ date }),
      Video.find({ promptDate: date }).sort({ createdAt: -1 })
    ]);
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score);
    res.json({ date, prompt, entries, totalEntries: entries.length });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET battle by date
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const [prompt, videos] = await Promise.all([
      Prompt.findOne({ date }),
      Video.find({ promptDate: date }).sort({ createdAt: -1 })
    ]);
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score);
    res.json({ date, prompt, entries, totalEntries: entries.length });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET leaderboard for a battle (top N)
router.get('/:date/leaderboard', async (req, res) => {
  try {
    const { date } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const videos = await Video.find({ promptDate: date });
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET past battles (recent dates with entries)
router.get('/', async (req, res) => {
  try {
    const prompts = await Prompt.find().sort({ date: -1 }).limit(14);
    const out = await Promise.all(prompts.map(async p => {
      const count = await Video.countDocuments({ promptDate: p.date });
      const top = await Video.findOne({ promptDate: p.date }).sort({ likes: -1 });
      return {
        date: p.date,
        prompt: p,
        entries: count,
        winner: top ? { creatorName: top.creatorName, title: top.title, likes: top.likes, _id: top._id } : null
      };
    }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
