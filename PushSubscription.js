const mongoose = require('mongoose');

// One push endpoint per browser. We dedupe on `endpoint` so a re-subscribe
// from the same browser updates instead of stacking duplicates.
const PushSubscriptionSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  ua: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
