const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true, maxlength: 8 }
}, { _id: false });

const LinkPreviewSchema = new mongoose.Schema({
  videoId: { type: String, default: '' },
  title: { type: String, default: '' },
  creatorName: { type: String, default: '' },
  thumbUrl: { type: String, default: '' }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  to:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fromUsername: { type: String, required: true },
  toUsername:   { type: String, required: true },
  // Backward-compatible: existing messages were plain text.
  kind: { type: String, enum: ['text','image','video','voice','link'], default: 'text', index: true },
  text: { type: String, default: '', maxlength: 1000 },
  mediaUrl: { type: String, default: '' },
  mediaThumb: { type: String, default: '' },
  durationSec: { type: Number, default: 0 }, // for voice/video
  linkPreview: { type: LinkPreviewSchema, default: null },
  reactions: { type: [ReactionSchema], default: [] },
  read: { type: Boolean, default: false, index: true },
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Message', MessageSchema);
