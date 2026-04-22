// Web push wrapper. Loads VAPID keys from env and exposes sendToUser()
// which delivers a payload to every registered subscription for the user.
// Stale (404/410) subscriptions are pruned automatically.

let webpush = null;
let configured = false;

function init() {
  if (configured) return webpush;
  try {
    webpush = require('web-push');
  } catch (err) {
    console.error('web-push module not installed — push disabled');
    return null;
  }
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@cheka.app';
  if (!pub || !priv) {
    console.warn('VAPID keys missing — push notifications disabled');
    return null;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return webpush;
}

function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

async function sendToUser(userId, payload) {
  const wp = init();
  if (!wp || !userId) return { sent: 0, failed: 0 };
  const PushSubscription = require('../PushSubscription');
  let subs;
  try {
    subs = await PushSubscription.find({ user: String(userId) });
  } catch (err) {
    console.error('pushSender find subs failed:', err.message);
    return { sent: 0, failed: 0 };
  }
  if (!subs.length) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload || {});
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
      sent++;
    } catch (err) {
      failed++;
      const code = err.statusCode;
      if (code === 404 || code === 410) {
        await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
      } else {
        console.error('push send failed:', code || err.message);
      }
    }
  }));
  return { sent, failed };
}

module.exports = { sendToUser, publicKey, init };
