'use strict';

const { assertProductionConfig } = require('./src/validate-config');
const { createApp } = require('./src/app');
const config = require('./src/config');
const { startEmailWorker } = require('./src/email/worker');

assertProductionConfig();

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`Canal Seguro API – http://localhost:${config.PORT}`);
  console.log(`Frontend estático servido na mesma origem (Etapa 03 Fase 1)`);
  startEmailWorker();
  console.log(`Worker de e-mail transacional ativo (Etapa 06)`);
});