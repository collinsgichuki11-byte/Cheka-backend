const mongoose = require('mongoose');

const VerificationRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  username: { type: String, required: true },
  realName: { type: String, required: true, maxlength: 100 },
  category: { type: String, enum: ['comedian','creator','public-figure','brand','press','other'], default: 'creator' },
  links: { type: [String], default: [] },          // social/press links
  idDocUrl: { type: String, default: '' },         // optional ID upload (Cloudinary)
  notes: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewNote: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null }
});

module.exports = mongoose.model('VerificationRequest', VerificationRequestSchema);
