const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: { type: String, required: true, index: true },
  sender: { type: String, required: true },
  type: { type: String, enum: ['like','comment','follow','remix','repost','save','mention','reply','live','tip','message'], required: true },
  videoTitle: { type: String, default: '' },
  videoId: { type: String, default: '' },
  // Optional snippet (e.g. comment text, reply text)
  snippet: { type: String, default: '' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const VERBS = {
  like: 'liked your video',
  comment: 'commented on your video',
  reply: 'replied to your comment',
  follow: 'started following you',
  remix: 'remixed your video',
  repost: 'reposted your video',
  save: 'saved your video',
  mention: 'mentioned you',
  live: 'is live now',
  tip: 'sent you a tip',
  message: 'sent you a message'
};

// Post-save hook: fire web push to the recipient on every new notification.
NotificationSchema.post('save', async function (doc) {
  try {
    const User = require('./User');
    const { sendPushTo } = require('./webpush');
    const sender = await User.findById(doc.sender).select('username displayName').lean().catch(() => null);
    const senderName = sender?.displayName || sender?.username || 'Someone';
    const verb = VERBS[doc.type] || 'sent you an update';
    const body = doc.snippet
      ? `${senderName} ${verb}: "${doc.snippet}"`
      : doc.videoTitle
        ? `${senderName} ${verb} "${doc.videoTitle}"`
        : `${senderName} ${verb}`;
    const url = doc.videoId
      ? `/watch.html?id=${doc.videoId}`
      : doc.type === 'follow'
        ? `/user-profile.html?id=${doc.sender}`
        : doc.type === 'message'
          ? `/chat.html?user=${doc.sender}&name=${encodeURIComponent(senderName.replace(/^@/, ''))}`
          : '/notifications.html';
    sendPushTo(doc.recipient, {
      type: doc.type,
      title: 'Cheka',
      body,
      url,
      tag: `cheka-${doc.type}-${doc._id}`
    }).catch(() => {});
  } catch (e) {
    // Never let push failure block notification creation
  }
});

module.exports = mongoose.model('Notification', NotificationSchema);
