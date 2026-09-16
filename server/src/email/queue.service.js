'use strict';

const store = require('../store');
const config = require('../config');
const { validatePayload } = require('./privacy');
const { render } = require('./render');
const { getProvider } = require('./providers');
const dedupe = require('./dedupe.service');
const bounce = require('./bounce.service');
const policy = require('./policy.service');
const { EVENT_LABELS } = require('./events');

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

function ensureQueue(data) {
  data.emailQueue = data.emailQueue || [];
  data.emailDeliveryLogs = data.emailDeliveryLogs || [];
  return data;
}

function appendLog(data, entry) {
  data.emailDeliveryLogs.unshift({
    id: store.uid('eml'),
    at: new Date().toISOString(),
    ...entry
  });
  if (data.emailDeliveryLogs.length > 2000) {
    data.emailDeliveryLogs = data.emailDeliveryLogs.slice(0, 1500);
  }
}

async function enqueue({
  eventType,
  to,
  companyId,
  payload,
  dedupeKey = null,
  dedupeWindowMs = config.EMAIL.DEDUPE_WINDOW_MS
}) {
  const validation = validatePayload(eventType, payload);
  if (!validation.ok) {
    const data = ensureQueue(store.load());
    appendLog(data, {
      eventType,
      companyId,
      toHash: policy.emailHash(to),
      status: 'blocked',
      error: validation.error
    });
    store.save(data);
    return { ok: false, error: validation.error };
  }

  if (bounce.isSuppressed(to)) {
    return { ok: false, suppressed: true };
  }

  if (dedupeKey && dedupe.isDuplicate(dedupeKey, dedupeWindowMs)) {
    return { ok: false, duplicate: true };
  }

  const data = ensureQueue(store.load());
  const job = {
    id: store.uid('emq'),
    eventType,
    companyId: companyId || null,
    to,
    toHash: policy.emailHash(to),
    payload,
    dedupeKey,
    status: 'pending',
    attempts: 0,
    maxAttempts: config.EMAIL.MAX_ATTEMPTS,
    nextAttemptAt: new Date().toISOString(),
    providerMessageId: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    sentAt: null
  };
  data.emailQueue.push(job);
  appendLog(data, {
    jobId: job.id,
    eventType,
    companyId,
    toHash: job.toHash,
    status: 'queued'
  });
  if (dedupeKey) dedupe.recordDedupe(dedupeKey);
  store.save(data);
  if (process.env.CS_EMAIL_SYNC === '1') {
    await processBatch(config.EMAIL.BATCH_SIZE);
  }
  return { ok: true, jobId: job.id };
}

async function processJob(job, data) {
  const validation = validatePayload(job.eventType, job.payload);
  if (!validation.ok) {
    job.status = 'failed';
    job.lastError = validation.error;
    appendLog(data, {
      jobId: job.id,
      eventType: job.eventType,
      companyId: job.companyId,
      toHash: job.toHash,
      status: 'blocked',
      error: validation.error
    });
    return;
  }

  if (bounce.isSuppressed(job.to)) {
    job.status = 'suppressed';
    job.lastError = 'suppressed';
    appendLog(data, {
      jobId: job.id,
      eventType: job.eventType,
      companyId: job.companyId,
      toHash: job.toHash,
      status: 'suppressed'
    });
    return;
  }

  const rendered = render(job.eventType, job.payload);
  const provider = getProvider();

  try {
    const result = await provider.send({
      to: job.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      eventType: job.eventType,
      actionUrl: job.payload?.actionUrl
    });
    if (!result.ok) throw new Error(result.error || 'Falha no provider');
    job.status = 'sent';
    job.sentAt = new Date().toISOString();
    job.providerMessageId = result.messageId || null;
    appendLog(data, {
      jobId: job.id,
      eventType: job.eventType,
      companyId: job.companyId,
      toHash: job.toHash,
      status: 'sent',
      provider: result.mode
    });
  } catch (err) {
    job.attempts += 1;
    job.lastError = err.message || 'Erro desconhecido';
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      appendLog(data, {
        jobId: job.id,
        eventType: job.eventType,
        companyId: job.companyId,
        toHash: job.toHash,
        status: 'failed',
        error: job.lastError
      });
    } else {
      job.status = 'pending';
      const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      job.nextAttemptAt = new Date(Date.now() + delay).toISOString();
      appendLog(data, {
        jobId: job.id,
        eventType: job.eventType,
        companyId: job.companyId,
        toHash: job.toHash,
        status: 'retry_scheduled',
        attempt: job.attempts,
        error: job.lastError
      });
    }
  }
}

async function processBatch(limit = config.EMAIL.BATCH_SIZE) {
  const data = ensureQueue(store.load());
  const now = Date.now();
  const pending = (data.emailQueue || [])
    .filter(
      (j) =>
        j.status === 'pending' && new Date(j.nextAttemptAt || j.createdAt).getTime() <= now
    )
    .slice(0, limit);

  for (const job of pending) {
    await processJob(job, data);
  }
  store.save(data);
  return { processed: pending.length };
}

function getQueueStats() {
  const data = store.load();
  const q = data.emailQueue || [];
  return {
    pending: q.filter((j) => j.status === 'pending').length,
    sent: q.filter((j) => j.status === 'sent').length,
    failed: q.filter((j) => j.status === 'failed').length,
    suppressed: q.filter((j) => j.status === 'suppressed').length
  };
}

function getDeliveryLogs({ limit = 50, companyId = null } = {}) {
  const data = store.load();
  let logs = [...(data.emailDeliveryLogs || [])];
  if (companyId) logs = logs.filter((l) => l.companyId === companyId);
  return logs.slice(0, limit).map((l) => ({
    ...l,
    eventLabel: EVENT_LABELS[l.eventType] || l.eventType
  }));
}

function clearForTests() {
  const data = store.load();
  data.emailQueue = [];
  data.emailDeliveryLogs = [];
  data.emailDedupeKeys = [];
  store.save(data);
  dedupe.clearForTests();
  bounce.clearForTests();
  require('./providers/console.provider').resetForTests();
}

module.exports = {
  enqueue,
  processBatch,
  getQueueStats,
  getDeliveryLogs,
  clearForTests
};
