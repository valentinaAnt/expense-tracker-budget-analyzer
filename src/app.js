import express from 'express';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Builds the Express application without starting a server.
 * Keeping this separate from server.js lets tests create the app in isolation.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(express.static(publicDir));

  return app;
}
