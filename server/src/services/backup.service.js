'use strict';

/**
 * Backup operacional do Canal Seguro (store.json + anexos).
 * Uso típico: gerar backup antes de atualizar o sistema e restaurar
 * todas as informações/configurações após o deploy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const { appendAudit } = require('./audit.service');

const SCHEMA_VERSION = 16;
const RETENTION_MAX = Math.max(3, Number(process.env.CS_BACKUP_RETENTION_MAX) || 30);
const ATTACHMENTS_DIR_NAME = 'attachments';
const BACKUPS_DIR_NAME = 'backups';

const ENTITY_LABELS = {
  companies: 'Empresas',
  users: 'Usuários',
  employees: 'Colaboradores',
  reports: 'Relatos',
  reportHistory: 'Histórico de relatos',
  reportMessages: 'Mensagens dos relatos',
  reportRiskHistory: 'Classificação de risco',
  reportWorkflowHistory: 'Workflow de apuração',
  contents: 'Conteúdos (FAQ/educação)',
  notifications: 'Notificações',
  auditLogs: 'Auditoria',
  techLogs: 'Logs técnicos',
  platformSettings: 'Configurações da plataforma',
  companySettings: 'Configurações por empresa',
  categories: 'Categorias',
  statuses: 'Status',
  supportFaqs: 'FAQ do Assistente Virtual',
  platformSupportThreads: 'Suporte técnico (empresas)',
  platformInternalSupportThreads: 'Atendimento interno',
  storageUpgradeRequests: 'Solicitações de armazenamento',
  emailQueue: 'Fila de e-mails',
  emailDeliveryLogs: 'Logs de e-mail',
  emailDedupeKeys: 'Deduplicação de e-mail',
  emailSuppressions: 'Supressões de e-mail',
  passwordResetTokens: 'Tokens de reset (efêmeros)'
};

function backupsRoot() {
  return path.join(store.DATA_DIR, BACKUPS_DIR_NAME);
}

function attachmentsRoot() {
  return path.join(store.DATA_DIR, ATTACHMENTS_DIR_NAME);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeBackupId(id) {
  const raw = String(id || '').trim();
  if (!/^bkp_[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

function backupDir(backupId) {
  const id = safeBackupId(backupId);
  if (!id) return null;
  return path.join(backupsRoot(), id);
}

function countEntity(val) {
  if (Array.isArray(val)) return val.length;
  if (val && typeof val === 'object') return Object.keys(val).length || 1;
  return val ? 1 : 0;
}

function entityCountsFromStore(data) {
  const counts = {};
  Object.keys(data || {}).forEach((key) => {
    if (key.startsWith('__')) return;
    if (key === '_meta') {
      counts._meta = data._meta?.version ?? null;
      return;
    }
    counts[key] = countEntity(data[key]);
  });
  return counts;
}

function walkFiles(rootDir, base = '') {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, rel));
    } else if (entry.isFile()) {
      const stat = fs.statSync(abs);
      out.push({
        path: rel.replace(/\\/g, '/'),
        size: stat.size,
        sha256: sha256File(abs)
      });
    }
  }
  return out;
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function removeDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function readManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function listBackupDirs() {
  const root = backupsRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('bkp_'))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function pruneOldBackups() {
  const ids = listBackupDirs();
  if (ids.length <= RETENTION_MAX) return [];
  const removed = [];
  for (const id of ids.slice(RETENTION_MAX)) {
    removeDirRecursive(path.join(backupsRoot(), id));
    removed.push(id);
  }
  return removed;
}

function publicBackupView(manifest) {
  if (!manifest) return null;
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    status: manifest.status,
    verified: Boolean(manifest.verified),
    storeSha256: manifest.storeSha256,
    attachmentFileCount: (manifest.attachments || []).length,
    attachmentBytes: Number(manifest.attachmentBytes) || 0,
    entityCounts: manifest.entityCounts || {},
    createdByUserId: manifest.createdByUserId || null,
    createdByName: manifest.createdByName || null,
    note: manifest.note || null,
    restoredAt: manifest.restoredAt || null
  };
}

function getStatus(user) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma gerencia backups.' };

  const data = store.load();
  const items = listBackups(user);
  const last = items.ok ? items.data.items[0] || null : null;
  const includedKeys = Object.keys(data).filter((k) => !k.startsWith('__'));
  const mode = typeof store.getPersistenceMode === 'function' ? store.getPersistenceMode() : 'json';
  const mysqlNote =
    mode === 'mysql'
      ? ' Persistência atual: MySQL — o backup grava um snapshot JSON do estado em memória + anexos. Faça também mysqldump periódico no hPanel.'
      : '';
  return {
    ok: true,
    data: {
      ok: true,
      mode: 'operational',
      backendConnected: true,
      persistenceMode: mode,
      message:
        'Backup operacional ativo: snapshot dos dados (store) + anexos. Use antes de atualizar o sistema e restaure o último backup após o deploy.' +
        mysqlNote,
      policy: {
        apiVersion: 'v1',
        schemaVersion: SCHEMA_VERSION,
        schedules: {
          fullDaily: 'Manual / antes de cada atualização',
          incrementalDb: mode === 'mysql' ? 'Recomendado: mysqldump Hostinger (diário)' : 'N/A (store JSON)',
          attachmentsSync: 'Incluídos no backup full'
        },
        retention: {
          dailyFullDays: RETENTION_MAX,
          weeklyFullWeeks: null,
          monthlyArchiveMonths: null,
          walDays: null
        },
        storage: {
          primary: path.join(BACKUPS_DIR_NAME, '/'),
          replica: 'Copie a pasta backups/ para off-site periodicamente',
          encryption: 'Recomendado criptografar o volume / cópia off-site',
          publicAccess: false
        },
        verification: {
          postBackupChecksum: true,
          monthlyRestoreTest: true,
          stagingEnvironment: true
        }
      },
      storeMeta: data._meta || null,
      includedEntities: includedKeys.filter((k) => k !== '_meta'),
      includedEntityLabels: includedKeys
        .filter((k) => k !== '_meta')
        .map((k) => ENTITY_LABELS[k] || k),
      adminEditableNote:
        'Inclui empresas, usuários, relatos, FAQ do bot, suporte, planos, configurações e demais dados do store.',
      attachmentsNote: 'Binários de anexos são copiados junto com o backup (pasta attachments/).',
      mysqlDumpNote:
        mode === 'mysql'
          ? 'Além do backup operacional, exporte o banco no hPanel (mysqldump) antes de deploys grandes.'
          : null,
      lastBackup: last,
      backupCount: items.ok ? items.data.items.length : 0,
      backupsPath: backupsRoot()
    }
  };
}

function listBackups(user) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const items = listBackupDirs()
    .map((id) => publicBackupView(readManifest(path.join(backupsRoot(), id))))
    .filter(Boolean);
  return { ok: true, data: { items } };
}

function getBackup(user, backupId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const dir = backupDir(backupId);
  if (!dir || !fs.existsSync(dir)) return { ok: false, status: 404, error: 'Backup não encontrado.' };
  const manifest = readManifest(dir);
  if (!manifest) return { ok: false, status: 404, error: 'Manifesto do backup inválido.' };
  return { ok: true, data: publicBackupView(manifest) };
}

function createBackup(user, { note = null } = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma pode gerar backup.' };

  ensureDir(backupsRoot());
  const data = store.load();
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const id = `bkp_${stamp}`;
  const dir = path.join(backupsRoot(), id);
  const storeDest = path.join(dir, 'store.json');
  const attachmentsDest = path.join(dir, ATTACHMENTS_DIR_NAME);

  try {
    ensureDir(dir);
    // Snapshot do estado atual em memória (JSON ou MySQL) — não depende de arquivo stale.
    const storeRaw = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(storeDest, storeRaw);
    copyDirRecursive(attachmentsRoot(), attachmentsDest);

    const attachments = walkFiles(attachmentsDest);
    const attachmentBytes = attachments.reduce((sum, f) => sum + (f.size || 0), 0);
    const storeSha = sha256Buffer(storeRaw);
    const persistenceMode =
      typeof store.getPersistenceMode === 'function' ? store.getPersistenceMode() : 'json';
    const manifest = {
      id,
      type: 'operational_full',
      createdAt,
      schemaVersion: data._meta?.version ?? SCHEMA_VERSION,
      contractSchemaVersion: SCHEMA_VERSION,
      persistenceMode,
      status: 'completed',
      verified: false,
      storeSha256: storeSha,
      attachments,
      attachmentBytes,
      entityCounts: entityCountsFromStore(data),
      createdByUserId: user.id || null,
      createdByName: user.nome || user.email || user.id || null,
      note: note ? String(note).trim().slice(0, 500) : null
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const verify = verifyBackup(user, id);
    if (verify.ok) {
      manifest.verified = true;
      manifest.verifiedAt = new Date().toISOString();
      manifest.status = 'verified';
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }

    const pruned = pruneOldBackups();
    appendAudit(data, {
      userId: user.id,
      userName: user.nome || user.email || user.id,
      action: 'backup_criado',
      resourceType: 'backup',
      resourceId: id,
      newValue: {
        storeSha256: storeSha,
        attachmentFileCount: attachments.length,
        pruned
      }
    });
    store.save(data);

    return { ok: true, data: publicBackupView(manifest) };
  } catch (err) {
    removeDirRecursive(dir);
    return {
      ok: false,
      status: 500,
      error: err.message || 'Falha ao criar backup.'
    };
  }
}

function verifyBackup(user, backupId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const dir = backupDir(backupId);
  if (!dir || !fs.existsSync(dir)) return { ok: false, status: 404, error: 'Backup não encontrado.' };
  const manifest = readManifest(dir);
  if (!manifest) return { ok: false, status: 400, error: 'Manifesto inválido.' };

  const storePath = path.join(dir, 'store.json');
  if (!fs.existsSync(storePath)) {
    return { ok: false, status: 400, error: 'store.json ausente no backup.' };
  }
  const actualStoreSha = sha256File(storePath);
  if (manifest.storeSha256 && actualStoreSha !== manifest.storeSha256) {
    return {
      ok: false,
      status: 400,
      error: 'Checksum do store.json não confere.',
      data: { expected: manifest.storeSha256, actual: actualStoreSha }
    };
  }

  const attDir = path.join(dir, ATTACHMENTS_DIR_NAME);
  const currentFiles = walkFiles(attDir);
  const expected = new Map((manifest.attachments || []).map((f) => [f.path, f]));
  for (const file of currentFiles) {
    const exp = expected.get(file.path);
    if (!exp) {
      return { ok: false, status: 400, error: `Arquivo extra no backup: ${file.path}` };
    }
    if (exp.sha256 !== file.sha256) {
      return { ok: false, status: 400, error: `Checksum inválido: ${file.path}` };
    }
    expected.delete(file.path);
  }
  if (expected.size > 0) {
    const missing = [...expected.keys()][0];
    return { ok: false, status: 400, error: `Arquivo ausente no backup: ${missing}` };
  }

  manifest.verified = true;
  manifest.verifiedAt = new Date().toISOString();
  manifest.status = 'verified';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    data: {
      ...publicBackupView(manifest),
      ok: true,
      message: 'Integridade do backup confirmada.'
    }
  };
}

/**
 * Restaura backup completo (store + anexos).
 * Antes de sobrescrever, gera um backup de segurança automático.
 */
