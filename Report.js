const mongoose = require('mongoose');
const ReportSchema = new mongoose.Schema({
  reporter: { type: String, required: true, index: true },
  targetType: { type: String, enum: ['video','comment','user'], required: true },
  targetId: { type: String, required: true, index: true },
  reason: { type: String, required: true, maxlength: 200 },
  status: { type: String, enum: ['open','reviewed','dismissed','actioned'], default: 'open', index: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Report', ReportSchema);
