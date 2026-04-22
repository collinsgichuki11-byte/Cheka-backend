const mongoose = require('mongoose');

const LiveStreamSchema = new mongoose.Schema({
  broadcaster: { type: String, required: true, index: true },
  broadcasterName: { type: String, default: '' },
  title: { type: String, default: '', maxlength: 120 },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true, index: true },
  viewerCount: { type: Number, default: 0 },
  peakViewers: { type: Number, default: 0 },
  chatCount: { type: Number, default: 0 },
  heartCount: { type: Number, default: 0 },
  recordingUrl: { type: String, default: '' }
});

module.exports = mongoose.model('LiveStream', LiveStreamSchema);
