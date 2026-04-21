const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isCreator: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  // Self-service verification — request status (separate from admin grant)
  verificationStatus: { type: String, enum: ['none','pending','approved','rejected'], default: 'none' },
  displayName: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 160 },
  avatarUrl: { type: String, default: '' },
  // External link (TikTok-style "link in bio")
  link: { type: String, default: '', maxlength: 200 },
  // Privacy
  isPrivate: { type: Boolean, default: false },
  // Granular permission switches
  whoCanComment: { type: String, enum: ['everyone','followers','noone'], default: 'everyone' },
  whoCanDuet: { type: String, enum: ['everyone','followers','noone'], default: 'everyone' },
  whoCanMessage: { type: String, enum: ['everyone','followers','noone'], default: 'everyone' },
  // Block list (array of user IDs)
  blocked: [{ type: String, index: true }],
  // Notification preferences
  notifyOnLike: { type: Boolean, default: true },
  notifyOnComment: { type: Boolean, default: true },
  notifyOnFollow: { type: Boolean, default: true },
  notifyOnRemix: { type: Boolean, default: true },
  notifyOnMessage: { type: Boolean, default: true },
  notifyOnLive: { type: Boolean, default: true },
  // Locale / theme preferences
  locale: { type: String, enum: ['en','sw'], default: 'en' },
  theme: { type: String, enum: ['dark','light','system'], default: 'dark' },
  // Monetization
  monetizationEnabled: { type: Boolean, default: false },
  monetizationStatus: { type: String, enum: ['off', 'pending', 'active', 'paused'], default: 'off' },
  earningsBalance: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  // Coins (tipping / live gifts)
  coins: { type: Number, default: 0 },
  totalTipsReceived: { type: Number, default: 0 },
  // Referrals
  referralCode: { type: String, default: '', index: true },
  referredBy: { type: String, default: '' }, // userId of referrer
  referralBoostUntil: { type: Date, default: null }, // temporary verified-style boost
  referralCount: { type: Number, default: 0 },
  // Strikes (moderation)
  strikes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Auto-generate a referral code on first save if missing
UserSchema.pre('save', function (next) {
  if (!this.referralCode) {
    const base = (this.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const suffix = Math.random().toString(36).slice(2, 6);
    this.referralCode = `${base}${suffix}`;
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
