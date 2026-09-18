/**
 * export-ui.js – Exportação de relatórios (PDF / Excel)
 * Prefere API do servidor quando disponível; gera localmente a partir da prévia.
 */

const CSExportUI = (() => {
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `export-${Date.now()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCellDate(value) {
    if (!value) return '';
    if (typeof CSReports !== 'undefined' && CSReports.formatDate) {
      return CSReports.formatDate(value);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('pt-BR');
  }

  function resolveColumns(includeCompany) {
    const cols = [
      { key: 'protocol', label: 'Protocolo' },
      ...(includeCompany ? [{ key: 'company', label: 'Empresa' }] : []),
      { key: 'registeredAt', label: 'Data do registro' },
      { key: 'occurrenceAt', label: 'Data da ocorrência' },
      { key: 'category', label: 'Categoria' },
      { key: 'sector', label: 'Setor' },
      { key: 'anonymous', label: 'Tipo' },
      { key: 'status', label: 'Status' }
    ];
    return cols;
  }

  function normalizeRows(report, options = {}) {
    const companyMap = options.companyMap || {};
    const includeCompany = Boolean(options.includeCompany);
    return (report?.rows || []).map((r) => {
      const row = {
        protocol: r.protocol || '',
        registeredAt: formatCellDateTime(r.registeredAt || r.date),
        occurrenceAt:
          typeof CSReports !== 'undefined' && CSReports.formatOccurrence
            ? CSReports.formatOccurrence(r.occurrenceAt, r.occurrenceTime)
            : String(r.occurrenceAt || r.dateApprox || '—'),
        category: r.category || '',
        sector: r.sector || '—',
        anonymous: r.anonymous || '',
        status: r.status || ''
      };
      if (includeCompany) {
        row.company = companyMap[r.companyId] || r.companyName || r.companyId || '—';
      }
      return row;
    });
  }

  function formatCellDateTime(value) {
    if (!value) return '';
    if (typeof CSReports !== 'undefined' && CSReports.formatDateTime) {
      return CSReports.formatDateTime(value);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR');
  }

  function buildSpreadsheetXml(columns, rows, title) {
    const headerCells = columns
      .map((c) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(c.label)}</Data></Cell>`)
      .join('');
    const body = rows
      .map((row) => {
        const cells = columns
          .map((c) => `<Cell><Data ss:Type="String">${escapeXml(row[c.key] ?? '')}</Data></Cell>`)
          .join('');
        return `<Row>${cells}</Row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E8F0EE" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14"/></Style>
 </Styles>
 <Worksheet ss:Name="Relatorio">
  <Table>
   <Row><Cell ss:StyleID="Title"><Data ss:Type="String">${escapeXml(title || 'Relatório Canal Seguro')}</Data></Cell></Row>
   <Row></Row>
   <Row>${headerCells}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
  }

  /** PDF textual mínimo (sem dependências). */
  function buildSimplePdf(title, metaLines, columns, rows) {
    const lines = [];
    lines.push(String(title || 'Relatório Canal Seguro'));
    (metaLines || []).forEach((m) => lines.push(String(m)));
    lines.push('');
    lines.push(columns.map((c) => c.label).join(' | '));
    lines.push('-'.repeat(72));
    rows.forEach((row) => {
      lines.push(columns.map((c) => String(row[c.key] ?? '')).join(' | '));
    });
    if (!rows.length) lines.push('(sem registros)');

    const content = [];
    let y = 800;
    const fontSize = 9;
    const leading = 12;
    content.push('BT /F1 11 Tf 40 820 Td (' + pdfEscape(title || 'Relatório') + ') Tj ET');
    y = 800;
    lines.slice(1).forEach((line) => {
      if (y < 50) {
        content.push('showpage');
        y = 820;
      }
      content.push(`BT /F1 ${fontSize} Tf 40 ${y} Td (${pdfEscape(line.slice(0, 110))}) Tj ET`);
      y -= leading;
    });

    const stream = content.join('\n');
    const objects = [];
    objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
    objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
    objects.push(
      '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
    );
    objects.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`);
    objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj) => {
      offsets.push(pdf.length);
      pdf += obj;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function pdfEscape(str) {
    return String(str ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E]/g, (ch) => {
        // Remove acentos para Helvetica Type1 padrão
        return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '?';
      });
  }

  function stampFilename(prefix, ext) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${prefix}-${stamp}.${ext}`;
  }

  function exportTableExcel(report, options = {}) {
    if (!report?.rows?.length) {
      CSApp.toast('Gere um relatório com dados antes de exportar.', 'warning');
      return false;
    }
    const includeCompany = Boolean(options.includeCompany);
    const columns = resolveColumns(includeCompany);
    const rows = normalizeRows(report, options);
    const title = options.title || 'Relatório Canal Seguro';
    const xml = buildSpreadsheetXml(columns, rows, title);
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    triggerDownload(blob, options.filename || stampFilename('canal-seguro-relatorio', 'xls'));
    CSApp.toast('Excel gerado com sucesso.', 'success');
    return true;
  }

  function exportTablePdfLocal(report, options = {}) {
    if (!report?.rows?.length) {
      CSApp.toast('Gere um relatório com dados antes de exportar.', 'warning');
      return false;
    }
    const includeCompany = Boolean(options.includeCompany);
    const columns = resolveColumns(includeCompany);
    const rows = normalizeRows(report, options);
    const meta = [
      `Gerado em: ${
        typeof CSReports !== 'undefined' && CSReports.formatDateTime
          ? CSReports.formatDateTime(report.generatedAt || new Date().toISOString())
          : new Date().toLocaleString('pt-BR')
      }`,
      `Total: ${report.total ?? rows.length} registro(s)`,
      'Documento confidencial — uso interno'
    ];
    const blob = buildSimplePdf(options.title || 'Relatorio Canal Seguro', meta, columns, rows);
    triggerDownload(blob, options.filename || stampFilename('canal-seguro-relatorio', 'pdf'));
    CSApp.toast('PDF gerado com sucesso.', 'success');
    return true;
  }

  async function exportReport(reportId, type) {
    if (!CSRuntime.useServer()) {
      CSApp.toast('Exportação individual de relato em PDF requer o servidor (npm start em server/).', 'warning');
      return false;
    }
    try {
      const { blob, filename } = await CSHttpApi.exportReportPdf(reportId, type);
      triggerDownload(blob, filename);
      CSApp.toast('PDF gerado com sucesso.', 'success');
      return true;
    } catch (err) {
      CSApp.toast(CSErrors.userMessage(err), 'error');
      return false;
    }
  }

  async function exportManagerial(filters, actor, previewReport, options = {}) {
    const preferServer =
      canExportManagerial(actor) &&
      CSRuntime.useServer() &&
      typeof CSHttpApi !== 'undefined' &&
      CSHttpApi.exportManagerialPdf;

    if (preferServer) {
      try {
        const { blob, filename } = await CSHttpApi.exportManagerialPdf(filters || {});
        triggerDownload(blob, filename);
        CSApp.toast('PDF gerencial exportado.', 'success');
        return true;
      } catch (err) {
        CSErrors.logError?.(err, 'exportManagerialPdf');
      }
    }
    if (previewReport) {
      return exportTablePdfLocal(previewReport, {
        includeCompany: options.includeCompany,
        companyMap: options.companyMap,
        title: options.title || 'Relatório gerencial — Canal Seguro'
      });
    }
    CSApp.toast('Exportação PDF requer gerar a prévia do relatório (ou iniciar o servidor).', 'warning');
    return false;
  }

  async function exportManagerialExcel(filters, actor, previewReport, options = {}) {
    const preferServer =
      canExportManagerial(actor) &&
      CSRuntime.useServer() &&
      typeof CSHttpApi !== 'undefined' &&
      CSHttpApi.exportManagerialExcel;

    if (preferServer) {
      try {
        const { blob, filename } = await CSHttpApi.exportManagerialExcel(filters || {});
        triggerDownload(blob, filename);
        CSApp.toast('Excel gerado com sucesso.', 'success');
        return true;
      } catch (err) {
        CSErrors.logError?.(err, 'exportManagerialExcel');
      }
    }
    if (previewReport) {
      return exportTableExcel(previewReport, {
        includeCompany: options.includeCompany,
        companyMap: options.companyMap,
        title: options.title || 'Relatório Canal Seguro'
      });
    }
    CSApp.toast('Gere um relatório com dados antes de exportar.', 'warning');
    return false;
  }

  function canExportReport(actor) {
    if (!actor) return false;
    return ['superadmin', 'admin_empresa', 'apurador'].includes(actor.role);
  }

  function canExportManagerial(actor) {
    if (!actor) return false;
    return actor.role === 'superadmin' || actor.role === 'admin_empresa';
  }

  return {
    triggerDownload,
    exportReport,
    exportManagerial,
    exportManagerialExcel,
    exportTableExcel,
    exportTablePdfLocal,
    canExportReport,
    canExportManagerial
  };
})();

window.CSExportUI = CSExportUI;
