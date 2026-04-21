const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'platform', unique: true },
  adsEnabled: { type: Boolean, default: false },
  monetizationEnabled: { type: Boolean, default: false },
  adTitle: { type: String, default: '' },
  adBody: { type: String, default: '' },
  adCta: { type: String, default: 'Learn more' },
  adUrl: { type: String, default: '' },
  platformCpm: { type: Number, default: 3 },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
