const mongoose = require('mongoose');

const PlatformSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  adsEnabled: { type: Boolean, default: true },
  monetizationEnabled: { type: Boolean, default: true },
  platformCpm: { type: Number, default: 3 },
  adTitle: { type: String, default: 'Advertise on Cheka' },
  adBody: { type: String, default: 'Reach a high-energy comedy audience with short, scroll-stopping placements.' },
  adCta: { type: String, default: 'Learn more' },
  adUrl: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PlatformSettings', PlatformSettingsSchema);