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
  // Browser push services (FCM/APNs/Mozilla) reject payloads larger than
  // ~4KB. Truncate user-supplied strings before serialising so a long
  // comment, caption, or stream title can never knock out the whole push.
  const safe = { ...(payload || {}) };
  const cap = (s, n) => (typeof s === 'string' && s.length > n) ? s.slice(0, n - 1) + '…' : s;
  safe.title = cap(safe.title, 120);
  safe.body = cap(safe.body, 240);
  if (safe.url) safe.url = cap(safe.url, 400);
  let body = JSON.stringify(safe);
  if (body.length > 3500) {
    safe.body = cap(safe.body, 80);
    body = JSON.stringify(safe);
  }
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
