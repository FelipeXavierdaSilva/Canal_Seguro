'use strict';

const { assertProductionConfig } = require('./src/validate-config');
const { createApp } = require('./src/app');
const config = require('./src/config');
const store = require('./src/store');
const { startEmailWorker } = require('./src/email/worker');

assertProductionConfig();

async function main() {
  // Garante store.json (mesmo caminho do seed) antes do listen e do email-worker
  await store.init();
  const mode = store.getPersistenceMode();
  const app = createApp();

  const server = app.listen(config.PORT, () => {
    console.log(`Canal Seguro API – http://localhost:${config.PORT}`);
    console.log(`Frontend estático servido na mesma origem (Etapa 03 Fase 1)`);
    try {
      const { resolveFrontendRoot } = require('./src/frontend-path');
      console.log(`Frontend root: ${resolveFrontendRoot()}`);
    } catch (err) {
      console.error(err && err.message ? err.message : err);
    }
    console.log(`Persistência: ${mode}`);
    console.log(`Store: ${store.STORE_PATH}`);
    startEmailWorker();
    console.log(`Worker de e-mail transacional ativo (Etapa 06)`);
  });

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} — aguardando flush do store…`);
    try {
      await store.flush();
    } catch (err) {
      console.error('[shutdown] flush falhou:', err);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
