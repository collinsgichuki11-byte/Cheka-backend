const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isCreator: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  displayName: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 160 },
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
  // Monetization
  monetizationEnabled: { type: Boolean, default: false },
  monetizationStatus: { type: String, enum: ['off', 'pending', 'active', 'paused'], default: 'off' },
  earningsBalance: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  // Community guideline strikes — used by monetization eligibility
  strikes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
