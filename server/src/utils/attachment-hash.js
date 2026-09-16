'use strict';

const crypto = require('crypto');

/**
 * SHA-256 hex do buffer — não altera os bytes do arquivo.
 */
function sha256Hex(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Buffer obrigatório para hash.');
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { sha256Hex };
