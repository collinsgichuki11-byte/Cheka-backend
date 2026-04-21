const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  youtubeUrl: { type: String, default: '' },
  youtubeId: { type: String, default: '', required: false },
  videoUrl: { type: String, default: '' },
  videoType: { type: String, enum: ['youtube','direct'], default: 'youtube' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName: { type: String, required: true },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }],
  category: { type: String, default: "General", enum: ["General","Comedy","Skits","Memes","Roasts","Standup"] },
  views: { type: Number, default: 0 },
  promptDate: { type: String, default: '', index: true }, // YYYY-MM-DD if entered into a battle
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', VideoSchema);
