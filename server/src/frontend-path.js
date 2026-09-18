'use strict';

/**
 * Raiz dos arquivos estáticos do frontend (HTML/JS/CSS).
 *
 * Layouts suportados:
 * - Local: server/public ou raiz do repositório
 * - Hostinger: pasta server/ renomeada para nodejs/ → nodejs/public
 * - Probe Hostinger: raiz da versão (pai de nodejs/) e o próprio nodejs/
 *
 * Sem caminhos absolutos hardcoded.
 */
const fs = require('fs');
const path = require('path');

function uniqueResolved(dirs) {
  const out = [];
  const seen = new Set();
  for (const d of dirs) {
    if (!d) continue;
    const resolved = path.resolve(d);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Diretórios candidatos relativos a este módulo e ao cwd.
 * __dirname = …/nodejs/src ou …/server/src
 */
function candidateDirs() {
  const fromEnv = process.env.CS_FRONTEND_ROOT && String(process.env.CS_FRONTEND_ROOT).trim();
  const pkgRoot = path.resolve(__dirname, '..'); // server/ ou nodejs/
  const versionRoot = path.resolve(pkgRoot, '..'); // pai (repo ou “versão” Hostinger)
  const cwd = process.cwd();

  return uniqueResolved([
    fromEnv || null,
    path.join(pkgRoot, 'public'), // nodejs/public | server/public
    path.join(cwd, 'public'),
    pkgRoot, // index.html direto em nodejs/ (improvável, mas Hostinger lista)
    path.join(versionRoot, 'public'), // versão/public
    versionRoot, // raiz do repo / raiz da versão
    path.join(cwd, '..', 'public'),
    path.resolve(cwd, '..'),
    cwd
  ]);
}

function resolveFrontendRoot() {
  const tried = [];
  for (const dir of candidateDirs()) {
    tried.push(dir);
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  throw new Error(
    `[frontend] index.html não encontrado. Candidatos tentados:\n  - ${tried.join('\n  - ')}\n` +
      'Execute o build a partir da raiz do repositório: npm run build --prefix server\n' +
      'e confirme que server/public/index.html (nodejs/public no runtime Hostinger) existe.'
  );
}

module.exports = {
  resolveFrontendRoot,
  candidateDirs
};
