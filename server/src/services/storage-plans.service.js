'use strict';

const companyStorage = require('./company-storage.service');

const GiB = 1024 * 1024 * 1024;

/** Catálogo padrão (seed). Adm_Plataforma edita platformSettings.storagePlans. */
const DEFAULT_STORAGE_PLANS = [
  {
    id: 'essencial',
    name: 'Essencial',
    storageLimitBytes: 5 * GiB,
    storageLabel: '5 GB',
    barPercent: 17,
    priceLabel: 'R$ 149',
    priceSuffix: '/mês',
    priceAmount: 149,
    billingNote: 'Contratação anual',
    usersLabel: '2 usuários',
    retentionLabel: 'Retenção de evidências por 1 ano',
    description: 'Indicado para empresas pequenas.',
    featured: false,
    ctaLabel: 'Contratar',
    tierIndex: 0
  },
  {
    id: 'plus',
    name: 'Plus',
    storageLimitBytes: 10 * GiB,
    storageLabel: '10 GB',
    barPercent: 33,
    priceLabel: 'R$ 299',
    priceSuffix: '/mês',
    priceAmount: 299,
    billingNote: 'Contratação anual',
    usersLabel: '3 usuários',
    retentionLabel: 'Retenção de evidências por 1 ano',
    description: 'Indicado para pequenas empresas.',
    featured: true,
    ctaLabel: 'Contratar',
    tierIndex: 1
  },
  {
    id: 'pro',
    name: 'Pro',
    storageLimitBytes: 20 * GiB,
    storageLabel: '20 GB',
    barPercent: 67,
    priceLabel: 'R$ 599',
    priceSuffix: '/mês',
    priceAmount: 599,
    billingNote: 'Contratação anual',
    usersLabel: '5 usuários',
    retentionLabel: 'Retenção de evidências por 1 ano',
    description: 'Indicado para empresas médias.',
    featured: false,
    ctaLabel: 'Contratar',
    tierIndex: 2
  },
  {
    id: 'corporativo',
    name: 'Corporativo',
    storageLimitBytes: 30 * GiB,
    storageLabel: '30 GB',
    barPercent: 100,
    priceLabel: 'Sob consulta',
    priceSuffix: '',
    priceAmount: null,
    billingNote: 'Contratação anual',
    usersLabel: 'Usuários ilimitados',
    retentionLabel: 'Retenção de evidências por 1 ano',
    description: 'Indicado para empresas maiores.',
    featured: false,
    ctaLabel: 'Falar com especialista',
    tierIndex: 3
  }
];

const MAX_PLAN_BYTES = 2 * 1024 * 1024 * 1024 * 1024; // 2 TiB
const MIN_PLAN_BYTES = 10 * 1024 * 1024; // 10 MiB

const DEFAULT_PRICING = {
  baseAmount: 149,
  upgradePercent: 20,
  corporativoConsult: true,
  planAmounts: {},
  planDetails: {}
};

function cloneDefaults() {
  return DEFAULT_STORAGE_PLANS.map((p) => ({ ...p, advantages: defaultAdvantages(p) }));
}

