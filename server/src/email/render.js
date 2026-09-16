'use strict';

const { templateForEvent } = require('./privacy');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ title, bodyHtml, channelName }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
  <p style="color:#666;font-size:13px;margin:0 0 16px">${escapeHtml(channelName || 'Canal Seguro')}</p>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
  <p style="font-size:12px;color:#888">Este e-mail não contém informações sobre o conteúdo de relatos ou denúncias. Acesse o sistema para detalhes autorizados.</p>
</body></html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1a5c38;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

const SUBJECTS = {
  password_reset: 'Instruções de acesso — Canal Seguro',
  user_created: 'Sua conta no Canal Seguro foi criada',
  account_activation: 'Ative sua conta no Canal Seguro',
  report_update: 'Nova atualização disponível no Canal Seguro',
  sla_alert: 'Lembrete de prazo — Canal Seguro',
  critical_alert: 'Alerta operacional — Canal Seguro'
};

function render(eventType, payload) {
  const template = templateForEvent(eventType);
  const subject = SUBJECTS[template] || SUBJECTS.report_update;
  const channelName = payload.channelName || 'Canal Seguro';
  const firstName = payload.firstName || 'Usuário';
  const actionUrl = payload.actionUrl || '#';
  const ctaLabel = payload.ctaLabel || 'Acessar o Canal Seguro';

  let bodyHtml = '';
  let text = '';

  switch (template) {
    case 'password_reset':
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Recebemos uma solicitação para redefinir sua senha de acesso administrativo.</p>
        ${button(actionUrl, 'Redefinir senha')}
        <p style="font-size:13px;color:#666">O link expira em ${escapeHtml(String(payload.ttlMinutes || 30))} minutos. Se você não solicitou, ignore este e-mail.</p>`;
      text = `Olá, ${firstName}. Redefina sua senha: ${actionUrl} (expira em ${payload.ttlMinutes || 30} min).`;
      break;
    case 'user_created':
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Sua conta administrativa no Canal Seguro foi criada.</p>
        ${button(actionUrl, 'Acessar e definir senha')}
        <p style="font-size:13px;color:#666">Use o link acima para concluir seu primeiro acesso.</p>`;
      text = `Olá, ${firstName}. Acesse: ${actionUrl}`;
      break;
    case 'account_activation':
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Sua conta foi ativada. Você já pode acessar o painel.</p>
        ${button(actionUrl, 'Acessar o painel')}
        <p style="font-size:13px;color:#666">Se não reconhece esta ativação, contate o administrador da plataforma.</p>`;
      text = `Olá, ${firstName}. Acesse: ${actionUrl}`;
      break;
    case 'sla_alert':
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Há um relato aguardando ação dentro do prazo configurado.</p>
        ${button(actionUrl, ctaLabel)}
        <p style="font-size:13px;color:#666">Consulte o painel para priorizar o acompanhamento.</p>`;
      text = `Olá, ${firstName}. Lembrete de prazo: ${actionUrl}`;
      break;
    case 'critical_alert':
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Identificamos uma situação operacional que requer atenção imediata.</p>
        ${button(actionUrl, ctaLabel)}
        <p style="font-size:13px;color:#666">Acesse o painel para verificar relatos pendentes.</p>`;
      text = `Olá, ${firstName}. Alerta operacional: ${actionUrl}`;
      break;
    default:
      bodyHtml = `<p>Olá, ${escapeHtml(firstName)}.</p>
        <p>Há uma nova atualização disponível no seu canal.</p>
        ${button(actionUrl, ctaLabel)}
        <p style="font-size:13px;color:#666">Os detalhes estão disponíveis apenas no sistema, após autenticação.</p>`;
      text = `Olá, ${firstName}. Nova atualização: ${actionUrl}`;
  }

  return {
    subject,
    html: layout({ title: subject, bodyHtml, channelName }),
    text
  };
}

module.exports = { render, SUBJECTS };
