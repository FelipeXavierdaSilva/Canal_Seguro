'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Serve páginas HTML com nonce em scripts inline (CSP).
 */
function serveHtmlWithNonce(staticRoot) {
  const root = path.resolve(staticRoot);

  return (req, res, next) => {
    let rel = req.path || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    if (!rel.toLowerCase().endsWith('.html')) return next();

    const filePath = path.normalize(path.join(root, rel.replace(/^\//, '')));
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) return next();

    const nonce = res.locals.cspNonce;
    if (!nonce) return next();

    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace(/<script(?![^>]*\ssrc=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  };
}

module.exports = { serveHtmlWithNonce };
