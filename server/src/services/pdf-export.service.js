'use strict';

const PDFDocument = require('pdfkit');

const MARGIN = 50;
const FOOTER_H = 40;

function parseColor(hex, fallback = '#6b9e9e') {
  const h = String(hex || fallback).replace('#', '');
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }
  return [107, 158, 158];
}

function drawHeader(doc, meta, pageNum) {
  const [r, g, b] = parseColor(meta.company?.corPrincipal);
  doc.save();
  doc.rect(0, 0, doc.page.width, 72).fillColor(`rgb(${r},${g},${b})`).fill();
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
  doc.text(meta.company?.nomeFantasia || 'Empresa', MARGIN, 22, { width: doc.page.width - MARGIN * 2 });
  doc.fontSize(9).font('Helvetica');
  doc.text(`${meta.platform?.productName || 'Canal Seguro'} · ${meta.company?.nomeCanal || ''}`, MARGIN, 40);
  if (meta.confidential) {
    doc.fontSize(8).text('DOCUMENTO CONFIDENCIAL', MARGIN, 56);
  }
  doc.restore();
  doc.y = 88;
}

function drawFooter(doc, meta, pageNum, totalPages) {
  const y = doc.page.height - FOOTER_H;
  doc.fontSize(7).fillColor('#666666').font('Helvetica');
  const left = meta.protocol
    ? `Protocolo ${meta.protocol}`
    : `Relatório gerencial · ${meta.company?.nomeFantasia || ''}`;
  doc.text(left, MARGIN, y);
  doc.text(
    `Gerado em ${formatShort(meta.generatedAt)} por ${meta.generatedBy?.name || '—'} · v${meta.documentVersion}`,
    MARGIN,
    y + 10,
    { width: doc.page.width - MARGIN * 2 - 60 }
  );
  doc.text(`Página ${pageNum} de ${totalPages}`, doc.page.width - MARGIN - 60, y, {
    width: 60,
    align: 'right'
  });
  doc.text(
    'Uso restrito. Contém informações confidenciais. Divulgação não autorizada é proibida.',
    MARGIN,
    y + 22,
    { width: doc.page.width - MARGIN * 2, align: 'center' }
  );
}

function formatShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

function sectionTitle(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#2c3e3a').font('Helvetica-Bold').text(title);
  doc.moveDown(0.25);
  doc.strokeColor('#cccccc').moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.35);
}

function fieldRow(doc, label, value) {
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text(`${label}: `, { continued: true });
  doc.font('Helvetica').fillColor('#222222').text(String(value ?? '—'));
}

function ensureSpace(doc, meta, needed = 80) {
  if (doc.y > doc.page.height - FOOTER_H - needed) {
    doc.addPage();
    drawHeader(doc, meta);
  }
}

function renderReportPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { meta, report } = payload;
    drawHeader(doc, meta);

    doc.fontSize(14).fillColor('#2c3e3a').font('Helvetica-Bold');
    doc.text(
      meta.exportType === 'investigation'
        ? 'Relatório de apuração'
        : 'Relatório individual de ocorrência',
      { align: 'center' }
    );
    doc.moveDown(0.5);

    sectionTitle(doc, 'Dados do relato');
    fieldRow(doc, 'Protocolo', report.protocol);
    fieldRow(doc, 'Registrado em (entrada no canal)', report.createdAt);
    fieldRow(doc, 'Categoria', report.category);
    fieldRow(doc, 'Status', report.status);
    fieldRow(doc, 'Etapa do workflow', report.workflowStage);
    fieldRow(doc, 'Prioridade operacional', report.priority);
    fieldRow(doc, 'Classificação de risco', report.riskLevel);
    if (report.riskClassifiedAt && report.riskClassifiedAt !== '—') {
      fieldRow(doc, 'Risco classificado em', report.riskClassifiedAt);
    }
    fieldRow(doc, 'Responsável', report.assigneeName);
    fieldRow(doc, 'Tipo', report.isAnonymous ? 'Anônimo' : 'Identificado');

    sectionTitle(doc, 'Descrição dos fatos');
    fieldRow(doc, 'Setor', report.sector);
    fieldRow(doc, 'Data da ocorrência (informada)', `${report.dateApprox} ${report.timeApprox}`.trim());
    fieldRow(doc, 'Local', report.location);
    fieldRow(doc, 'Envolvidos', report.involved);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica-Bold').text('Descrição:');
    doc.font('Helvetica').text(report.description || '—', { align: 'justify' });
    doc.moveDown(0.3);
    fieldRow(doc, 'Testemunhas', report.witnesses);

    if (payload.identityNote || payload.identity) {
      sectionTitle(doc, 'Comunicante');
      if (payload.identityNote) {
        doc.fontSize(9).font('Helvetica').text(payload.identityNote);
      }
      if (payload.identity && payload.identity.nome !== '[restrito]') {
        fieldRow(doc, 'Nome', payload.identity.nome);
        fieldRow(doc, 'E-mail', payload.identity.email || '—');
        fieldRow(doc, 'Telefone', payload.identity.telefone || '—');
        fieldRow(doc, 'Cargo / Setor', `${payload.identity.cargo || '—'} / ${payload.identity.setor || '—'}`);
      }
      if (payload.contactEmail) {
        fieldRow(doc, 'E-mail para retorno', payload.contactEmail);
      }
      if (payload.contactPhone) {
        fieldRow(doc, 'Telefone para retorno', payload.contactPhone);
      }
    }

    if (payload.attachments?.length) {
      sectionTitle(doc, 'Anexos (referência)');
      payload.attachments.forEach((a) => {
        doc.fontSize(9).text(`• ${a.name} (${a.mimeType}, ${a.size} bytes) — ${a.createdAt}`);
      });
    }

    if (payload.workflowTimeline?.length) {
      ensureSpace(doc, meta, 120);
      sectionTitle(doc, 'Marcos do workflow');
      payload.workflowTimeline.forEach((m) => {
        const state = m.state === 'active' ? ' [atual]' : m.state === 'done' ? ' [concluído]' : '';
        doc.fontSize(9).text(`${m.label}${state}${m.date ? ` — ${m.date}` : ''}`);
      });
    }

    if (payload.workflowHistory?.length) {
      ensureSpace(doc, meta, 100);
      sectionTitle(doc, 'Histórico de etapas');
      payload.workflowHistory.forEach((h) => {
        ensureSpace(doc, meta, 50);
        doc.fontSize(8).font('Helvetica-Bold').text(`${h.date} · ${h.userName}`);
        doc.font('Helvetica').text(`${h.from} → ${h.to}`);
        if (h.justification) doc.text(`Justificativa: ${h.justification}`);
        doc.moveDown(0.2);
      });
    }

    if (payload.riskHistory?.length) {
      ensureSpace(doc, meta, 80);
      sectionTitle(doc, 'Histórico de classificação de risco');
      payload.riskHistory.forEach((h) => {
        doc.fontSize(8).text(`${h.date} · ${h.userName}: ${h.previousLevel ? `${h.previousLevel} → ` : ''}${h.level}`);
        if (h.justification) doc.fontSize(8).text(h.justification);
        doc.moveDown(0.2);
      });
    }

    if (payload.treatmentHistory?.length) {
      ensureSpace(doc, meta, 80);
      sectionTitle(doc, 'Histórico de tratamento e observações');
      payload.treatmentHistory.forEach((h) => {
        ensureSpace(doc, meta, 40);
        doc.fontSize(8).font('Helvetica-Bold').text(`${h.date} · ${h.userName}`);
        doc.font('Helvetica').text(h.action);
        doc.moveDown(0.15);
      });
    }

    if (payload.messages?.length) {
      ensureSpace(doc, meta, 80);
      sectionTitle(doc, 'Comunicação com denunciante');
      payload.messages.forEach((m) => {
        ensureSpace(doc, meta, 50);
        doc.fontSize(8).font('Helvetica-Bold').text(`${m.date} · ${m.direction} · ${m.type}`);
        doc.font('Helvetica').text(m.body, { align: 'justify' });
        doc.moveDown(0.2);
      });
    }

    if (report.measuresAdopted) {
      sectionTitle(doc, 'Medidas adotadas');
      doc.fontSize(9).text(report.measuresAdopted, { align: 'justify' });
    }

    if (report.conclusionSummary) {
      sectionTitle(doc, 'Conclusão');
      doc.fontSize(9).text(report.conclusionSummary, { align: 'justify' });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, meta, i - range.start + 1, range.count);
    }

    doc.end();
  });
}

function renderManagerialPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { meta, summary, byStatus, byCategory, byRisk, workflowAlerts } = payload;
    drawHeader(doc, meta);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e3a').text('Relatório gerencial consolidado', {
      align: 'center'
    });
    doc.moveDown(0.5);

    if (meta.period?.from || meta.period?.to) {
      doc.fontSize(9).font('Helvetica').text(
        `Período: ${meta.period.from ? formatShort(meta.period.from) : 'início'} até ${meta.period.to ? formatShort(meta.period.to) : 'atual'}`,
        { align: 'center' }
      );
      doc.moveDown(0.5);
    }

    sectionTitle(doc, 'Indicadores');
    fieldRow(doc, 'Total de relatos', summary.total);
    fieldRow(doc, 'Concluídos', summary.concluidos);
    fieldRow(doc, 'Pendentes', summary.pendentes);
    fieldRow(doc, 'Anônimos', summary.anonymous);
    fieldRow(doc, 'Identificados', summary.identified);
    fieldRow(doc, 'Críticos', summary.criticalCount);
    fieldRow(doc, 'Alto risco', summary.highCount);
    fieldRow(doc, 'Não classificados', summary.unclassifiedCount);
    if (summary.avgTreatmentDays != null) {
      fieldRow(doc, 'Tempo médio de tratamento (dias)', summary.avgTreatmentDays);
    }

    sectionTitle(doc, 'Por status');
    Object.entries(byStatus || {}).forEach(([k, v]) => {
      doc.fontSize(9).text(`• ${k}: ${v}`);
    });

    sectionTitle(doc, 'Por categoria');
    Object.entries(byCategory || {}).forEach(([k, v]) => {
      doc.fontSize(9).text(`• ${k}: ${v}`);
    });

    sectionTitle(doc, 'Por nível de risco');
    Object.entries(byRisk || {}).forEach(([k, v]) => {
      doc.fontSize(9).text(`• ${k}: ${v}`);
    });

    if (workflowAlerts && Object.values(workflowAlerts).some((n) => n > 0)) {
      sectionTitle(doc, 'Alertas operacionais (SLA / workflow)');
      Object.entries(workflowAlerts).forEach(([k, v]) => {
        if (v > 0) doc.fontSize(9).text(`• ${k}: ${v}`);
      });
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#666666').text(
      'Este relatório contém apenas dados agregados. Não inclui descrições de relatos nem dados pessoais identificáveis.',
      { align: 'justify' }
    );

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, { ...meta, protocol: null }, i - range.start + 1, range.count);
    }

    doc.end();
  });
}

async function generatePdfBuffer(payload) {
  if (payload.meta?.exportType === 'managerial') {
    return renderManagerialPdf(payload);
  }
  return renderReportPdf(payload);
}

module.exports = { generatePdfBuffer };
