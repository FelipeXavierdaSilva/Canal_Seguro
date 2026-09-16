/**
 * identifiers.js – Geração de identificadores de relatos (protótipo).
 *
 * Três conceitos separados:
 * - ID interno (rpt_...) – uso exclusivo do sistema
 * - Protocolo (CS-2026-XXXXXX) – identificador público legível
 * - trackingCode (XXXX-XXXX-XXXX) – credencial secreta de acompanhamento
 *
 * Futuro: substituir por UUID/códigos gerados no back-end.
 */

const CSIdentifiers = (() => {
  const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function secureRandomInt(max) {
    if (max <= 0) return 0;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function randomFrom(chars, length) {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[secureRandomInt(chars.length)];
    }
    return out;
  }

  /** ID interno – independente do protocolo; alta entropia no sufixo. */
  function generateReportId() {
    const ts = Date.now().toString(36);
    const rand = randomFrom(CHARSET, 12);
    return `rpt_${ts}_${rand}`;
  }

  function normalizeTrackingCode(code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '');
  }

  /**
   * Protocolo público legível. Não usa contador sequencial exposto.
   * @param {{ prefix?: string, year?: number, existingProtocols?: Set<string> }} options
   */
  function generateProtocol(options = {}) {
    const prefix = options.prefix || 'CS';
    const year = options.year || new Date().getFullYear();
    const existing = options.existingProtocols || new Set();
    let protocol;
    do {
      protocol = `${prefix}-${year}-${randomFrom(CHARSET, 6)}`;
    } while (existing.has(protocol.toUpperCase()));
    return protocol;
  }

  /**
   * Código secreto de acompanhamento – aleatório, sem dados pessoais ou sequencial.
   * @param {{ existingTrackingCodes?: Set<string> }} options
   */
  function generateTrackingCode(options = {}) {
    const existing = options.existingTrackingCodes || new Set();
    const block = () => randomFrom(CHARSET, 4);
    let code;
    do {
      code = `${block()}-${block()}-${block()}`;
    } while (existing.has(normalizeTrackingCode(code)));
    return code;
  }

  return {
    CHARSET,
    generateReportId,
    generateProtocol,
    generateTrackingCode,
    normalizeTrackingCode
  };
})();

window.CSIdentifiers = CSIdentifiers;
