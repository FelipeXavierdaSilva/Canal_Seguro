'use strict';

const { hasPermission } = require('../utils/tokens');

const EXPORT_TYPES = {
  individual: {
    id: 'individual',
    label: 'Relatório individual de ocorrência',
    permission: 'reports:export_report',
    confidential: true
  },
  investigation: {
    id: 'investigation',
    label: 'Relatório de apuração',
    permission: 'reports:export_report',
    confidential: true
  },
  managerial: {
    id: 'managerial',
    label: 'Relatório gerencial consolidado',
    permission: 'reports:export',
    confidential: false
  }
};

const IDENTITY_FIELDS = ['reporter', 'employeeId', 'contactEmail', 'contactPhone'];

function isValidExportType(type) {
  return Boolean(EXPORT_TYPES[type]);
}

function canExportType(user, type) {
  const meta = EXPORT_TYPES[type];
  if (!meta) return false;
  return hasPermission(user, meta.permission);
}

function redactReportIdentity(report, user) {
  const copy = { ...report };
  delete copy.trackingCode;
  delete copy.trackingCodeHash;

  if (report.isAnonymous) {
    IDENTITY_FIELDS.forEach((k) => delete copy[k]);
    copy._identityNote = 'Relato anônimo — dados do comunicante não disponíveis.';
  } else if (!hasPermission(user, 'reports:view_identity')) {
    copy.reporter = copy.reporter
      ? {
          nome: '[restrito]',
          email: null,
          telefone: null,
          empresa: copy.reporter.empresa || null,
          setor: copy.reporter.setor || null,
          cargo: copy.reporter.cargo || null
        }
      : null;
    delete copy.employeeId;
    delete copy.contactEmail;
    delete copy.contactPhone;
    copy._identityNote = 'Identificação restrita ao seu perfil de acesso.';
  }
  return copy;
}

function sectionsForType(type) {
  const base = {
    reportCore: true,
    identity: true,
    attachments: true,
    assignee: true,
    risk: true,
    workflow: false,
    treatmentHistory: false,
    riskHistory: false,
    messages: false,
    conclusion: false,
    measures: false
  };

  if (type === 'individual') {
    return { ...base, workflow: false, treatmentHistory: false, messages: false };
  }
  if (type === 'investigation') {
    return {
      ...base,
      workflow: true,
      treatmentHistory: true,
      riskHistory: true,
      messages: true,
      conclusion: true,
      measures: true
    };
  }
  return base;
}

module.exports = {
  EXPORT_TYPES,
  isValidExportType,
  canExportType,
  redactReportIdentity,
  sectionsForType
};
