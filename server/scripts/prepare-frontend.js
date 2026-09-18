'use strict';

/**
 * Copia o frontend estático (raiz do repo) para server/public.
 * Assim o Express serve o front mesmo com Application root = server na Hostinger.
 *
 * Uso: npm run build
 */
const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const PUBLIC_DIR = path.resolve(SERVER_DIR, 'public');
const ASSET_DIRS = ['js', 'css', 'admin', 'empresa', 'assets', 'partials'];

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const repoIndex = path.join(REPO_ROOT, 'index.html');
  const publicIndex = path.join(PUBLIC_DIR, 'index.html');

  if (!fs.existsSync(repoIndex)) {
    if (fs.existsSync(publicIndex)) {
      console.log('[frontend] Repo root sem index.html — mantendo server/public existente:', PUBLIC_DIR);
      process.exit(0);
    }
    console.error('[frontend] index.html não encontrado em', REPO_ROOT);
    console.error('[frontend] O deploy precisa incluir a raiz do repositório (não só a pasta server/).');
    process.exit(1);
  }

  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  for (const name of fs.readdirSync(REPO_ROOT)) {
    if (!name.toLowerCase().endsWith('.html')) continue;
    fs.copyFileSync(path.join(REPO_ROOT, name), path.join(PUBLIC_DIR, name));
  }

  for (const dir of ASSET_DIRS) {
    const src = path.join(REPO_ROOT, dir);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(PUBLIC_DIR, dir));
    }
  }

  if (!fs.existsSync(publicIndex)) {
    console.error('[frontend] Falha ao publicar index.html em', PUBLIC_DIR);
    process.exit(1);
  }

  console.log('[frontend] Publicado em', PUBLIC_DIR);
}

main();
