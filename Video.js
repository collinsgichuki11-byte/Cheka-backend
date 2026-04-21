const mongoose = require('mongoose');

const ChapterSchema = new mongoose.Schema({
  t: { type: Number, required: true }, // seconds offset
  label: { type: String, required: true, maxlength: 60 }
}, { _id: false });

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  caption: { type: String, default: '', maxlength: 300 },
  youtubeUrl: { type: String, default: '' },
  youtubeId: { type: String, default: '', required: false },
  videoUrl: { type: String, default: '' },
  videoType: { type: String, enum: ['youtube','direct'], default: 'youtube' },
  audioUrl: { type: String, default: '' }, // Cloudinary-extracted backing track
  audioOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null, index: true },
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
  // Tip totals (in coins)
  tipsReceived: { type: Number, default: 0 },
  // Subscriber-only paywall
  isPaid: { type: Boolean, default: false },
  // Remix / Stitch-style reaction
  remixOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null, index: true },
  remixCount: { type: Number, default: 0 },
  isDuet: { type: Boolean, default: false },
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
  // Drafts and scheduling
  isDraft: { type: Boolean, default: false, index: true },
  publishAt: { type: Date, default: null, index: true },
  // Comments lock
  commentsDisabled: { type: Boolean, default: false },
  // Chapters (YouTube-style)
  chapters: { type: [ChapterSchema], default: [] },
  // Daily prompt linkage
  promptDate: { type: String, default: '', index: true },
  // Moderation
  reportCount: { type: Number, default: 0 },
  moderationFlags: { type: [String], default: [] }, // e.g. ['nsfw','profanity']
  moderationStatus: { type: String, enum: ['ok','flagged','removed'], default: 'ok', index: true },
  createdAt: { type: Date, default: Date.now }
});

VideoSchema.index({ createdAt: -1 });
VideoSchema.index({ publishAt: 1, isDraft: 1 });

module.exports = mongoose.model('Video', VideoSchema);
