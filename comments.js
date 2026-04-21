const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Comment = require('./Comment');
const User = require('./User');
const Video = require('./Video');
const Notification = require('./Notification');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ msg: 'Invalid token' }); }
};

const notify = (data) => { Notification.create(data).catch(() => {}); };

// GET top-level comments for a video (with reply counts) — sorted: pinned first, then newest
router.get('/:videoId', async (req, res) => {
  try {
    const top = await Comment.find({ video: req.params.videoId, parentComment: null })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(200)
      .lean();
    const ids = top.map(c => c._id);
    const replyCounts = await Comment.aggregate([
      { $match: { parentComment: { $in: ids } } },
      { $group: { _id: '$parentComment', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(replyCounts.map(r => [String(r._id), r.count]));
    res.json(top.map(c => ({ ...c, replyCount: countMap.get(String(c._id)) || 0 })));
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET replies for a comment thread
router.get('/replies/:commentId', async (req, res) => {
  try {
    const replies = await Comment.find({ parentComment: req.params.commentId })
      .sort({ createdAt: 1 }).limit(200).lean();
    res.json(replies);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST a comment (top-level or reply via parentComment)
router.post('/:videoId', auth, async (req, res) => {
  try {
    const text = (req.body?.text || '').toString().trim();
    const parentComment = req.body?.parentComment || null;
    if (!text) return res.status(400).json({ msg: 'Comment cannot be empty' });
    if (text.length > 500) return res.status(400).json({ msg: 'Comment too long (500 max)' });

    const me = await User.findById(req.user.id).select('username');
    if (!me) return res.status(404).json({ msg: 'User not found' });

    const video = await Video.findById(req.params.videoId).select('creator title commentsDisabled');
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (video.commentsDisabled) return res.status(403).json({ msg: 'Comments disabled' });

    const comment = new Comment({
      video: req.params.videoId,
      user: req.user.id,
      username: me.username,
      text,
      parentComment: parentComment || null
    });
    await comment.save();

    if (parentComment) {
      const parent = await Comment.findById(parentComment).select('user video');
      if (parent && String(parent.user) !== req.user.id) {
        notify({ recipient: String(parent.user), sender: req.user.id, type: 'reply', videoTitle: video.title, videoId: String(video._id), snippet: text.slice(0, 140) });
      }
    } else if (String(video.creator) !== req.user.id) {
      const owner = await User.findById(video.creator).select('notifyOnComment');
      if (owner?.notifyOnComment !== false) {
        notify({ recipient: String(video.creator), sender: req.user.id, type: 'comment', videoTitle: video.title, videoId: String(video._id), snippet: text.slice(0, 140) });
      }
    }

    res.json(comment);
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like / unlike a comment
router.post('/:id/like', auth, async (req, res) => {
  try {
    const c = await Comment.findById(req.params.id);
    if (!c) return res.status(404).json({ msg: 'Not found' });
    const uid = req.user.id;
    const liked = c.likedBy.includes(uid);
    if (liked) {
      c.likedBy = c.likedBy.filter(id => id !== uid);
      c.likes = Math.max(0, c.likes - 1);
    } else {
      c.likedBy.push(uid);
      c.likes += 1;
    }
    await c.save();
    res.json({ liked: !liked, likes: c.likes });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST pin / unpin comment — only by the video's creator
router.post('/:id/pin', auth, async (req, res) => {
  try {
    const c = await Comment.findById(req.params.id);
    if (!c) return res.status(404).json({ msg: 'Not found' });
    const v = await Video.findById(c.video).select('creator');
    if (!v) return res.status(404).json({ msg: 'Video not found' });
    if (String(v.creator) !== req.user.id) return res.status(403).json({ msg: 'Not your video' });
    if (!c.isPinned) {
      // Unpin any other pinned comment on this video first
      await Comment.updateMany({ video: c.video, isPinned: true }, { $set: { isPinned: false } });
    }
    c.isPinned = !c.isPinned;
    await c.save();
    res.json({ isPinned: c.isPinned });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE — author, video creator, or admin
router.delete('/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ msg: 'Not found' });
    const me = await User.findById(req.user.id).select('isAdmin');
    const v = await Video.findById(comment.video).select('creator');
    const isOwner = comment.user.toString() === req.user.id;
    const isVideoCreator = v && String(v.creator) === req.user.id;
    if (!isOwner && !isVideoCreator && !me?.isAdmin) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    await comment.deleteOne();
    // Also delete replies
    await Comment.deleteMany({ parentComment: req.params.id });
    res.json({ msg: 'Deleted' });
  } catch {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
