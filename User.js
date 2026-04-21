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
  monetizationEnabled: { type: Boolean, default: false },
  monetizationStatus: { type: String, enum: ['off', 'pending', 'active', 'paused'], default: 'off' },
  earningsBalance: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
