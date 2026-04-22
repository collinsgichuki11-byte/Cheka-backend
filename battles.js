const express = require('express');
const router = express.Router();
const Prompt = require('./Prompt');
const Video = require('./Video');

// Battles group videos by `promptDate` (YYYY-MM-DD), which is now a real
// field on the Video model. Videos.js POST `/` stamps this field with the
// current daily prompt's date when the upload happens during an active prompt.
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function scoreVideo(v) {
  return (v.likes || 0) * 3 + (v.views || 0);
}

const POPULATE_CREATOR = 'username displayName isVerified';

// GET today's battle: prompt + sorted entries
router.get('/today', async (req, res) => {
  try {
    const date = todayDate();
    const [prompt, videos] = await Promise.all([
      Prompt.findOne({ date }),
      Video.find({ promptDate: date, isPrivate: { $ne: true } })
        .sort({ createdAt: -1 })
        .populate('creator', POPULATE_CREATOR)
    ]);
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score);
    res.json({ date, prompt, entries, totalEntries: entries.length });
  } catch (err) {
    console.error('GET /battles/today failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET past battles (recent dates with entries) — must come before /:date
router.get('/', async (req, res) => {
  try {
    const prompts = await Prompt.find().sort({ date: -1 }).limit(14);
    const out = await Promise.all(prompts.map(async p => {
      const count = await Video.countDocuments({ promptDate: p.date, isPrivate: { $ne: true } });
      const top = await Video.findOne({ promptDate: p.date, isPrivate: { $ne: true } }).sort({ likes: -1 });
      return {
        date: p.date,
        prompt: p,
        entries: count,
        winner: top ? { creatorName: top.creatorName, title: top.title, likes: top.likes, _id: top._id } : null
      };
    }));
    res.json(out);
  } catch (err) {
    console.error('GET /battles failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET battle by date
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    const [prompt, videos] = await Promise.all([
      Prompt.findOne({ date }),
      Video.find({ promptDate: date, isPrivate: { $ne: true } })
        .sort({ createdAt: -1 })
        .populate('creator', POPULATE_CREATOR)
    ]);
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score);
    res.json({ date, prompt, entries, totalEntries: entries.length });
  } catch (err) {
    console.error('GET /battles/:date failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET leaderboard for a battle (top N)
router.get('/:date/leaderboard', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ msg: 'Date must be YYYY-MM-DD' });
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const videos = await Video.find({ promptDate: date, isPrivate: { $ne: true } })
      .populate('creator', POPULATE_CREATOR);
    const entries = videos
      .map(v => ({ ...v.toObject(), score: scoreVideo(v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    res.json(entries);
  } catch (err) {
    console.error('GET /battles/:date/leaderboard failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
