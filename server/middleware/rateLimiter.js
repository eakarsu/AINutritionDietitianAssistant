const rateLimit = require('express-rate-limit');

const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => {
    if (req.userId) {
      return `user_${req.userId}`;
    }
    return req.ip || '0.0.0.0';
  },
  validate: false, // disable all validations to suppress IPv6 warning
  message: {
    error: 'Too many AI requests. Limit is 20 per hour per user. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { aiRateLimiter };
