'use strict';

/**
 * Copia o frontend estático para <pacote>/public (server/public ou nodejs/public).
 *
 * Procura a raiz do repositório subindo diretórios até achar index.html + pasta js/.
 * Deve rodar com o repositório completo disponível (build Hostinger a partir da raiz).
 *
 * Uso: npm run build   (dentro de server/)
 *      ou na raiz: npm run build --prefix server
 */
const fs = require('fs');
const path = require('path');

const PACKAGE_DIR = path.resolve(__dirname, '..'); // server/ ou nodejs/
const PUBLIC_DIR = path.join(PACKAGE_DIR, 'public');
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

function looksLikeRepoRoot(dir) {
  return (
    fs.existsSync(path.join(dir, 'index.html')) &&
    fs.existsSync(path.join(dir, 'js')) &&
    fs.statSync(path.join(dir, 'js')).isDirectory()
  );
}

/** Sobe a partir de package e cwd até achar a raiz do site (HTML + js/). */
function findRepoRoot() {
  const starts = [path.resolve(PACKAGE_DIR, '..'), PACKAGE_DIR, process.cwd(), path.resolve(process.cwd(), '..')];
  const seen = new Set();
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      if (looksLikeRepoRoot(dir)) return dir;
      const parent = path.resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function publishFrom(repoRoot, destPublic) {
  fs.rmSync(destPublic, { recursive: true, force: true });
  fs.mkdirSync(destPublic, { recursive: true });

  for (const name of fs.readdirSync(repoRoot)) {
    if (!name.toLowerCase().endsWith('.html')) continue;
    const src = path.join(repoRoot, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(destPublic, name));
  }

  for (const dir of ASSET_DIRS) {
    const src = path.join(repoRoot, dir);
    if (fs.existsSync(src)) {
      copyRecursive(src, path.join(destPublic, dir));
    }
  }
}

function main() {
  const publicIndex = path.join(PUBLIC_DIR, 'index.html');
  const repoRoot = findRepoRoot();

  if (!repoRoot) {
    if (fs.existsSync(publicIndex)) {
      const size = fs.statSync(publicIndex).size;
      if (size > 100) {
        console.log(
          '[frontend] Raiz do repo não visível neste ambiente — mantendo public existente:',
          PUBLIC_DIR,
          `(${size} bytes)`
        );
        process.exit(0);
      }
    }
    console.error('[frontend] Não foi possível localizar a raiz do repositório (index.html + js/).');
    console.error('[frontend] PACKAGE_DIR=', PACKAGE_DIR);
    console.error('[frontend] cwd=', process.cwd());
    console.error('[frontend] Rode o build com o repositório completo, a partir da raiz ou de server/.');
    process.exit(1);
  }

  publishFrom(repoRoot, PUBLIC_DIR);

  if (!fs.existsSync(publicIndex) || fs.statSync(publicIndex).size < 100) {
    console.error('[frontend] index.html inválido ou ausente em', publicIndex);
    process.exit(1);
  }

  // Hostinger às vezes sonda também <versão>/public (irmão de nodejs/)
  const versionRoot = path.resolve(PACKAGE_DIR, '..');
  const pkgName = path.basename(PACKAGE_DIR);
  if ((pkgName === 'server' || pkgName === 'nodejs') && versionRoot !== PACKAGE_DIR) {
    const versionPublic = path.join(versionRoot, 'public');
    // Só espelha se o pai NÃO for a raiz do repo com o próprio index (evita clonar em public/ local desnecessário)
    // Em deploy Hostinger o pai costuma ser a “versão” sem ser looksLikeRepoRoot após remap — espelha sempre public do pacote.
    if (!looksLikeRepoRoot(versionRoot) || process.env.CS_MIRROR_VERSION_PUBLIC === '1') {
      publishFrom(repoRoot, versionPublic);
      console.log('[frontend] Espelho também em', versionPublic);
    }
  }

  console.log('[frontend] Fonte:', repoRoot);
  console.log('[frontend] Publicado em', PUBLIC_DIR);
  console.log('[frontend] index.html bytes:', fs.statSync(publicIndex).size);
}

main();
