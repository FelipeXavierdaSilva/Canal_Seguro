'use strict';

const store = require('../store');

function ensureDedupeStore(data) {
  data.emailDedupeKeys = data.emailDedupeKeys || [];
  return data;
}

function pruneOld(data, windowMs) {
  const cutoff = Date.now() - windowMs;
  data.emailDedupeKeys = (data.emailDedupeKeys || []).filter(
    (e) => new Date(e.at).getTime() > cutoff
  );
}

function isDuplicate(dedupeKey, windowMs = 15 * 60 * 1000) {
  if (!dedupeKey) return false;
  const data = ensureDedupeStore(store.load());
  pruneOld(data, windowMs * 2);
  const found = (data.emailDedupeKeys || []).some(
    (e) =>
      e.key === dedupeKey && Date.now() - new Date(e.at).getTime() < windowMs
  );
  store.save(data);
  return found;
}

function recordDedupe(dedupeKey) {
  if (!dedupeKey) return;
  const data = ensureDedupeStore(store.load());
  data.emailDedupeKeys.push({ key: dedupeKey, at: new Date().toISOString() });
  if (data.emailDedupeKeys.length > 5000) {
    data.emailDedupeKeys = data.emailDedupeKeys.slice(-3000);
  }
  store.save(data);
}

function clearForTests() {
  const data = store.load();
  data.emailDedupeKeys = [];
  store.save(data);
}

module.exports = { isDuplicate, recordDedupe, clearForTests };
