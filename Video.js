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
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', VideoSchema);
