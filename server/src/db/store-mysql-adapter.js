'use strict';

/**
 * Adapter store.json ↔ tabelas MySQL (Etapa 4).
 * Cada entidade: colunas indexáveis + payload JSON com o documento completo.
 */

const { getPool } = require('./pool');

function parsePayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function jsonParam(obj) {
  return JSON.stringify(obj == null ? {} : obj);
}

/** @type {Array<{storeKey:string, table:string, kind:'array'|'map'|'singleton'|'flag', mapId?:string, flagKey?:string, columns?:Function}>} */
const ENTITY_MAP = [
  {
    storeKey: '_meta',
    table: 'store_meta',
    kind: 'singleton',
    mapId: 'default',
    columns: () => ({ id: 'default' })
  },
  {
    storeKey: '__supportFaqsChanged',
    table: 'store_flags',
    kind: 'flag',
    flagKey: '__supportFaqsChanged'
  },
  {
    storeKey: 'platformSettings',
    table: 'platform_settings',
    kind: 'singleton',
    mapId: 'default',
    columns: () => ({ id: 'default' })
  },
  {
    storeKey: 'companySettings',
    table: 'company_settings',
    kind: 'map',
    columns: (companyId, _payload) => ({ company_id: companyId })
  },
  {
    storeKey: 'companies',
    table: 'companies',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      nome_fantasia: row.nomeFantasia ?? null,
      razao_social: row.razaoSocial ?? null,
      cnpj: row.cnpj ?? null,
      dominio: row.dominio ?? null,
      status: row.status ?? null,
      storage_limit_bytes: row.storageLimitBytes ?? null,
      storage_used_bytes: row.storageUsedBytes ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'users',
    table: 'users',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      email: row.email ?? null,
      username: row.username ?? null,
      nome: row.nome ?? null,
      role: row.role ?? null,
      company_id: row.companyId ?? null,
      status: row.status ?? null,
      is_platform_master: row.isPlatformMaster ? 1 : 0,
      session_version: row.sessionVersion ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'employees',
    table: 'employees',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      company_id: row.companyId ?? null,
      nome: row.nome ?? null,
      email: row.email ?? null,
      matricula: row.matricula ?? null,
      status: row.status ?? null,
      cpf_hash: row.cpfHash ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'reports',
    table: 'reports',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      protocol: row.protocol ?? null,
      company_id: row.companyId ?? null,
      category: row.category ?? null,
      status: row.status ?? null,
      is_anonymous: row.isAnonymous ? 1 : 0,
      assignee_id: row.assigneeId ?? null,
      risk_level: row.riskLevel ?? null,
      workflow_stage: row.workflowStage ?? null,
      created_at: row.createdAt ?? null,
      updated_at: row.updatedAt ?? null
    })
  },
  {
    storeKey: 'reportHistory',
    table: 'report_history',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      report_id: row.reportId ?? null,
      user_id: row.userId ?? null,
      action: row.action ?? null,
      date_at: row.date ?? null
    })
  },
  {
    storeKey: 'reportMessages',
    table: 'report_messages',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      report_id: row.reportId ?? null,
      direction: row.direction ?? null,
      message_type: row.messageType ?? null,
      status: row.status ?? null,
      actor_user_id: row.actorUserId ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'reportRiskHistory',
    table: 'report_risk_history',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      report_id: row.reportId ?? null,
      company_id: row.companyId ?? null,
      protocol: row.protocol ?? null,
      level: row.level ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'reportWorkflowHistory',
    table: 'report_workflow_history',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      report_id: row.reportId ?? null,
      company_id: row.companyId ?? null,
      protocol: row.protocol ?? null,
      previous_stage: row.previousStage ?? null,
      new_stage: row.newStage ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'contents',
    table: 'contents',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      type: row.type ?? null,
      title: row.title ?? null,
      slug: row.slug ?? null,
      company_id: row.companyId ?? null,
      status: row.status ?? null,
      sort_order: row.sortOrder ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'notifications',
    table: 'notifications',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      type: row.type ?? null,
      company_id: row.companyId ?? null,
      report_id: row.reportId ?? null,
      protocol: row.protocol ?? null,
      is_read: row.read ? 1 : 0,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'auditLogs',
    table: 'audit_logs',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      date_at: row.date ?? null,
      user_id: row.userId ?? null,
      action: row.action ?? null,
      resource_type: row.resourceType ?? null,
      resource_id: row.resourceId ?? null,
      company_id: row.companyId ?? null
    })
  },
  {
    storeKey: 'techLogs',
    table: 'tech_logs',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      created_at: row.createdAt ?? row.date ?? null
    })
  },
  {
    storeKey: 'categories',
    table: 'categories',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      label: row.label ?? null,
      sort_order: row.order ?? row.sortOrder ?? null
    })
  },
  {
    storeKey: 'statuses',
    table: 'statuses',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      label: row.label ?? null,
      sort_order: row.order ?? row.sortOrder ?? null
    })
  },
  {
    storeKey: 'supportFaqs',
    table: 'support_faqs',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      audience: row.audience ?? null,
      enabled: row.enabled === false ? 0 : 1,
      sort_order: row.sortOrder ?? null,
      updated_at: row.updatedAt ?? null
    })
  },
  {
    storeKey: 'platformSupportThreads',
    table: 'platform_support_threads',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      company_id: row.companyId ?? null,
      status: row.status ?? null,
      created_at: row.createdAt ?? null,
      updated_at: row.updatedAt ?? null
    })
  },
  {
    storeKey: 'storageUpgradeRequests',
    table: 'storage_upgrade_requests',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      company_id: row.companyId ?? null,
      status: row.status ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'passwordResetTokens',
    table: 'password_reset_tokens',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      user_id: row.userId ?? null,
      expires_at: row.expiresAt ?? null
    })
  },
  {
    storeKey: 'emailQueue',
    table: 'email_queue',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      status: row.status ?? null,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'emailDeliveryLogs',
    table: 'email_delivery_logs',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'emailDedupeKeys',
    table: 'email_dedupe_keys',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      created_at: row.createdAt ?? null
    })
  },
  {
    storeKey: 'emailSuppressions',
    table: 'email_suppressions',
    kind: 'array',
    columns: (row) => ({
      id: row.id,
      created_at: row.createdAt ?? null
    })
  }
];

