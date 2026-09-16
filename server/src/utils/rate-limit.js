'use strict';

const rateLimitStore = require('./rate-limit-store');

function createDistributedRateLimiter() {
  async function isBlocked(key, max, windowMs) {
    const { count, retryAfterMs } = await rateLimitStore.getFailureCount(key, windowMs);
    if (count >= max) {
      return { blocked: true, retryAfterMs };
    }
    return { blocked: false };
  }

  async function recordFailure(key, windowMs) {
    const { count } = await rateLimitStore.incrementFailure(key, windowMs);
    return count;
  }

  async function clear(key) {
    await rateLimitStore.clearFailureKey(key);
  }

  return { isBlocked, recordFailure, clear };
}

function clientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

module.exports = { createDistributedRateLimiter, clientIp };
