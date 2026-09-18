'use strict';

/**
 * Raiz dos arquivos estáticos do frontend (HTML/JS/CSS).
 * Ordem:
 * 1. CS_FRONTEND_ROOT (opcional)
 * 2. server/public (gerado por npm run build)
 * 3. raiz do repositório (irmão de server/)
 * 4. process.cwd() / pai do cwd
 */
const fs = require('fs');
const path = require('path');

function candidateDirs() {
  const fromEnv = process.env.CS_FRONTEND_ROOT && String(process.env.CS_FRONTEND_ROOT).trim();
  const list = [];
  if (fromEnv) list.push(path.resolve(fromEnv));
  list.push(path.resolve(__dirname, '..', 'public'));
  list.push(path.resolve(__dirname, '..', '..'));
  list.push(path.resolve(process.cwd(), '..'));
  list.push(path.resolve(process.cwd()));
  return list;
}

function resolveFrontendRoot() {
  const tried = [];
  for (const dir of candidateDirs()) {
    if (tried.includes(dir)) continue;
    tried.push(dir);
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  throw new Error(
    `[frontend] index.html não encontrado. Candidatos tentados: ${tried.join(' | ')}. ` +
      'No deploy Hostinger, use a raiz do repositório completa e rode: cd server && npm run build'
  );
}

module.exports = {
  resolveFrontendRoot,
  candidateDirs
};
