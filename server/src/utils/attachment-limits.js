'use strict';

/**
 * Limites de anexos por categoria (Fase A2).
 * Fonte da verdade: config.ATTACHMENTS — allowlist atual sem áudio/vídeo.
 */
const config = require('../config');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const DOCUMENT_EXT = new Set(['pdf', 'doc', 'docx', 'txt']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);

const IMAGE_MIME = /^image\//;
const AUDIO_MIME = /^audio\//;
const VIDEO_MIME = /^video\//;

function extensionFromName(name) {
  const match = String(name || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function resolveAttachmentCategory({ name, mimeType, ext } = {}) {
  const e = String(ext || extensionFromName(name) || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();

  if (IMAGE_EXT.has(e) || IMAGE_MIME.test(mime)) return 'image';
  if (AUDIO_EXT.has(e) || AUDIO_MIME.test(mime)) return 'audio';
  if (VIDEO_EXT.has(e) || VIDEO_MIME.test(mime)) return 'video';
  if (DOCUMENT_EXT.has(e) || mime.includes('pdf') || mime.includes('msword') || mime.includes('document') || mime === 'text/plain') {
    return 'document';
  }
  return 'other';
}

function maxBytesForCategory(category) {
  const att = config.ATTACHMENTS;
  switch (category) {
    case 'image':
      return att.MAX_FILE_SIZE_IMAGE;
    case 'audio':
      return att.MAX_FILE_SIZE_AUDIO;
    case 'video':
      return att.MAX_FILE_SIZE_VIDEO;
    case 'document':
      return att.MAX_FILE_SIZE_DOCUMENT;
    default:
      return att.MAX_FILE_SIZE_OTHER;
  }
}

function maxBytesForAttachment(meta = {}) {
  const category = resolveAttachmentCategory(meta);
  return { category, maxBytes: maxBytesForCategory(category) };
}

function absoluteMaxFileBytes() {
  const att = config.ATTACHMENTS;
  return Math.max(
    att.MAX_FILE_SIZE_IMAGE,
    att.MAX_FILE_SIZE_AUDIO,
    att.MAX_FILE_SIZE_VIDEO,
    att.MAX_FILE_SIZE_DOCUMENT,
    att.MAX_FILE_SIZE_OTHER,
    att.MAX_BYTES || 0
  );
}

function storageAlertLevel(percentUsed) {
  const thresholds = config.ATTACHMENTS.STORAGE_ALERT_THRESHOLDS || [70, 85, 95, 100];
  const p = Number(percentUsed) || 0;
  let level = null;
  for (const t of thresholds) {
    if (p >= t) level = t;
  }
  return level;
}

module.exports = {
  resolveAttachmentCategory,
  maxBytesForCategory,
  maxBytesForAttachment,
  absoluteMaxFileBytes,
  storageAlertLevel,
  extensionFromName
};
