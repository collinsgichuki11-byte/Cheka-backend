const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  youtubeUrl: { type: String, required: true },
  youtubeId: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  videoType: { type: String, enum: ['youtube','direct'], default: 'youtube' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName: { type: String, required: true },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }],
  category: { type: String, default: "General", enum: ["General","Comedy","Skits","Memes","Roasts","Standup"] },
  views: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', VideoSchema);
