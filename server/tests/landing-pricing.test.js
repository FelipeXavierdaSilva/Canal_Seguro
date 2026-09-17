'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const storagePlans = require('../src/services/storage-plans.service');

describe('Preços — escopo Página inicial', () => {
  let user;
  let previousPlans;

  before(() => {
    const data = store.load();
    previousPlans = JSON.parse(JSON.stringify(data.platformSettings?.storagePlans || []));
    user = (data.users || []).find((u) => u.role === 'superadmin');
    assert.ok(user);
  });

  after(() => {
    const data = store.load();
    if (data.platformSettings) data.platformSettings.storagePlans = previousPlans;
    store.save(data);
  });

  it('lista Página inicial no dropdown de escopos', () => {
    const list = storagePlans.listPricingConfigs(user);
    assert.equal(list.ok, true);
    assert.ok(list.data.companies.some((c) => c.companyId === storagePlans.LANDING_SCOPE_ID));
  });

  it('carrega e salva textos/preços da landing', () => {
    const got = storagePlans.getPricingConfig(user, storagePlans.LANDING_SCOPE_ID);
    assert.equal(got.ok, true);
    assert.equal(got.data.scope, 'landing');
    assert.ok(got.data.plans.length >= 1);
    const first = got.data.plans[0];

    const details = {};
    for (const p of got.data.plans) {
      details[p.id] = {
        description: p.id === first.id ? 'Descrição landing teste' : p.description,
        usersLabel: p.usersLabel,
        retentionLabel: p.retentionLabel,
        advantages: p.advantages || [],
        billingNote: 'Contratação anual',
        consultPricing: false,
        hidePriceOnPublic: p.id === first.id,
        featured: p.id === first.id,
        priceAmount: p.id === first.id ? 199 : p.priceAmount
      };
    }
    const saved = storagePlans.updatePricingConfig(user, storagePlans.LANDING_SCOPE_ID, {
      planDetails: details
    });
    assert.equal(saved.ok, true);
    const updated = saved.data.plans.find((p) => p.id === first.id);
    assert.equal(updated.description, 'Descrição landing teste');
    assert.equal(updated.priceAmount, 199);
    assert.equal(updated.hidePriceOnPublic, true);
    assert.equal(updated.featured, true);

    const pub = storagePlans.listPublicPlans();
    const pubPlan = pub.data.plans.find((p) => p.id === first.id);
    assert.equal(pubPlan.priceLabel, 'Sob consulta');
  });

  it('permite ocultar a seção de planos na Página Inicial', () => {
    const data = store.load();
    const previous = Boolean(data.platformSettings?.hideLandingPlans);
    const saved = storagePlans.updatePricingConfig(user, storagePlans.LANDING_SCOPE_ID, {
      hideLandingPlans: true
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.data.hideLandingPlans, true);
    const pub = storagePlans.listPublicPlans();
    assert.equal(pub.data.hideLandingPlans, true);
    storagePlans.updatePricingConfig(user, storagePlans.LANDING_SCOPE_ID, {
      hideLandingPlans: previous
    });
  });
});
