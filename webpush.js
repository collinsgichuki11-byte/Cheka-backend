const webpush = require('web-push');
const PushSubscription = require('./PushSubscription');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cheka.app';

let configured = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
  } catch (e) {
    console.error('webpush VAPID setup failed:', e.message);
  }
} else {
  console.warn('Push disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars to enable');
}

async function sendPushTo(userId, payload) {
  if (!configured || !userId) return { sent: 0 };
  const subs = await PushSubscription.find({ user: String(userId) }).lean();
  if (!subs.length) return { sent: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
      sent++;
    } catch (err) {
      // 404/410 means the subscription is dead — clean it up
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        try { await PushSubscription.deleteOne({ endpoint: s.endpoint }); } catch (_) {}
      }
    }
  }));
  return { sent };
}

module.exports = { sendPushTo, isConfigured: () => configured, publicKey: () => VAPID_PUBLIC };
