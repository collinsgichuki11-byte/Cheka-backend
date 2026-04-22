const mongoose = require('mongoose');

// Direct message between two users.
// `text` is no longer strictly required — a message may carry only media,
// only a link preview, or both. We keep all original fields so old chat.html
// builds and the conversation list still work without any changes.
const ReactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emoji: { type: String, required: true, maxlength: 8 }
}, { _id: false });

const LinkedVideoSchema = new mongoose.Schema({
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
  title: String,
  creatorName: String,
  thumb: String
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  to:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fromUsername: { type: String, required: true },
  toUsername:   { type: String, required: true },
  // Plain text body. Defaults to '' when the message is a media-only payload
  // so old consumers that rely on `text` always get a string.
  text: { type: String, default: '', maxlength: 1000 },
  // Type of message: 'text', 'image', 'video', 'voice', 'link'
  kind: { type: String, default: 'text', enum: ['text', 'image', 'video', 'voice', 'link'] },
  mediaUrl: { type: String, default: '' },
  mediaThumb: { type: String, default: '' },
  // Voice notes are server-capped to 10 seconds.
  audioDur: { type: Number, default: 0 },
  linkedVideo: { type: LinkedVideoSchema, default: null },
  reactions: { type: [ReactionSchema], default: [] },
  read: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Compound index for fast thread fetches.
MessageSchema.index({ from: 1, to: 1, createdAt: 1 });

module.exports = mongoose.model('Message', MessageSchema);