function formatStorageLabel(bytes) {
  const n = Number(bytes) || 0;
  const gib = n / GiB;
  if (gib >= 1) {
    const rounded = Math.round(gib * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded} GB`;
  }
  const mib = Math.round(n / (1024 * 1024));
  return `${mib} MB`;
}

function recomputeBarPercents(plans) {
  const max = Math.max(...plans.map((p) => Number(p.storageLimitBytes) || 0), 1);
  return plans.map((p, idx) => ({
    ...p,
    tierIndex: typeof p.tierIndex === 'number' ? p.tierIndex : idx,
    barPercent: Math.min(100, Math.max(1, Math.round(((Number(p.storageLimitBytes) || 0) / max) * 100)))
  }));
}

function slugifyPlanId(name) {
  const base = String(name || 'plano')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'plano';
}

function sanitizePlanDefinition(raw, { existingId = null } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const name = String(src.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Nome do plano é obrigatório.' };

  let storageLimitBytes = Number(src.storageLimitBytes);
  if (src.storageGiB != null && src.storageGiB !== '') {
    const fromGib = Number(src.storageGiB) * GiB;
    if (Number.isFinite(fromGib) && fromGib > 0) storageLimitBytes = fromGib;
  }
  if (!Number.isFinite(storageLimitBytes) || storageLimitBytes <= 0) {
    return { ok: false, error: 'Informe o limite de armazenamento do plano.' };
  }
  storageLimitBytes = Math.floor(storageLimitBytes);
  if (storageLimitBytes < MIN_PLAN_BYTES || storageLimitBytes > MAX_PLAN_BYTES) {
    return {
      ok: false,
      error: `Limite do plano deve estar entre ${formatStorageLabel(MIN_PLAN_BYTES)} e ${formatStorageLabel(MAX_PLAN_BYTES)}.`
    };
  }

  let id = existingId || String(src.id || '').trim();
  if (!id) id = slugifyPlanId(name);
  id = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  if (!id) return { ok: false, error: 'ID do plano inválido.' };

  const usersLabel = String(src.usersLabel || 'Usuários conforme contrato').trim().slice(0, 80);
  const retentionLabel = String(
    src.retentionLabel || 'Retenção de evidências por 1 ano'
  )
    .trim()
    .slice(0, 120);
  const description = String(src.description || '').trim().slice(0, 280);
  const billingNote = String(src.billingNote || 'Contratação anual').trim().slice(0, 120);
  const ctaLabel = String(src.ctaLabel || 'Contratar').trim().slice(0, 60);
  const featured = Boolean(src.featured);
  const hidePriceOnPublic = Boolean(src.hidePriceOnPublic);
  const consultPricing = Boolean(src.consultPricing) || src.priceAmount === null || src.priceAmount === '';
  let priceAmount = null;
  if (!consultPricing && src.priceAmount != null && src.priceAmount !== '') {
    const n = Number(src.priceAmount);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Preço de referência inválido.' };
    priceAmount = Math.round(n * 100) / 100;
  }
  const advantages = sanitizeAdvantages(src.advantages) || [
    `${formatStorageLabel(storageLimitBytes)} de armazenamento`,
    usersLabel,
    retentionLabel
  ];
  const tierIndex =
    Number.isFinite(Number(src.tierIndex)) && Number(src.tierIndex) >= 0
      ? Math.floor(Number(src.tierIndex))
      : null;

  return {
    ok: true,
    plan: {
      id,
      name,
      storageLimitBytes,
      storageLabel: formatStorageLabel(storageLimitBytes),
      barPercent: 0,
      priceLabel: consultPricing ? 'Sob consulta' : formatPriceLabel(priceAmount),
      priceSuffix: consultPricing ? '' : '/mês',
      priceAmount: consultPricing ? null : priceAmount,
      billingNote,
      usersLabel,
      retentionLabel,
      description: description || `Plano ${name}.`,
      featured,
      ctaLabel: consultPricing ? ctaLabel || 'Falar com especialista' : ctaLabel,
      consultPricing,
      hidePriceOnPublic,
      advantages,
      tierIndex,
      active: src.active === false ? false : true
    }
  };
}

function ensureStoragePlansCatalog(data) {
  if (!data.platformSettings || typeof data.platformSettings !== 'object') {
    data.platformSettings = {};
  }
  const ps = data.platformSettings;
  if (!Array.isArray(ps.storagePlans) || !ps.storagePlans.length) {
    ps.storagePlans = cloneDefaults();
  }
  ps.storagePlans = recomputeBarPercents(
    ps.storagePlans
      .filter((p) => p && p.id && p.active !== false)
      .map((p, idx) => ({
        ...p,
        storageLabel: p.storageLabel || formatStorageLabel(p.storageLimitBytes),
        tierIndex: typeof p.tierIndex === 'number' ? p.tierIndex : idx,
        advantages: Array.isArray(p.advantages) && p.advantages.length ? p.advantages : defaultAdvantages(p)
      }))
      .sort((a, b) => (Number(a.storageLimitBytes) || 0) - (Number(b.storageLimitBytes) || 0))
  );
  return ps.storagePlans;
}

function getStoragePlansCatalog(data) {
  return ensureStoragePlansCatalog(data).map((p) => ({ ...p }));
}

function toPublicPlanView(plan) {
  const consult = Boolean(plan.consultPricing) || plan.priceAmount == null;
  const hidePrice = Boolean(plan.hidePriceOnPublic) || consult;
  const advantages =
    Array.isArray(plan.advantages) && plan.advantages.length
      ? plan.advantages
      : defaultAdvantages(plan);
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    storageLabel: plan.storageLabel || formatStorageLabel(plan.storageLimitBytes),
    storageLimitBytes: plan.storageLimitBytes,
    barPercent: Number(plan.barPercent) || 0,
    billingNote: plan.billingNote || 'Contratação anual',
    usersLabel: plan.usersLabel || '',
    retentionLabel: plan.retentionLabel || '',
    advantages: [...advantages],
    featured: Boolean(plan.featured),
    hidePriceOnPublic: Boolean(plan.hidePriceOnPublic),
    consultPricing: consult,
    priceLabel: hidePrice ? 'Sob consulta' : plan.priceLabel || formatPriceLabel(plan.priceAmount),
    priceSuffix: hidePrice ? '' : plan.priceSuffix || '/mês',
    ctaLabel: hidePrice
      ? plan.ctaLabel || 'Falar com especialista'
      : plan.ctaLabel || 'Contratar'
  };
}

/** Lista planos ativos para a landing pública (sem preço bruto nem campos internos). */
function listPublicPlans() {
  const store = require('../store');
  const data = store.load();
  const plans = getStoragePlansCatalog(data).map(toPublicPlanView);
  return { ok: true, data: { plans } };
}

/** @deprecated use getStoragePlansCatalog — mantido para exports/testes */
const STORAGE_PLANS = DEFAULT_STORAGE_PLANS;

function defaultAdvantages(plan) {
  return [
    `${plan.storageLabel} de armazenamento`,
    plan.usersLabel,
    plan.retentionLabel
  ].filter(Boolean);
}

function sanitizeAdvantages(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .map((item) => String(item == null ? '' : item).trim())
    .filter(Boolean)
    .slice(0, 20);
  return out;
}

function sanitizePlanDetails(rawDetails) {
  const src = rawDetails && typeof rawDetails === 'object' ? rawDetails : {};
  const out = {};
  for (const id of Object.keys(src)) {
    const raw = src[id];
    if (!raw || typeof raw !== 'object') continue;
    const detail = {};
    if (typeof raw.description === 'string') {
      const d = raw.description.trim().slice(0, 280);
      if (d) detail.description = d;
    }
    if (typeof raw.usersLabel === 'string') {
      const u = raw.usersLabel.trim().slice(0, 80);
      if (u) detail.usersLabel = u;
    }
    if (typeof raw.retentionLabel === 'string') {
      const r = raw.retentionLabel.trim().slice(0, 120);
      if (r) detail.retentionLabel = r;
    }
    if (typeof raw.billingNote === 'string') {
      const b = raw.billingNote.trim().slice(0, 120);
      if (b) detail.billingNote = b;
    }
    const advantages = sanitizeAdvantages(raw.advantages);
    if (advantages && advantages.length) detail.advantages = advantages;
    if (Object.keys(detail).length) out[id] = detail;
  }
  return out;
}

function resolvePlanDetails(plan, pricing, platformCatalog) {
  const companyDetail =
    pricing.planDetails && typeof pricing.planDetails[plan.id] === 'object'
      ? pricing.planDetails[plan.id]
      : {};
  const platformDetail =
    platformCatalog && typeof platformCatalog[plan.id] === 'object' ? platformCatalog[plan.id] : {};
  const description = companyDetail.description || platformDetail.description || plan.description;
  const usersLabel = companyDetail.usersLabel || platformDetail.usersLabel || plan.usersLabel;
  const retentionLabel =
    companyDetail.retentionLabel || platformDetail.retentionLabel || plan.retentionLabel;
  const billingNote = companyDetail.billingNote || platformDetail.billingNote || plan.billingNote;
  const advantages =
    (companyDetail.advantages && companyDetail.advantages.length
      ? companyDetail.advantages
      : null) ||
    (platformDetail.advantages && platformDetail.advantages.length
      ? platformDetail.advantages
      : null) ||
    defaultAdvantages({ ...plan, usersLabel, retentionLabel });
  return { description, usersLabel, retentionLabel, billingNote, advantages: [...advantages] };
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function formatPriceLabel(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return 'Sob consulta';
  const n = roundMoney(amount);
  const formatted = n.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  });
  return `R$ ${formatted}`;
}

function ensurePlatformPricing(data) {
  if (!data.platformSettings || typeof data.platformSettings !== 'object') {
    data.platformSettings = {};
  }
  const ps = data.platformSettings;
  if (!ps.storagePricing || typeof ps.storagePricing !== 'object') {
    ps.storagePricing = {
      defaultBaseAmount: DEFAULT_PRICING.baseAmount,
      defaultUpgradePercent: DEFAULT_PRICING.upgradePercent,
      defaultCorporativoConsult: DEFAULT_PRICING.corporativoConsult
    };
  }
  if (!ps.storagePlanCatalog || typeof ps.storagePlanCatalog !== 'object') {
    ps.storagePlanCatalog = {};
  }
  return ps.storagePricing;
}

function getPlatformPlanCatalog(data) {
  ensurePlatformPricing(data);
  return data.platformSettings.storagePlanCatalog || {};
}

function ensureCompanySettings(data, companyId) {
  if (!data.companySettings || typeof data.companySettings !== 'object') {
    data.companySettings = {};
  }
  if (!data.companySettings[companyId] || typeof data.companySettings[companyId] !== 'object') {
    data.companySettings[companyId] = {};
  }
  return data.companySettings[companyId];
}

function normalizePricing(raw, platformDefaults) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const baseAmount = Number(src.baseAmount);
  const upgradePercent = Number(src.upgradePercent);
  const planAmounts = {};
  const rawPlans = src.planAmounts && typeof src.planAmounts === 'object' ? src.planAmounts : {};
  for (const id of Object.keys(rawPlans)) {
    if (rawPlans[id] === null) {
      planAmounts[id] = null;
      continue;
    }
    if (rawPlans[id] != null && rawPlans[id] !== '') {
      const n = Number(rawPlans[id]);
      if (Number.isFinite(n) && n >= 0) planAmounts[id] = roundMoney(n);
    }
  }
  return {
    baseAmount:
      Number.isFinite(baseAmount) && baseAmount >= 0
        ? roundMoney(baseAmount)
        : Number(platformDefaults.defaultBaseAmount) || DEFAULT_PRICING.baseAmount,
    upgradePercent:
      Number.isFinite(upgradePercent) && upgradePercent >= 0
        ? roundMoney(upgradePercent)
        : Number(platformDefaults.defaultUpgradePercent) || DEFAULT_PRICING.upgradePercent,
    corporativoConsult:
      typeof src.corporativoConsult === 'boolean'
        ? src.corporativoConsult
        : platformDefaults.defaultCorporativoConsult !== false,
    planAmounts,
    planDetails: sanitizePlanDetails(src.planDetails)
  };
}

function getCompanyPricing(data, companyId) {
  const platform = ensurePlatformPricing(data);
  const cfg = companyId ? ensureCompanySettings(data, companyId) : null;
  return normalizePricing(cfg?.storagePricing, platform);
}

/**
 * Preço do plano: override manual → Corporativo sob consulta → base * (1 + %)^tier.
 */
function resolvePlanAmount(plan, pricing) {
  if (Object.prototype.hasOwnProperty.call(pricing.planAmounts, plan.id)) {
    const override = pricing.planAmounts[plan.id];
    if (override === null) return null;
    if (override != null && Number.isFinite(Number(override))) return roundMoney(override);
  }
  if (plan.consultPricing || (plan.id === 'corporativo' && pricing.corporativoConsult)) return null;
  const factor = Math.pow(1 + Number(pricing.upgradePercent) / 100, Number(plan.tierIndex) || 0);
  return roundMoney(Number(pricing.baseAmount) * factor);
}

function applyPricingToPlan(plan, pricing, platformCatalog = {}) {
  const amount = resolvePlanAmount(plan, pricing);
  const consult = amount == null;
  const details = resolvePlanDetails(plan, pricing, platformCatalog);
  return {
    ...plan,
    ...details,
    priceAmount: amount,
    priceLabel: consult ? 'Sob consulta' : formatPriceLabel(amount),
    priceSuffix: consult ? '' : '/mês',
    upgradePercent: pricing.upgradePercent,
    pricingMode: 'company',
    ctaLabel:
      consult && (plan.consultPricing || plan.id === 'corporativo')
        ? plan.ctaLabel || 'Falar com especialista'
        : plan.ctaLabel || 'Contratar'
  };
}

function catalogPlans() {
  const store = require('../store');
  const data = store.load();
  return getStoragePlansCatalog(data).map((p) => ({
    ...p,
    advantages: p.advantages || defaultAdvantages(p)
  }));
}

function listPlans(companyId = null) {
  const store = require('../store');
  const data = store.load();
  const plans = getStoragePlansCatalog(data);
  const pricing = getCompanyPricing(data, companyId);
  const catalog = getPlatformPlanCatalog(data);
  return plans.map((p) => applyPricingToPlan(p, pricing, catalog));
}

function findPlan(planId, data = null) {
  const storeData = data || require('../store').load();
  return getStoragePlansCatalog(storeData).find((p) => p.id === planId) || null;
}

function planForLimit(limitBytes, data = null) {
  const storeData = data || require('../store').load();
  const plans = getStoragePlansCatalog(storeData);
  const n = Number(limitBytes) || 0;
  let match = null;
  for (const p of plans) {
    if (p.storageLimitBytes <= n) match = p;
  }
  return match ? { ...match } : null;
}

function ensureRequestsArray(data) {
  if (!Array.isArray(data.storageUpgradeRequests)) {
    data.storageUpgradeRequests = [];
  }
  return data.storageUpgradeRequests;
}

function resolveCompanyIdForPlans(user, companyIdOverride = null) {
  if (!user) return null;
  if (user.role === 'admin_empresa' || user.role === 'apurador') return user.companyId || null;
  if (user.role === 'superadmin') return companyIdOverride || user.companyId || null;
  return null;
}

const LANDING_SCOPE_ID = 'pagina_inicial';
const LANDING_SCOPE_NAME = 'Página inicial';

function isLandingScope(id) {
  return String(id || '') === LANDING_SCOPE_ID;
}

function getLandingPlansView(data) {
  const plans = getStoragePlansCatalog(data).map((p) => ({
    ...p,
    advantages:
      Array.isArray(p.advantages) && p.advantages.length ? [...p.advantages] : defaultAdvantages(p)
  }));
  return {
    companyId: LANDING_SCOPE_ID,
    companyName: LANDING_SCOPE_NAME,
    scope: 'landing',
    pricing: {
      baseAmount: null,
      upgradePercent: null,
      corporativoConsult: false,
      planAmounts: {},
      planDetails: {}
    },
    platformDefaults: { ...ensurePlatformPricing(data) },
    platformCatalog: getPlatformPlanCatalog(data),
    plans
  };
}

function updateLandingPlansConfig(user, payload = {}) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const data = store.load();
  const list = ensureStoragePlansCatalog(data);
  const details =
    payload.planDetails && typeof payload.planDetails === 'object' ? payload.planDetails : {};
  const previous = list.map((p) => ({
    id: p.id,
    description: p.description,
    usersLabel: p.usersLabel,
    retentionLabel: p.retentionLabel,
    billingNote: p.billingNote,
    priceAmount: p.priceAmount,
    consultPricing: p.consultPricing,
    hidePriceOnPublic: p.hidePriceOnPublic,
    featured: p.featured,
    advantages: p.advantages
  }));

  let featuredId = null;
  for (const plan of list) {
    const raw = details[plan.id];
    if (!raw || typeof raw !== 'object') continue;

    if (typeof raw.description === 'string') {
      plan.description = raw.description.trim().slice(0, 280) || plan.description;
    }
    if (typeof raw.usersLabel === 'string') {
      plan.usersLabel = raw.usersLabel.trim().slice(0, 80) || plan.usersLabel;
    }
    if (typeof raw.retentionLabel === 'string') {
      plan.retentionLabel = raw.retentionLabel.trim().slice(0, 120) || plan.retentionLabel;
    }
    if (typeof raw.billingNote === 'string') {
      plan.billingNote = raw.billingNote.trim().slice(0, 120) || plan.billingNote;
    }
    const advantages = sanitizeAdvantages(raw.advantages);
    if (advantages && advantages.length) plan.advantages = advantages;

    if (typeof raw.hidePriceOnPublic === 'boolean') {
      plan.hidePriceOnPublic = raw.hidePriceOnPublic;
    }
    if (typeof raw.featured === 'boolean' && raw.featured) {
      featuredId = plan.id;
    } else if (typeof raw.featured === 'boolean' && !raw.featured && plan.featured) {
      plan.featured = false;
    }

    if (typeof raw.consultPricing === 'boolean') {
      plan.consultPricing = raw.consultPricing;
    }
    if (raw.consultPricing === true || raw.priceAmount === null || raw.priceAmount === '') {
      plan.consultPricing = true;
      plan.priceAmount = null;
      plan.priceLabel = 'Sob consulta';
      plan.priceSuffix = '';
      plan.ctaLabel = plan.ctaLabel || 'Falar com especialista';
    } else if (raw.priceAmount != null && raw.priceAmount !== '') {
      const n = Number(raw.priceAmount);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, status: 400, error: `Preço inválido no plano ${plan.name || plan.id}.` };
      }
      plan.consultPricing = false;
      plan.priceAmount = roundMoney(n);
      plan.priceLabel = formatPriceLabel(plan.priceAmount);
      plan.priceSuffix = '/mês';
      plan.ctaLabel = plan.ctaLabel === 'Falar com especialista' ? 'Contratar' : plan.ctaLabel || 'Contratar';
    }
  }

  if (featuredId) {
    list.forEach((p) => {
      p.featured = p.id === featuredId;
    });
  }

  data.platformSettings.storagePlans = recomputeBarPercents(list);
  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_planos_landing',
    resourceType: 'landing_storage_plans',
    resourceId: LANDING_SCOPE_ID,
    companyId: null,
    previousValue: previous,
    newValue: list.map((p) => ({
      id: p.id,
      description: p.description,
      priceAmount: p.priceAmount,
      hidePriceOnPublic: p.hidePriceOnPublic,
      featured: p.featured
    }))
  });
  store.save(data);
  return { ok: true, data: getLandingPlansView(data) };
}

function getPricingConfig(user, companyId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  if (!companyId) return { ok: false, status: 400, error: 'Informe a empresa.' };

  const store = require('../store');
  const data = store.load();
  if (isLandingScope(companyId)) {
    return { ok: true, data: getLandingPlansView(data) };
  }

  const company = companyStorage.findCompany(data, companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };

  const platform = ensurePlatformPricing(data);
  const pricing = getCompanyPricing(data, companyId);
  const catalog = getPlatformPlanCatalog(data);
  const plans = getStoragePlansCatalog(data).map((p) => applyPricingToPlan(p, pricing, catalog));

  return {
    ok: true,
    data: {
      companyId: company.id,
      companyName: company.nomeFantasia || company.razaoSocial || company.id,
      scope: 'company',
      pricing,
      platformDefaults: { ...platform },
      platformCatalog: catalog,
      plans
    }
  };
}

function listPricingConfigs(user) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const store = require('../store');
  const data = store.load();
  ensurePlatformPricing(data);
  const companies = [
    {
      companyId: LANDING_SCOPE_ID,
      companyName: LANDING_SCOPE_NAME,
      scope: 'landing',
      baseAmount: null,
      upgradePercent: null,
      corporativoConsult: false
    },
    ...(data.companies || []).map((c) => {
      const pricing = getCompanyPricing(data, c.id);
      return {
        companyId: c.id,
        companyName: c.nomeFantasia || c.razaoSocial || c.id,
        scope: 'company',
        baseAmount: pricing.baseAmount,
        upgradePercent: pricing.upgradePercent,
        corporativoConsult: pricing.corporativoConsult
      };
    })
  ];
  return { ok: true, data: { companies, platformDefaults: { ...data.platformSettings.storagePricing } } };
}

function updatePricingConfig(user, companyId, payload = {}) {
  if (isLandingScope(companyId)) {
    return updateLandingPlansConfig(user, payload);
  }

  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  if (!companyId) return { ok: false, status: 400, error: 'Informe a empresa.' };

  const data = store.load();
  const company = companyStorage.findCompany(data, companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };

  const platform = ensurePlatformPricing(data);
  const cfg = ensureCompanySettings(data, companyId);
  const previous = getCompanyPricing(data, companyId);

  const next = { ...previous };
  if (payload.baseAmount != null && payload.baseAmount !== '') {
    const n = Number(payload.baseAmount);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, status: 400, error: 'Valor base inválido.' };
    }
    next.baseAmount = roundMoney(n);
  }
  if (payload.upgradePercent != null && payload.upgradePercent !== '') {
    const n = Number(payload.upgradePercent);
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      return { ok: false, status: 400, error: 'Porcentagem de upgrade inválida (0–500).' };
    }
    next.upgradePercent = roundMoney(n);
  }
  if (typeof payload.corporativoConsult === 'boolean') {
    next.corporativoConsult = payload.corporativoConsult;
  }
  if (payload.planAmounts && typeof payload.planAmounts === 'object') {
    next.planAmounts = { ...next.planAmounts };
    for (const id of Object.keys(payload.planAmounts)) {
      const v = payload.planAmounts[id];
      if (v === null || v === '') {
        delete next.planAmounts[id];
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, status: 400, error: `Valor inválido para o plano ${id}.` };
      }
      next.planAmounts[id] = roundMoney(n);
    }
  }
  if (payload.planDetails && typeof payload.planDetails === 'object') {
    next.planDetails = sanitizePlanDetails({
      ...next.planDetails,
      ...payload.planDetails
    });
  }
  if (payload.platformCatalog && typeof payload.platformCatalog === 'object') {
    data.platformSettings.storagePlanCatalog = sanitizePlanDetails({
      ...getPlatformPlanCatalog(data),
      ...payload.platformCatalog
    });
  }

  cfg.storagePricing = {
    baseAmount: next.baseAmount,
    upgradePercent: next.upgradePercent,
    corporativoConsult: next.corporativoConsult,
    planAmounts: next.planAmounts,
    planDetails: next.planDetails
  };

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_precos_armazenamento',
    resourceType: 'company_storage_pricing',
    resourceId: companyId,
    companyId,
    previousValue: previous,
    newValue: cfg.storagePricing
  });

  store.save(data);
  const catalog = getPlatformPlanCatalog(data);
  const plans = getStoragePlansCatalog(data).map((p) => applyPricingToPlan(p, next, catalog));
  return {
    ok: true,
    data: {
      companyId,
      companyName: company.nomeFantasia || company.razaoSocial || company.id,
      pricing: next,
      platformDefaults: { ...platform },
      platformCatalog: catalog,
      plans
    }
  };
}

function listCatalogForAdmin(user) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const store = require('../store');
  const data = store.load();
  return { ok: true, data: { plans: getStoragePlansCatalog(data) } };
}

function createCatalogPlan(user, payload = {}) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const data = store.load();
  const list = ensureStoragePlansCatalog(data);
  const sanitized = sanitizePlanDefinition(payload);
  if (!sanitized.ok) return { ok: false, status: 400, error: sanitized.error };

  let plan = sanitized.plan;
  let id = plan.id;
  let n = 2;
  while (list.some((p) => p.id === id)) {
    id = `${plan.id}_${n}`;
    n += 1;
  }
  plan = { ...plan, id };
  if (plan.tierIndex == null) plan.tierIndex = list.length;
  if (plan.featured) {
    list.forEach((p) => {
      p.featured = false;
    });
  }
  list.push(plan);
  data.platformSettings.storagePlans = recomputeBarPercents(list);

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'criacao_plano_armazenamento',
    resourceType: 'storage_plan',
    resourceId: plan.id,
    companyId: null,
    newValue: { id: plan.id, name: plan.name, storageLimitBytes: plan.storageLimitBytes }
  });
  store.save(data);
  return { ok: true, data: { plan, plans: getStoragePlansCatalog(data) } };
}

function updateCatalogPlan(user, planId, payload = {}) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  if (!planId) return { ok: false, status: 400, error: 'Informe o plano.' };

  const data = store.load();
  const list = ensureStoragePlansCatalog(data);
  const idx = list.findIndex((p) => p.id === planId);
  if (idx < 0) return { ok: false, status: 404, error: 'Plano não encontrado.' };

  const sanitized = sanitizePlanDefinition(
    { ...list[idx], ...payload, id: planId },
    { existingId: planId }
  );
  if (!sanitized.ok) return { ok: false, status: 400, error: sanitized.error };

  const previous = { ...list[idx] };
  const plan = { ...sanitized.plan, id: planId };
  if (plan.featured) {
    list.forEach((p, i) => {
      if (i !== idx) p.featured = false;
    });
  }
  list[idx] = plan;
  data.platformSettings.storagePlans = recomputeBarPercents(list);

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'edicao_plano_armazenamento',
    resourceType: 'storage_plan',
    resourceId: planId,
    companyId: null,
    previousValue: {
      name: previous.name,
      storageLimitBytes: previous.storageLimitBytes
    },
    newValue: { name: plan.name, storageLimitBytes: plan.storageLimitBytes }
  });
  store.save(data);
  return { ok: true, data: { plan, plans: getStoragePlansCatalog(data) } };
}

function deleteCatalogPlan(user, planId) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  if (!planId) return { ok: false, status: 400, error: 'Informe o plano.' };

  const data = store.load();
  const list = ensureStoragePlansCatalog(data);
  if (list.length <= 1) {
    return { ok: false, status: 400, error: 'Mantenha ao menos um plano no catálogo.' };
  }
  const idx = list.findIndex((p) => p.id === planId);
  if (idx < 0) return { ok: false, status: 404, error: 'Plano não encontrado.' };

  const inUse = (data.companies || []).some((c) => c.storagePlanId === planId);
  if (inUse) {
    return {
      ok: false,
      status: 400,
      error: 'Não é possível excluir: há empresas com este plano. Altere o plano delas antes.'
    };
  }

  const removed = list[idx];
  list.splice(idx, 1);
  data.platformSettings.storagePlans = recomputeBarPercents(list);

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'exclusao_plano_armazenamento',
    resourceType: 'storage_plan',
    resourceId: planId,
    companyId: null,
    previousValue: { id: removed.id, name: removed.name }
  });
  store.save(data);
  return { ok: true, data: { plans: getStoragePlansCatalog(data) } };
}

/**
 * Empresa contrata pacote maior: quota sobe na hora + solicitação comercial para Adm_Plataforma.
 */
function contractPlan(user, planId, companyIdOverride = null) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };

  let companyId = null;
  if (user.role === 'apurador') {
    return {
      ok: false,
      status: 403,
      error: 'Apenas o Adm_Empresa pode contratar este serviço.'
    };
  }
  if (user.role === 'admin_empresa') {
    companyId = user.companyId;
  } else if (user.role === 'superadmin') {
    companyId = companyIdOverride || user.companyId || null;
  } else {
    return {
      ok: false,
      status: 403,
      error: 'Apenas o Adm_Empresa pode contratar este serviço.'
    };
  }
  if (!companyId) {
    return { ok: false, status: 400, error: 'Nenhuma empresa vinculada à sessão.' };
  }

  const data = store.load();
  const catalogPlan = findPlan(planId, data);
  if (!catalogPlan) return { ok: false, status: 400, error: 'Pacote inválido.' };

  const company = companyStorage.findCompany(data, companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };

  companyStorage.ensureCompanyStorageFields(company, data);
  const pricing = getCompanyPricing(data, companyId);
  const catalog = getPlatformPlanCatalog(data);
  const plan = applyPricingToPlan(catalogPlan, pricing, catalog);
  const previousLimit = Number(company.storageLimitBytes) || 0;
  const previousPlanId = company.storagePlanId || null;
  if (plan.storageLimitBytes <= previousLimit) {
    return {
      ok: false,
      status: 400,
      error: 'Selecione um pacote com limite maior que o atual.'
    };
  }

  const previousCatalogPlan = previousPlanId
    ? findPlan(previousPlanId, data)
    : planForLimit(previousLimit, data);
  const previousPriced = previousCatalogPlan
    ? applyPricingToPlan(previousCatalogPlan, pricing, catalog)
    : null;
  const previousAmount = previousPriced?.priceAmount ?? null;
  const newAmount = plan.priceAmount;

  company.storageLimitBytes = plan.storageLimitBytes;
  company.storagePlanId = plan.id;

  const request = {
    id: store.uid('stgup'),
    companyId: company.id,
    companyName: company.nomeFantasia || company.razaoSocial || company.id,
    planId: plan.id,
    planName: plan.name,
    previousLimitBytes: previousLimit,
    newLimitBytes: plan.storageLimitBytes,
    previousAmount,
    newAmount,
    upgradePercent: pricing.upgradePercent,
    priceLabel: plan.priceLabel,
    requestedByUserId: user.id,
    requestedByName: user.nome || user.email || user.id,
    status: 'pendente_comercial',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedByUserId: null
  };
  ensureRequestsArray(data).unshift(request);

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'contratacao_pacote_armazenamento',
    resourceType: 'company',
    resourceId: company.id,
    companyId: company.id,
    previousValue: {
      storageLimitBytes: previousLimit,
      storagePlanId: previousPlanId,
      amount: previousAmount
    },
    newValue: {
      storageLimitBytes: plan.storageLimitBytes,
      planId: plan.id,
      planName: plan.name,
      amount: newAmount,
      upgradePercent: pricing.upgradePercent,
      requestId: request.id,
      billingNote:
        'Valores reajustados conforme preço personalizado da empresa e porcentagem de upgrade definida pelo Adm_Plataforma.'
    }
  });

  store.save(data);
  const amountNote =
    newAmount != null
      ? ` Valor comercial do pacote: ${plan.priceLabel}/mês (upgrade ${pricing.upgradePercent}%).`
      : ` Pacote sob consulta comercial (upgrade ${pricing.upgradePercent}%).`;
  return {
    ok: true,
    data: {
      usage: companyStorage.storageUsageView(company),
      plan,
      request,
      pricing: {
        baseAmount: pricing.baseAmount,
        upgradePercent: pricing.upgradePercent
      },
      message:
        'Pacote contratado. A cota foi atualizada imediatamente.' +
        amountNote +
        ' Os valores serão reajustados na contratação anual.'
    }
  };
}

function listUpgradeRequests(user, { status } = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const store = require('../store');
  const data = store.load();
  let list = [...ensureRequestsArray(data)];
  if (status) {
    list = list.filter((r) => r.status === status);
  }
  return { ok: true, data: { requests: list } };
}

function resolveUpgradeRequest(user, requestId) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const data = store.load();
  const list = ensureRequestsArray(data);
  const idx = list.findIndex((r) => r.id === requestId);
  if (idx < 0) return { ok: false, status: 404, error: 'Solicitação não encontrada.' };

  const prev = list[idx];
  if (prev.status === 'tratado') {
    return { ok: true, data: { request: prev } };
  }

  list[idx] = {
    ...prev,
    status: 'tratado',
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: user.id
  };

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'tratamento_solicitacao_pacote_armazenamento',
    resourceType: 'storage_upgrade_request',
    resourceId: requestId,
    companyId: prev.companyId,
    previousValue: { status: prev.status },
    newValue: { status: 'tratado' }
  });

  store.save(data);
  return { ok: true, data: { request: list[idx] } };
}

module.exports = {
  STORAGE_PLANS,
  DEFAULT_STORAGE_PLANS,
  DEFAULT_PRICING,
  catalogPlans,
  listPlans,
  findPlan,
  planForLimit,
  resolveCompanyIdForPlans,
  getCompanyPricing,
  getPricingConfig,
  listPricingConfigs,
  updatePricingConfig,
  LANDING_SCOPE_ID,
  LANDING_SCOPE_NAME,
  isLandingScope,
  listCatalogForAdmin,
  createCatalogPlan,
  updateCatalogPlan,
  deleteCatalogPlan,
  getStoragePlansCatalog,
  ensureStoragePlansCatalog,
  listPublicPlans,
  toPublicPlanView,
  contractPlan,
  listUpgradeRequests,
  resolveUpgradeRequest,
  formatPriceLabel,
  applyPricingToPlan
};
