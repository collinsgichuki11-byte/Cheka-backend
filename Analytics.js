const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'page_view',
      'signup',
      'login',
      'video_view',
      'video_like',
      'video_unlike',
      'video_upload',
      'video_loop',
      'comment_post',
      'follow',
      'unfollow',
      'ad_impression',
      'ad_click',
      'share'
    ],
    index: true
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null, index: true },
  path: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ua: { type: String, default: '' },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

AnalyticsSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Analytics', AnalyticsSchema);