function emptyStore() {
  return {
    _meta: {},
    companies: [],
    users: [],
    employees: [],
    reports: [],
    reportHistory: [],
    reportMessages: [],
    reportRiskHistory: [],
    reportWorkflowHistory: [],
    contents: [],
    notifications: [],
    auditLogs: [],
    techLogs: [],
    categories: [],
    statuses: [],
    platformSettings: {},
    companySettings: {},
    supportFaqs: [],
    platformSupportThreads: [],
    storageUpgradeRequests: [],
    passwordResetTokens: [],
    emailQueue: [],
    emailDeliveryLogs: [],
    emailDedupeKeys: [],
    emailSuppressions: [],
    __supportFaqsChanged: false
  };
}

async function loadAll(connection) {
  const pool = connection || (await getPool());
  const data = emptyStore();

  for (const ent of ENTITY_MAP) {
    if (ent.kind === 'flag') {
      const [rows] = await pool.query('SELECT flag_value FROM store_flags WHERE flag_key = ?', [
        ent.flagKey
      ]);
      data[ent.storeKey] = Boolean(rows[0] && rows[0].flag_value);
      continue;
    }

    if (ent.kind === 'singleton') {
      const [rows] = await pool.query(`SELECT payload FROM \`${ent.table}\` WHERE id = ?`, [
        ent.mapId
      ]);
      const payload = rows[0] ? parsePayload(rows[0].payload) : null;
      data[ent.storeKey] = payload && typeof payload === 'object' ? payload : {};
      continue;
    }

    if (ent.kind === 'map') {
      const [rows] = await pool.query(`SELECT company_id, payload FROM \`${ent.table}\``);
      const map = {};
      for (const row of rows || []) {
        const payload = parsePayload(row.payload);
        if (row.company_id && payload && typeof payload === 'object') {
          map[row.company_id] = payload;
        }
      }
      data[ent.storeKey] = map;
      continue;
    }

    // array
    const [rows] = await pool.query(`SELECT payload FROM \`${ent.table}\``);
    const list = [];
    for (const row of rows || []) {
      const payload = parsePayload(row.payload);
      if (payload && typeof payload === 'object' && payload.id) list.push(payload);
    }
    data[ent.storeKey] = list;
  }

  return data;
}

async function replaceArrayTable(conn, ent, rows) {
  await conn.query(`DELETE FROM \`${ent.table}\``);
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (!row || !row.id) continue;
    const cols = ent.columns(row);
    const keys = Object.keys(cols);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO \`${ent.table}\` (${keys.join(', ')}, payload) VALUES (${placeholders}, ?)`;
    await conn.query(sql, [...keys.map((k) => cols[k]), jsonParam(row)]);
  }
}

async function saveAll(data, connection) {
  const pool = connection || (await getPool());
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const ent of ENTITY_MAP) {
      if (ent.kind === 'flag') {
        const val = data[ent.storeKey] ? 1 : 0;
        await conn.query(
          `INSERT INTO store_flags (flag_key, flag_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value)`,
          [ent.flagKey, val]
        );
        continue;
      }

      if (ent.kind === 'singleton') {
        const payload = data[ent.storeKey] && typeof data[ent.storeKey] === 'object' ? data[ent.storeKey] : {};
        await conn.query(
          `INSERT INTO \`${ent.table}\` (id, payload) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
          [ent.mapId, jsonParam(payload)]
        );
        continue;
      }

      if (ent.kind === 'map') {
        await conn.query(`DELETE FROM \`${ent.table}\``);
        const map = data[ent.storeKey] && typeof data[ent.storeKey] === 'object' ? data[ent.storeKey] : {};
        for (const [companyId, payload] of Object.entries(map)) {
          if (!companyId || !payload || typeof payload !== 'object') continue;
          await conn.query(
            `INSERT INTO \`${ent.table}\` (company_id, payload) VALUES (?, ?)`,
            [companyId, jsonParam(payload)]
          );
        }
        continue;
      }

      await replaceArrayTable(conn, ent, data[ent.storeKey]);
    }

    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Round-trip em memória (testes sem MySQL). */
function projectToRows(data) {
  return ENTITY_MAP.map((ent) => ({
    storeKey: ent.storeKey,
    table: ent.table,
    kind: ent.kind
  }));
}

module.exports = {
  ENTITY_MAP,
  emptyStore,
  loadAll,
  saveAll,
  parsePayload,
  projectToRows
};
