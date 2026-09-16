'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const commercial = require('../src/services/commercial-contact.service');

describe('Contato comercial', () => {
  it('normaliza WhatsApp BR com 0 no DDD', () => {
    assert.equal(commercial.normalizeWhatsAppE164('047984570646'), '5547984570646');
    assert.equal(commercial.normalizeWhatsAppE164('(47) 98457-0646'), '5547984570646');
  });

  it('monta mensagem com origem e plano', () => {
    const msg = commercial.buildCommercialInterestMessage({
      planId: 'essencial',
      planName: 'Essencial',
      originLabel: 'site Canal Seguro (seção Planos e preços)'
    });
    assert.match(msg, /Planos e preços/);
    assert.match(msg, /Essencial/);
    assert.match(msg, /painel de denúncias/);
  });
});
