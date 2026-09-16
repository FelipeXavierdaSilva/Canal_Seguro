'use strict';

const config = require('../config');

const memory = new Map();
let redisClient = null;
let redisConnectPromise = null;

function memoryGetEntry(key, windowMs) {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || now - entry.windowStartedAt > windowMs) {
    entry = { count: 0, windowStartedAt: now };
    memory.set(key, entry);
  }
  return entry;
}

async function getRedisClient() {
  if (!config.REDIS_URL) return null;
  if (redisClient?.isOpen) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  redisConnectPromise = (async () => {
    try {
      const { createClient } = require('redis');
      const client = createClient({ url: config.REDIS_URL });
      client.on('error', () => {});
      await client.connect();
      redisClient = client;
      return client;
    } catch {
      redisClient = null;
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();

  return redisConnectPromise;
}

async function getFailureCount(key, windowMs) {
  const client = await getRedisClient();
  if (client) {
    const raw = await client.get(`rl:${key}`);
    if (!raw) return { count: 0, retryAfterMs: 0 };
    const count = Number(raw) || 0;
    const ttlMs = Math.max(0, (await client.ttl(`rl:${key}`)) * 1000);
    return { count, retryAfterMs: ttlMs };
  }

  const entry = memoryGetEntry(key, windowMs);
  const now = Date.now();
  return {
    count: entry.count,
    retryAfterMs: Math.max(0, windowMs - (now - entry.windowStartedAt))
  };
}

async function incrementFailure(key, windowMs) {
  const client = await getRedisClient();
  if (client) {
    const redisKey = `rl:${key}`;
    const count = await client.incr(redisKey);
    if (count === 1) {
      await client.expire(redisKey, Math.ceil(windowMs / 1000));
    }
    const ttlMs = Math.max(0, (await client.ttl(redisKey)) * 1000);
    return { count, retryAfterMs: ttlMs };
  }

  const entry = memoryGetEntry(key, windowMs);
  entry.count += 1;
  memory.set(key, entry);
  const now = Date.now();
  return {
    count: entry.count,
    retryAfterMs: Math.max(0, windowMs - (now - entry.windowStartedAt))
  };
}

async function clearFailureKey(key) {
  const client = await getRedisClient();
  if (client) {
    await client.del(`rl:${key}`);
    return;
  }
  memory.delete(key);
}

function clearMemoryForTests() {
  memory.clear();
}

async function disconnectRedisForTests() {
  if (redisClient?.isOpen) {
    await redisClient.quit();
  }
  redisClient = null;
  redisConnectPromise = null;
}

module.exports = {
  getFailureCount,
  incrementFailure,
  clearFailureKey,
  clearMemoryForTests,
  disconnectRedisForTests,
  getRedisClient
};
