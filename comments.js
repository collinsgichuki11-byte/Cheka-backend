const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
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

// Fire-and-forget notification. Wrapped in both sync try and async catch so a
// malformed payload or hook failure can never bubble back into the caller's
// response — comments must succeed even if push/notification logging breaks.
const notify = (data) => {
  try {
    Notification.create(data).catch(err => console.error('[notify] create failed:', err && err.message));
  } catch (err) {
    console.error('[notify] sync threw:', err && err.message);
  }
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET top-level comments for a video (with reply counts) — sorted: pinned first, then newest
router.get('/:videoId', async (req, res) => {
  try {
    if (!isValidId(req.params.videoId)) return res.status(400).json({ msg: 'Invalid video id' });
    const top = await Comment.find({ video: req.params.videoId, parentComment: null })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(200)
      .lean();
    const ids = top.map(c => c._id);
    const replyCounts = ids.length
      ? await Comment.aggregate([
          { $match: { parentComment: { $in: ids } } },
          { $group: { _id: '$parentComment', count: { $sum: 1 } } }
        ])
      : [];
    const countMap = new Map(replyCounts.map(r => [String(r._id), r.count]));
    res.json(top.map(c => ({ ...c, replyCount: countMap.get(String(c._id)) || 0 })));
  } catch (err) {
    console.error('GET /comments/:videoId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET replies for a comment thread
router.get('/replies/:commentId', async (req, res) => {
  try {
    if (!isValidId(req.params.commentId)) return res.status(400).json({ msg: 'Invalid comment id' });
    const replies = await Comment.find({ parentComment: req.params.commentId })
      .sort({ createdAt: 1 }).limit(200).lean();
    res.json(replies);
  } catch (err) {
    console.error('GET /comments/replies/:commentId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST a comment (top-level or reply via parentComment)
router.post('/:videoId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.videoId)) return res.status(400).json({ msg: 'Invalid video id' });

    const text = (req.body?.text || '').toString().trim();
    const rawParent = req.body?.parentComment;
    let parentComment = null;
    if (rawParent && rawParent !== 'null' && rawParent !== 'undefined') {
      if (!isValidId(rawParent)) return res.status(400).json({ msg: 'Invalid parent comment id' });
      parentComment = rawParent;
    }

    if (!text) return res.status(400).json({ msg: 'Comment cannot be empty' });
    if (text.length > 500) return res.status(400).json({ msg: 'Comment too long (500 max)' });

    const me = await User.findById(req.user.id).select('username');
    if (!me) return res.status(404).json({ msg: 'User not found' });

    const video = await Video.findById(req.params.videoId).select('creator title commentsDisabled');
    if (!video) return res.status(404).json({ msg: 'Video not found' });
    if (video.commentsDisabled) return res.status(403).json({ msg: 'Comments disabled' });

    // Honor the video creator's whoCanComment privacy setting.
    const creator = await User.findById(video.creator).select('whoCanComment notifyOnComment blocked');
    if (creator) {
      if ((creator.blocked || []).map(String).includes(String(req.user.id))) {
        return res.status(403).json({ msg: 'You cannot comment on this video' });
      }
      if (creator.whoCanComment === 'noone' && String(video.creator) !== req.user.id) {
        return res.status(403).json({ msg: 'Comments are restricted' });
      }
      // 'followers' enforcement is intentionally not blocking here yet — needs a Follow lookup.
    }

    const comment = new Comment({
      video: req.params.videoId,
      user: req.user.id,
      username: me.username,
      text,
      parentComment
    });
    await comment.save();

    if (parentComment) {
      const parent = await Comment.findById(parentComment).select('user video');
      if (parent && String(parent.user) !== req.user.id) {
        notify({
          recipient: String(parent.user),
          sender: req.user.id,
          type: 'reply',
          videoTitle: video.title,
          videoId: String(video._id),
          snippet: text.slice(0, 140)
        });
      }
    } else if (String(video.creator) !== req.user.id) {
      if (creator?.notifyOnComment !== false) {
        notify({
          recipient: String(video.creator),
          sender: req.user.id,
          type: 'comment',
          videoTitle: video.title,
          videoId: String(video._id),
          snippet: text.slice(0, 140)
        });
      }
    }

    res.json(comment);
  } catch (err) {
    console.error('POST /comments/:videoId failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST like / unlike a comment
router.post('/:id/like', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid comment id' });
    const c = await Comment.findById(req.params.id);
    if (!c) return res.status(404).json({ msg: 'Not found' });
    const uid = String(req.user.id);
    const likedByStrings = (c.likedBy || []).map(String);
    const liked = likedByStrings.includes(uid);
    if (liked) {
      c.likedBy = likedByStrings.filter(id => id !== uid);
      c.likes = Math.max(0, (c.likes || 0) - 1);
    } else {
      c.likedBy = [...likedByStrings, uid];
      c.likes = (c.likes || 0) + 1;
    }
    await c.save();
    res.json({ liked: !liked, likes: c.likes });
  } catch (err) {
    console.error('POST /comments/:id/like failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST pin / unpin comment — only by the video's creator
router.post('/:id/pin', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid comment id' });
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
  } catch (err) {
    console.error('POST /comments/:id/pin failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE — author, video creator, or admin
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ msg: 'Invalid comment id' });
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
  } catch (err) {
    console.error('DELETE /comments/:id failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
