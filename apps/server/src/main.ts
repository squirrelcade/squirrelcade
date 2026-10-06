import { buildApp } from './app.js';

const squirrelcade = await buildApp();
const { app, env } = squirrelcade;

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.fatal({ err }, 'Could not start the web server');
  await squirrelcade.close();
  process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    app.log.info({ context: 'startup' }, `Stopping (${signal})`);
    squirrelcade.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
