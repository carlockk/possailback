const mongoose = require('mongoose');

const authThrottleSchema = new mongoose.Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false });

authThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthThrottle', authThrottleSchema);
