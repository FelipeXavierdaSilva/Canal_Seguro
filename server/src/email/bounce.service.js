'use strict';

const store = require('../store');
const config = require('../config');
const { hashIdentifier } = require('../utils/tokens');

function ensureStores(data) {
  data.emailSuppressions = data.emailSuppressions || [];
  return data;
}

function isSuppressed(email) {
  const data = ensureStores(store.load());
  const hash = hashIdentifier(String(email || '').toLowerCase());
  return (data.emailSuppressions || []).some((s) => s.emailHash === hash);
}

function suppress(email, reason = 'bounce') {
  const data = ensureStores(store.load());
  const emailHash = hashIdentifier(String(email || '').toLowerCase());
  if ((data.emailSuppressions || []).some((s) => s.emailHash === emailHash)) {
    return { ok: true, duplicate: true };
  }
  data.emailSuppressions.push({
    id: store.uid('esup'),
    emailHash,
    reason,
    at: new Date().toISOString()
  });
  store.save(data);
  return { ok: true };
}

function handleBounceWebhook(body) {
  const email = body?.email || body?.recipient;
  if (!email) return { ok: false, error: 'E-mail não informado.' };
  suppress(email, body?.reason || 'bounce');
  const data = store.load();
  data.emailQueue = data.emailQueue || [];
  data.emailQueue.forEach((job) => {
    if (job.toHash === hashIdentifier(String(email).toLowerCase()) && job.status === 'pending') {
      job.status = 'suppressed';
      job.lastError = 'suppressed_bounce';
    }
  });
  store.save(data);
  return { ok: true };
}

function clearForTests() {
  const data = store.load();
  data.emailSuppressions = [];
  store.save(data);
}

module.exports = { isSuppressed, suppress, handleBounceWebhook, clearForTests };
