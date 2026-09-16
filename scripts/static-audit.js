/**
 * Auditoria estática do frontend Canal Seguro
 * Verifica links locais, assets, scripts e consistência básica.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const report = {
  generatedAt: new Date().toISOString(),
  pages: [],
  missingAssets: [],
  jsSyntaxErrors: [],
  warnings: [],
  info: [],
  counts: {}
};

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'partials') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function resolveLocal(fromFile, href) {
  if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('data:') || href.startsWith('#')) return null;
  const clean = href.split('?')[0].split('#')[0];
  if (!clean) return null;
  return path.normalize(path.join(path.dirname(fromFile), clean));
}

const htmlFiles = walk(ROOT).filter((f) => f.endsWith('.html'));
const jsFiles = walk(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
const cssFiles = walk(path.join(ROOT, 'css')).filter((f) => f.endsWith('.css'));

report.counts.htmlPages = htmlFiles.length;
report.counts.jsFiles = jsFiles.length;
report.counts.cssFiles = cssFiles.length;

for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  const page = {
    file: rel,
    hasViewport: /name=["']viewport["']/.test(html),
    hasPublicFooter: html.includes('footer-canal'),
    isPublicPage: /class=["'][^"']*public-page/.test(html),
    missing: []
  };

  const refs = [
    ...[...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...html.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1])
  ];

  for (const href of refs) {
    const target = resolveLocal(file, href);
    if (!target) continue;
    if (!fs.existsSync(target)) {
      const miss = { page: rel, ref: href, resolved: path.relative(ROOT, target).replace(/\\/g, '/') };
      page.missing.push(miss);
      report.missingAssets.push(miss);
    }
  }

  if (!page.hasViewport) report.warnings.push({ type: 'missing-viewport', page: rel });
  if (page.isPublicPage && !page.hasPublicFooter) {
    report.warnings.push({ type: 'public-page-without-footer-canal', page: rel });
  }
  if (!page.isPublicPage && !rel.startsWith('admin/') && !rel.startsWith('empresa/') && !['login.html','recuperar-senha.html','redefinir-senha.html','configurar-mfa.html','verificar-mfa.html'].includes(rel)) {
    // ignore
  }

  report.pages.push(page);
}

for (const file of jsFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    report.jsSyntaxErrors.push({
      file: rel,
      error: (err.stderr && err.stderr.toString()) || err.message
    });
  }
}

// server JS syntax (src only)
const serverSrc = walk(path.join(ROOT, 'server', 'src')).filter((f) => f.endsWith('.js'));
report.counts.serverSrcFiles = serverSrc.length;
for (const file of serverSrc) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    report.jsSyntaxErrors.push({
      file: rel,
      error: (err.stderr && err.stderr.toString()) || err.message
    });
  }
}

report.counts.missingAssets = report.missingAssets.length;
report.counts.jsSyntaxErrors = report.jsSyntaxErrors.length;
report.counts.warnings = report.warnings.length;
report.counts.publicPages = report.pages.filter((p) => p.isPublicPage).length;
report.counts.publicWithFooter = report.pages.filter((p) => p.isPublicPage && p.hasPublicFooter).length;

const outPath = path.join(ROOT, 'docs', '_audit-static-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  summary: report.counts,
  missingAssetsSample: report.missingAssets.slice(0, 20),
  jsSyntaxErrors: report.jsSyntaxErrors,
  warnings: report.warnings
}, null, 2));
console.log('Wrote', outPath);
