const mongoose = require('mongoose');
const FollowSchema = new mongoose.Schema({
  follower: { type: String, required: true },
  following: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Follow', FollowSchema);
