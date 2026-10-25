import { config } from './config';
import { createDatabase } from './db';
import { createApp } from './app';

const db = createDatabase(config.databasePath);
const app = await createApp({ config, db, serveStatic: true, logger: true });

if (!config.configured) {
  app.log.warn(
    `Kairo is not fully configured. Missing: ${config.missing.join(', ') || 'unknown settings'}. The setup screen will remain visible.`,
  );
}

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}; shutting down.`);
  try {
    await app.close();
  } finally {
    db.close();
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Kairo server listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  db.close();
  process.exit(1);
}
