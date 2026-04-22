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
// After a notification is created, fan it out as a web push to the recipient.
// Failures are swallowed — the in-app notification is the source of truth.
NotificationSchema.post('save', function (doc) {
  try {
    const { sendToUser } = require('./lib/pushSender');
    const titleMap = {
      like: 'Someone liked your video',
      comment: 'New comment on your video',
      reply: 'Someone replied to your comment',
      follow: 'You have a new follower',
      remix: 'Someone remixed your video',
      repost: 'Your video was reposted',
      save: 'Someone saved your video',
      mention: 'You were mentioned'
    };
    const title = titleMap[doc.type] || 'Cheka';
    const body = doc.snippet
      ? doc.snippet.slice(0, 100)
      : (doc.videoTitle ? doc.videoTitle.slice(0, 100) : 'Open Cheka to see more');
    // Route to the most relevant screen for each notification type:
    //   - follow → the new follower's profile
    //   - everything else with a videoId → the specific video in the feed
    //   - fallback → the notifications screen
    let url;
    if (doc.type === 'follow' && doc.sender) {
      url = `/profile.html?u=${encodeURIComponent(doc.sender)}`;
    } else if (doc.videoId) {
      url = `/feed.html?v=${doc.videoId}`;
    } else {
      url = '/notifications.html';
    }
    sendToUser(doc.recipient, { title, body, url, type: doc.type, tag: 'cheka-' + doc.type })
      .catch(err => console.error('push fanout failed:', err.message));
  } catch (err) {
    console.error('Notification post-save push hook failed:', err.message);
  }
});

module.exports = mongoose.model('Notification', NotificationSchema);
