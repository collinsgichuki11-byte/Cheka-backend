const mongoose = require('mongoose');
const NotificationSchema = new mongoose.Schema({
  recipient: { type: String, required: true },
  sender: { type: String, required: true },
  type: { type: String, enum: ['like','comment'], required: true },
  videoTitle: { type: String, required: true },
  videoId: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Notification', NotificationSchema);
