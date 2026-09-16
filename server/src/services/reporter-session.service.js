'use strict';

const config = require('../config');
const { signToken, verifyToken } = require('../utils/tokens');

function issueReporterToken(reportId, protocol) {
  return signToken(
    {
      typ: 'reporter',
      sub: reportId,
      protocol: String(protocol || '').toUpperCase()
    },
    config.REPORTER_SESSION_TTL_MS
  );
}

function reporterFromRequest(req) {
  const token = req.cookies?.[config.REPORTER_COOKIE];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.typ !== 'reporter') return null;
  return {
    reportId: payload.sub,
    protocol: payload.protocol
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.REPORTER_SESSION_TTL_MS
  };
}

module.exports = {
  issueReporterToken,
  reporterFromRequest,
  cookieOptions
};
