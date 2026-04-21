const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  caption: { type: String, default: '', maxlength: 300 },
  youtubeUrl: { type: String, default: '' },
  youtubeId: { type: String, default: '', required: false },
  videoUrl: { type: String, default: '' },
  videoType: { type: String, enum: ['youtube','direct'], default: 'youtube' },
  durationSec: { type: Number, default: 0 },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName: { type: String, required: true },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }],
  category: { type: String, default: "General", enum: ["General","Comedy","Skits","Memes","Roasts","Standup"] },
  views: { type: Number, default: 0 },
  loops: { type: Number, default: 0 },
  monetized: { type: Boolean, default: true },
  estimatedEarnings: { type: Number, default: 0 },
  // Remix / Stitch-style reaction
  remixOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null, index: true },
  remixCount: { type: Number, default: 0 },
  // Hashtags parsed from caption (lowercased, no #). Indexed for hashtag pages.
  hashtags: { type: [String], default: [], index: true },
  // Saves / bookmarks
  savedBy: [{ type: String, index: true }],
  saves: { type: Number, default: 0 },
  // Shares (counter only — actual share happens client-side)
  shares: { type: Number, default: 0 },
  // Reposts (re-share to your own followers' feeds)
  repostedBy: [{ type: String, index: true }],
  reposts: { type: Number, default: 0 },
  // Pinned to creator's profile (max 3 enforced in route)
  isPinned: { type: Boolean, default: false, index: true },
  // Privacy: hidden from public feed; only the creator (and followers if you extend) can view
  isPrivate: { type: Boolean, default: false, index: true },
  // Comments lock
  commentsDisabled: { type: Boolean, default: false },
  // Report flag — increments when users report; admin reviews via /reports
  reportCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', VideoSchema);
