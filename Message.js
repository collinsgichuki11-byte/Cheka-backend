const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromUsername: { type: String, required: true },
  toUsername:   { type: String, required: true },
  text: { type: String, required: true, maxlength: 1000 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
