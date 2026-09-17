'use strict';

const store = require('../store');
const companyStorage = require('./company-storage.service');

function ensureCompanySettingsLocal(data, companyId) {
  data.companySettings = data.companySettings || {};
  if (!data.companySettings[companyId] || typeof data.companySettings[companyId] !== 'object') {
    const prefix = data.platformSettings?.defaultProtocolPrefix || 'CS';
    data.companySettings[companyId] = { protocolPrefix: prefix, protocolCounter: 100 };
  }
  return data.companySettings[companyId];
}

function listCompanies(actor, query = {}) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  const data = store.load();
  let list = [...(data.companies || [])];
  if (actor.role !== 'superadmin') {
    list = list.filter((c) => c.id === actor.companyId);
  }
  if (query.status) list = list.filter((c) => c.status === query.status);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    list = list.filter(
      (c) =>
        String(c.nomeFantasia || '')
          .toLowerCase()
          .includes(q) ||
        String(c.razaoSocial || '')
          .toLowerCase()
          .includes(q) ||
        String(c.cnpj || '').includes(q)
    );
  }
  return {
    ok: true,
    companies: list.map((c) => companyStorage.enrichCompanyForResponse(c, data))
  };
}

function createCompany(actor, payload = {}) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma pode criar empresas.' };
  }
  const nomeFantasia = String(payload.nomeFantasia || '').trim();
  if (!nomeFantasia) return { ok: false, status: 400, error: 'Nome fantasia é obrigatório.' };

  const data = store.load();
  data.companies = data.companies || [];
  const company = {
    id: store.uid('cmp'),
    status: payload.status || 'ativo',
    createdAt: new Date().toISOString(),
    logo: payload.logo || null,
    storageLimitBytes:
      typeof payload.storageLimitBytes === 'number' ? payload.storageLimitBytes : 1073741824,
    storageUsedBytes: 0,
    razaoSocial: payload.razaoSocial || '',
    nomeFantasia,
    cnpj: payload.cnpj || '',
    endereco: payload.endereco || '',
    responsavel: payload.responsavel || '',
    email: payload.email || '',
    telefone: payload.telefone || '',
    dominio: payload.dominio || '',
    corPrincipal: payload.corPrincipal || '',
    corSecundaria: payload.corSecundaria || '',
    nomeCanal: payload.nomeCanal || `Canal Seguro ${nomeFantasia}`,
    mensagemInicial:
      payload.mensagemInicial ||
      'Este é um canal seguro destinado à orientação, prevenção e comunicação de situações que possam comprometer o respeito, a segurança e o bem-estar no ambiente de trabalho.'
  };
  data.companies.push(company);
  ensureCompanySettingsLocal(data, company.id);
  companyStorage.ensureCompanyStorageFields(company, data);
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'criacao_empresa',
    resourceType: 'company',
    resourceId: company.id,
    companyId: company.id
  });
  store.save(data);
  return { ok: true, company: companyStorage.enrichCompanyForResponse(company, data) };
}

module.exports = { listCompanies, createCompany };
