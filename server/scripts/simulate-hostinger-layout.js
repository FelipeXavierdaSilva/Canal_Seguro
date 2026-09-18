'use strict';

/**
 * Simula o layout Hostinger: server/ → nodejs/ com public/index.html.
 * Uso: node scripts/simulate-hostinger-layout.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO_ROOT, 'server');

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === 'node_modules' || name === 'public' || name === 'data') continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const versionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-hostinger-'));
  const nodejsDir = path.join(versionDir, 'nodejs');

  // Versão Hostinger: só o pacote Node (como se server/ virasse nodejs/)
  copyRecursive(SERVER_SRC, nodejsDir);

  // Build a partir da raiz completa do repo (fonte HTML) apontando o pacote como nodejs
  // Simula: repo disponível + pacote já renomeado — prepare sobe e acha REPO_ROOT
  const fakeServerLink = path.join(versionDir, 'server');
  // Coloca um espelho mínimo da raiz do site ao lado de nodejs para o walk-up achar index.html+js
  for (const name of fs.readdirSync(REPO_ROOT)) {
    if (!name.toLowerCase().endsWith('.html') && !['js', 'css', 'admin', 'empresa', 'assets', 'partials'].includes(name)) {
      continue;
    }
    const src = path.join(REPO_ROOT, name);
    const dest = path.join(versionDir, name);
    if (fs.statSync(src).isDirectory()) {
      copyRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // Hostinger real: build roda antes do remap, com pasta ainda chamada server/
  // Caso A — build com nome server, depois rename para nodejs
  const serverBuildDir = path.join(versionDir, 'server-build');
  copyRecursive(SERVER_SRC, serverBuildDir);
  execFileSync(process.execPath, [path.join(serverBuildDir, 'scripts', 'prepare-frontend.js')], {
    cwd: serverBuildDir,
    env: { ...process.env },
    stdio: 'inherit'
  });
  const builtPublic = path.join(serverBuildDir, 'public');
  if (!fs.existsSync(path.join(builtPublic, 'index.html'))) {
    throw new Error('Build não gerou server/public/index.html');
  }

  // Remap server → nodejs (como Hostinger)
  fs.rmSync(nodejsDir, { recursive: true, force: true });
  fs.renameSync(serverBuildDir, nodejsDir);

  const runtimeIndex = path.join(nodejsDir, 'public', 'index.html');
  if (!fs.existsSync(runtimeIndex)) {
    throw new Error(`Após remap, falta ${runtimeIndex}`);
  }
  const size = fs.statSync(runtimeIndex).size;
  if (size < 100) {
    throw new Error('index.html vazio ou inválido após remap');
  }

  // Resolvedor como no runtime (módulo em nodejs/src)
  const frontendPath = require(path.join(nodejsDir, 'src', 'frontend-path.js'));
  const resolved = frontendPath.resolveFrontendRoot();
  const resolvedIndex = path.join(resolved, 'index.html');
  if (!fs.existsSync(resolvedIndex)) {
    throw new Error(`resolveFrontendRoot → ${resolved} sem index.html`);
  }
  if (path.resolve(resolved) !== path.resolve(path.join(nodejsDir, 'public'))) {
    // Aceita também version/public se o resolvedor preferir — desde que tenha index
    console.log('[simulate] resolved=', resolved, '(esperado nodejs/public ou equivalente com index.html)');
  }

  console.log('[simulate] versionDir=', versionDir);
  console.log('[simulate] runtime index=', runtimeIndex, 'bytes=', size);
  console.log('[simulate] resolveFrontendRoot=', resolved);
  console.log('[simulate] OK');

  // cleanup
  fs.rmSync(versionDir, { recursive: true, force: true });
  // silence unused
  void fakeServerLink;
}

main();
