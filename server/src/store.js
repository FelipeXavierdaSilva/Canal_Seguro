'use strict';

const fs = require('fs');
const path = require('path');
const { assertAuditIntegrity } = require('./services/audit.service');
const config = require('./config');

const DATA_DIR = config.DATA_DIR
  ? path.resolve(config.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

let cache = null;

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    throw new Error(
      'Arquivo data/store.json não encontrado. Execute: cd server && npm install && npm run seed'
    );
  }
}

function load() {
  ensureStore();
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  }
  return cache;
}

function save(data) {
  ensureStore();
  if (fs.existsSync(STORE_PATH)) {
    const previous = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    assertAuditIntegrity(previous, data);
  }
  cache = data;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function reload() {
  cache = null;
  return load();
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

module.exports = { load, save, reload, uid, STORE_PATH, DATA_DIR };
