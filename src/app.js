import express from 'express';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Builds the Express application without starting a server.
 * The database is passed in, so tests can supply an isolated temporary database.
 */
export function createApp(db) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'ok' });
  });

  app.use(express.static(publicDir));

  return app;
}
