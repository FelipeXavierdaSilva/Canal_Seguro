'use strict';

const rateLimitStore = require('./rate-limit-store');

/** Incrementa contador e bloqueia se exceder max (cada tentativa conta). */
async function gateAttempt(key, max, windowMs) {
  const { count, retryAfterMs } = await rateLimitStore.incrementFailure(key, windowMs);
  if (count > max) {
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true, retryAfterMs };
}

/** Bloqueia se contador já atingiu max (sem incrementar). */
async function gateBlocked(key, max, windowMs) {
  const { count, retryAfterMs } = await rateLimitStore.getFailureCount(key, windowMs);
  if (count >= max) {
    return { blocked: true, retryAfterMs };
  }
  return { blocked: false, retryAfterMs };
}

async function recordFailure(key, windowMs) {
  return rateLimitStore.incrementFailure(key, windowMs);
}

async function clearGate(key) {
  await rateLimitStore.clearFailureKey(key);
}

async function resetAllForTests() {
  rateLimitStore.clearMemoryForTests();
  await rateLimitStore.disconnectRedisForTests();
}

module.exports = {
  gateAttempt,
  gateBlocked,
  recordFailure,
  clearGate,
  resetAllForTests
};
