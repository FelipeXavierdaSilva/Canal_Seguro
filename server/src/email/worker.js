'use strict';

const config = require('../config');
const queue = require('./queue.service');

let timer = null;
let slaLastRun = 0;

function startEmailWorker() {
  if (timer) return;
  const interval = config.EMAIL.WORKER_INTERVAL_MS;
  timer = setInterval(async () => {
    try {
      await queue.processBatch();
      if (Date.now() - slaLastRun > config.EMAIL.SLA_CHECK_INTERVAL_MS) {
        slaLastRun = Date.now();
        const notification = require('../services/notification.service');
        notification.runScheduledAlerts();
      }
    } catch (err) {
      console.error('[email-worker]', err.message);
    }
  }, interval);
  if (timer.unref) timer.unref();
  queue.processBatch().catch(() => {});
}

function stopEmailWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startEmailWorker, stopEmailWorker };