function restoreBackup(user, backupId, { confirm = false, skipSafetyBackup = false } = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma pode restaurar.' };
  if (!confirm) {
    return {
      ok: false,
      status: 400,
      error: 'Confirme a restauração enviando confirm=true. Isso substitui todos os dados atuais pelo backup.'
    };
  }

  const dir = backupDir(backupId);
  if (!dir || !fs.existsSync(dir)) return { ok: false, status: 404, error: 'Backup não encontrado.' };

  const verify = verifyBackup(user, backupId);
  if (!verify.ok) return verify;

  const sourceStore = path.join(dir, 'store.json');
  const sourceAtt = path.join(dir, ATTACHMENTS_DIR_NAME);
  let safetyId = null;

  try {
    if (!skipSafetyBackup) {
      const safety = createBackup(user, {
        note: `Pré-restauração automática antes de restaurar ${backupId}`
      });
      if (!safety.ok) {
        return {
          ok: false,
          status: 500,
          error: `Não foi possível criar backup de segurança antes da restauração: ${safety.error || 'erro'}`
        };
      }
      safetyId = safety.data.id;
    }

    // Substitui store.json
    fs.copyFileSync(sourceStore, store.STORE_PATH);

    // Substitui anexos
    const liveAtt = attachmentsRoot();
    const tmpAtt = `${liveAtt}.__restore_tmp_${Date.now()}`;
    const bakAtt = `${liveAtt}.__restore_old_${Date.now()}`;
    copyDirRecursive(sourceAtt, tmpAtt);
    if (fs.existsSync(liveAtt)) {
      fs.renameSync(liveAtt, bakAtt);
    }
    fs.renameSync(tmpAtt, liveAtt);
    removeDirRecursive(bakAtt);

    store.reload();

    const data = store.load();
    const manifest = readManifest(dir);
    if (manifest) {
      manifest.restoredAt = new Date().toISOString();
      manifest.restoredByUserId = user.id || null;
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }

    appendAudit(data, {
      userId: user.id,
      userName: user.nome || user.email || user.id,
      action: 'backup_restaurado',
      resourceType: 'backup',
      resourceId: backupId,
      newValue: { safetyBackupId: safetyId }
    });
    // Evita falha de integridade de auditoria se o store restaurado divergir do append:
    // grava via writeFile após reload já aplicado.
    try {
      store.save(data);
    } catch {
      fs.writeFileSync(store.STORE_PATH, JSON.stringify(data, null, 2));
      store.reload();
    }

    return {
      ok: true,
      data: {
        ok: true,
        restoredBackupId: backupId,
        safetyBackupId: safetyId,
        schemaVersion: data._meta?.version ?? null,
        message:
          'Backup restaurado com sucesso. Todas as informações e configurações do backup foram reaplicadas. Recarregue o painel.'
      }
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err.message || 'Falha ao restaurar backup.'
    };
  }
}

function restoreLatest(user, options = {}) {
  const listed = listBackups(user);
  if (!listed.ok) return listed;
  const latest = listed.data.items[0];
  if (!latest) return { ok: false, status: 404, error: 'Nenhum backup disponível.' };
  return restoreBackup(user, latest.id, options);
}

module.exports = {
  SCHEMA_VERSION,
  ENTITY_LABELS,
  RETENTION_MAX,
  getStatus,
  listBackups,
  getBackup,
  createBackup,
  verifyBackup,
  restoreBackup,
  restoreLatest,
  backupsRoot
};
