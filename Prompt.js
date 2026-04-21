const mongoose = require('mongoose');

const PromptSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD in Africa/Nairobi
  text: { type: String, required: true },
  theme: { type: String, default: '' },
  createdBy: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Prompt || mongoose.model('Prompt', PromptSchema);
