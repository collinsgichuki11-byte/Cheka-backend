const express = require('express');
const router = express.Router();
const Video = require('./Video');
const { isValidId, optionalAuth } = require('./lib/auth');

// GET /api/sounds/trending — most-used original sounds in the last 14 days.
router.get('/trending', async (req, res) => {
  try {
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    // We aggregate "uses" from videos that point at an original via
    // originalSoundOf, falling back to the originating video's metadata.
    const agg = await Video.aggregate([
      { $match: { originalSoundOf: { $ne: null }, createdAt: { $gte: since } } },
      { $group: { _id: '$originalSoundOf', uses: { $sum: 1 } } },
      { $sort: { uses: -1 } },
      { $limit: 30 },
      { $lookup: { from: 'videos', localField: '_id', foreignField: '_id', as: 'src' } },
      { $unwind: '$src' },
      { $match: { 'src.audioUrl': { $ne: '' } } },
      { $project: {
          _id: 0,
          videoId: '$_id',
          title: '$src.title',
          creatorName: '$src.creatorName',
          audioUrl: '$src.audioUrl',
          videoUrl: '$src.videoUrl',
          youtubeId: '$src.youtubeId',
          uses: 1
      } }
    ]);
    res.json(agg);
  } catch (err) {
    console.error('GET /sounds/trending failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/sounds/:videoId — the sound (audio) of a specific video plus a
// short feed of other videos that have used it. Used by sounds.html and
// the "Use this sound" button on the player.
router.get('/:videoId', optionalAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.videoId)) return res.status(400).json({ msg: 'Invalid video id' });
    const src = await Video.findById(req.params.videoId)
      .select('title creatorName creator audioUrl videoUrl videoType youtubeId soundUseCount durationSec');
    if (!src) return res.status(404).json({ msg: 'Sound not found' });
    if (!src.audioUrl) return res.status(404).json({ msg: 'No sound available for this video' });

    const uses = await Video.find({
      originalSoundOf: src._id,
      isPrivate: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate('creator', 'username displayName isVerified')
      .select('title creatorName creator videoUrl videoType youtubeId likes views createdAt');

    res.json({
      sound: {
        videoId: src._id,
        title: src.title,
        creatorName: src.creatorName,
        audioUrl: src.audioUrl,
        durationSec: src.durationSec,
        useCount: src.soundUseCount || 0
      },
      videos: uses
    });
  } catch (err) {
    console.error('GET /sounds/:videoId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
