const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const LiveStream = require('./LiveStream');
const User = require('./User');
const Follow = require('./Follow');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) { req.user = null; return next(); }
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); }
  catch { req.user = null; }
  next();
};

// POST /api/live  — start a stream
router.post('/', auth, async (req, res) => {
  try {
    // End any prior active stream by this broadcaster.
    await LiveStream.updateMany(
      { broadcaster: req.user.id, isActive: true },
      { $set: { isActive: false, endedAt: new Date() } }
    );
    const u = await User.findById(req.user.id).select('username displayName');
    const stream = await LiveStream.create({
      broadcaster: req.user.id,
      broadcasterName: u?.username || '',
      title: String(req.body?.title || '').slice(0, 120)
    });
    // Push "X is live now" to every follower (in-app push only — no DB
    // notification spam since live events are ephemeral).
    (async () => {
      try {
        const { sendToUser } = require('./lib/pushSender');
        const followers = await Follow.find({ following: req.user.id }).select('follower').lean();
        const name = u?.displayName || u?.username || 'Someone';
        const title = `${name} is live now`;
        const body = stream.title ? stream.title.slice(0, 120) : 'Tap to watch the live stream';
        const url = `/live-view.html?id=${stream._id}`;
        await Promise.all(followers.map(f =>
          sendToUser(f.follower, { title, body, url, tag: 'cheka-live-' + stream._id, type: 'live' })
            .catch(() => {})
        ));
      } catch (err) {
        console.error('live push fanout failed:', err.message);
      }
    })();
    res.json(stream);
  } catch (err) {
    console.error('live create:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/live/:id/end  — end a stream
router.post('/:id/end', auth, async (req, res) => {
  try {
    const stream = await LiveStream.findById(req.params.id);
    if (!stream) return res.status(404).json({ msg: 'Not found' });
    if (stream.broadcaster !== req.user.id) return res.status(403).json({ msg: 'Forbidden' });
    if (stream.isActive) {
      stream.isActive = false;
      stream.endedAt = new Date();
    }
    if (typeof req.body?.recordingUrl === 'string' && req.body.recordingUrl) {
      stream.recordingUrl = req.body.recordingUrl;
    }
    await stream.save();
    // Notify signalling layer to close the room.
    if (typeof global.__chekaCloseLiveRoom === 'function') {
      try { global.__chekaCloseLiveRoom(String(stream._id)); } catch {}
    }
    res.json(stream);
  } catch (err) {
    console.error('live end:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/live/active — list active streams (followed first, then trending)
router.get('/active', optionalAuth, async (req, res) => {
  try {
    let followedIds = [];
    if (req.user?.id) {
      const f = await Follow.find({ follower: req.user.id }).select('following');
      followedIds = f.map(x => x.following);
    }
    const all = await LiveStream.find({ isActive: true })
      .sort({ viewerCount: -1, startedAt: -1 })
      .limit(50)
      .lean();
    const followed = all.filter(s => followedIds.includes(s.broadcaster));
    const others = all.filter(s => !followedIds.includes(s.broadcaster));
    res.json({ followed, trending: others });
  } catch (err) {
    console.error('live active:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/live/:id  — stream + broadcaster info
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const stream = await LiveStream.findById(req.params.id).lean();
    if (!stream) return res.status(404).json({ msg: 'Not found' });
    const broadcaster = await User.findById(stream.broadcaster)
      .select('_id username displayName isVerified').lean();
    res.json({ ...stream, broadcasterUser: broadcaster });
  } catch (err) {
    console.error('live get:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/live/:id/heart — count a heart (also broadcast over WS by client)
router.post('/:id/heart', optionalAuth, async (req, res) => {
  try {
    const s = await LiveStream.findByIdAndUpdate(
      req.params.id,
      { $inc: { heartCount: 1 } },
      { new: true }
    ).select('heartCount');
    if (!s) return res.status(404).json({ msg: 'Not found' });
    res.json({ heartCount: s.heartCount });
  } catch (err) {
    console.error('live heart:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
