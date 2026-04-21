const mongoose = require('mongoose');
const NotificationSchema = new mongoose.Schema({
  recipient: { type: String, required: true, index: true },
  sender: { type: String, required: true },
  type: { type: String, enum: ['like','comment','follow','remix','repost','save','mention','reply'], required: true },
  videoTitle: { type: String, default: '' },
  videoId: { type: String, default: '' },
  // Optional snippet (e.g. comment text, reply text)
  snippet: { type: String, default: '' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Notification', NotificationSchema);
