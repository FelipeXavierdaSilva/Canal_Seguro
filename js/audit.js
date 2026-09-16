/**
 * audit.js – Trilha de auditoria administrativa (protótipo).
 * Append-only em localStorage; em produção: logs imutáveis no servidor.
 *
 * Nunca registra: senha, trackingCode, CPF ou texto integral de observações.
 */

const CSAudit = (() => {
  const SENSITIVE_KEYS = new Set([
    'senha',
    'password',
    'trackingCode',
    'cpf',
    'contactEmail',
    'contactPhone',
    '_actorId',
    '_actorName'
  ]);

  const ACTION_LABELS = {
    login: 'Login',
    logout: 'Logout',
    criacao_empresa: 'Criação de empresa',
    edicao_empresa: 'Edição de empresa',
    desativacao_empresa: 'Desativação de empresa',
    criacao_colaborador: 'Criação de colaborador',
    edicao_colaborador: 'Edição de colaborador',
    desativacao_colaborador: 'Desligamento de colaborador',
    criacao_relato: 'Criação de relato',
    alteracao_status: 'Alteração de status',
    atribuicao_relato: 'Atribuição de relato',
    observacao_relato: 'Observação em relato',
    classificacao_risco: 'Classificação de risco',
    reclassificacao_risco: 'Reclassificação de risco',
    transicao_workflow: 'Transição de etapa do workflow',
    exportacao_pdf: 'Exportação de relatório em PDF',
    exportacao_excel: 'Exportação de relatório em Excel',
    politica_risco_alterada: 'Política de risco alterada',
    mensagem_empresa_enviada: 'Mensagem enviada ao denunciante',
    mensagem_denunciante_enviada: 'Resposta do denunciante',
    criacao_usuario: 'Criação de usuário',
    edicao_usuario: 'Edição de usuário',
    exclusao_usuario: 'Exclusão de usuário',
    exclusao_empresa: 'Exclusão de empresa',
    exclusao_colaborador: 'Exclusão de colaborador',
    exclusao_acesso: 'Exclusão de registro de acesso',
    solicitacao_recuperacao_senha: 'Solicitação de recuperação de senha',
    redefinicao_senha: 'Redefinição de senha',
    email_politica_alterada: 'Política de e-mail alterada',
    email_enviado: 'E-mail transacional enviado',
    email_falhou: 'Falha no envio de e-mail',
    mfa_ativado: 'MFA ativado',
    mfa_desativado: 'MFA desativado',
    mfa_verificacao_sucesso: 'Verificação MFA bem-sucedida',
    mfa_verificacao_falha: 'Falha na verificação MFA',
    mfa_recovery_usado: 'Código de recuperação MFA usado',
    mfa_recovery_regenerado: 'Códigos de recuperação MFA regenerados',
    mfa_politica_alterada: 'Política MFA alterada',
    mfa_admin_reset: 'Reset MFA por administrador',
    alteracao_quota_armazenamento: 'Alteração de quota de armazenamento',
    contratacao_pacote_armazenamento: 'Contratação de pacote de armazenamento',
    criacao_plano_armazenamento: 'Criação de plano de armazenamento',
    edicao_plano_armazenamento: 'Edição de plano de armazenamento',
    exclusao_plano_armazenamento: 'Exclusão de plano de armazenamento',
    atualizacao_capacidade_plataforma: 'Atualização da capacidade da plataforma',
    alerta_capacidade_plataforma: 'Alerta de capacidade da plataforma',
    atualizacao_precos_armazenamento: 'Atualização de preços de armazenamento',
    tratamento_solicitacao_pacote_armazenamento: 'Tratamento de solicitação de pacote',
    criacao_conteudo: 'Criação de conteúdo',
    edicao_conteudo: 'Edição de conteúdo',
    exclusao_conteudo: 'Exclusão de conteúdo',
    upload_anexo: 'Upload de anexo',
    upload_anexo_bloqueado: 'Upload de anexo bloqueado',
    upload_anexo_falha: 'Falha no upload de anexo',
    download_anexo: 'Download de anexo',
    acesso_anexo_negado: 'Acesso a anexo negado',
    remocao_anexo: 'Remoção de anexo',
    backup_iniciado: 'Backup iniciado (técnico)',
    backup_concluido: 'Backup concluído (técnico)',
    backup_falhou: 'Falha no backup (técnico)',
    backup_incompleto: 'Backup incompleto (técnico)',
    backup_verificado: 'Backup verificado (técnico)',
    backup_verificacao_falhou: 'Falha na verificação do backup (técnico)',
    backup_export_dev: 'Export snapshot DEV (protótipo)',
    backup_import_dev: 'Import snapshot DEV (protótipo)',
    restore_iniciado: 'Restauração iniciada (técnico)',
    restore_concluido: 'Restauração concluída (técnico)',
    restore_falhou: 'Falha na restauração (técnico)',
    restore_teste_iniciado: 'Teste de restauração iniciado',
    restore_teste_concluido: 'Teste de restauração concluído',
    restore_teste_falhou: 'Teste de restauração falhou'
  };

  function uid() {
    return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function sanitizeValue(value, depth = 0) {
    if (value == null || depth > 3) return value;
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
    }
    if (typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      if (SENSITIVE_KEYS.has(key)) return;
      out[key] = sanitizeValue(value[key], depth + 1);
    });
    return out;
  }

  function normalizeEntry(entry) {
    const resourceId = entry.resourceId ?? entry.targetId ?? null;
    const normalized = {
      id: entry.id || uid(),
      date: entry.date || new Date().toISOString(),
      userId: entry.userId || 'system',
      userName: entry.userName || 'Sistema',
      action: entry.action,
      resourceType: entry.resourceType || null,
      resourceId,
      targetId: resourceId,
      companyId: entry.companyId ?? null,
      protocol: entry.protocol ?? null
    };

    if (entry.previousValue !== undefined) {
      normalized.previousValue = sanitizeValue(entry.previousValue);
    }
    if (entry.newValue !== undefined) {
      normalized.newValue = sanitizeValue(entry.newValue);
    }

    return normalized;
  }

  /** Grava no objeto store em memória; o caller persiste com CSStore.saveStore. */
  function write(data, entry) {
    if (!entry || !entry.action) return null;
    data.auditLogs = data.auditLogs || [];
    const log = normalizeEntry(entry);
    data.auditLogs.unshift(log);
    return log;
  }

  function actorFields(actor = {}) {
    return {
      userId: actor.id || actor.userId || 'system',
      userName: actor.nome || actor.userName || 'Sistema'
    };
  }

  function actionLabel(action) {
    return ACTION_LABELS[action] || action;
  }

  function formatDetails(entry) {
    const prev = entry.previousValue;
    const next = entry.newValue;
    if (prev === undefined && next === undefined) return '—';
    if (typeof prev === 'string' && typeof next === 'string') {
      return `${prev} → ${next}`;
    }
    if (prev !== undefined && next !== undefined) {
      try {
        return `${JSON.stringify(prev)} → ${JSON.stringify(next)}`;
      } catch {
        return '—';
      }
    }
    if (next !== undefined) {
      try {
        return JSON.stringify(next);
      } catch {
        return '—';
      }
    }
    return '—';
  }

  function formatResource(entry) {
    const parts = [];
    if (entry.resourceType) parts.push(entry.resourceType);
    if (entry.protocol) parts.push(entry.protocol);
    else if (entry.resourceId) parts.push(entry.resourceId);
    return parts.length ? parts.join(' · ') : '—';
  }

  return {
    write,
    actorFields,
    actionLabel,
    formatDetails,
    formatResource,
    ACTION_LABELS
  };
})();

window.CSAudit = CSAudit;
