const crypto = require('node:crypto');
const AuthThrottle = require('../models/authThrottle.model');

const consume = async (scope, value, limit, windowMs) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const key = crypto.createHash('sha256').update(`${scope}:${value}`).digest('hex');
  const result = await AuthThrottle.findOneAndUpdate(
    { _id: key },
    [{ $set: {
      count: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
      expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', expiresAt] }
    } }],
    { upsert: true, new: true }
  ).lean();
  return { blocked: result.count > limit, retryAfter: Math.max(1, Math.ceil((result.expiresAt - now) / 1000)) };
};

const authRateLimit = ({ scope, ipLimit, emailLimit, windowMs, emailFromRequest }) => async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const email = emailFromRequest?.(req);
    const ipState = await consume(`${scope}:ip`, ip, ipLimit, windowMs);
    const emailState = email && emailLimit
      ? await consume(`${scope}:email`, email, emailLimit, windowMs)
      : null;
    if (ipState.blocked || emailState?.blocked) {
      res.set('Retry-After', String(Math.max(ipState.blocked ? ipState.retryAfter : 0, emailState?.blocked ? emailState.retryAfter : 0)));
      return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
    }
    return next();
  } catch (error) {
    return res.status(503).json({ error: 'No se pudo validar el acceso. Intenta más tarde.' });
  }
};

module.exports = { authRateLimit };
