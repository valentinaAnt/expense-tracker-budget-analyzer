import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';

/**
 * Creates an empty folder in the OS temp directory for one test's database,
 * so tests never touch the real data/ folder.
 * Close every database opened in it before calling cleanup().
 */
export function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'expense-tracker-test-'));
  return {
    dir,
    dbPath: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/** Opens a fresh database in a temp folder. Call close() to close it and delete the folder. */
export function createTestDatabase() {
  const temp = createTempDir();
  const db = openDatabase(temp.dbPath);
  return {
    db,
    close() {
      if (db.open) db.close();
      temp.cleanup();
    },
  };
}

/** Starts the real Express app on a random free port, backed by a temporary database. */
export async function startTestServer() {
  const { db, close: closeDatabase } = createTestDatabase();
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    db,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      closeDatabase();
    },
  };
}

/**
 * Sends an HTTP request and returns { status, body }.
 * A string body is sent as-is (to test malformed JSON); anything else is JSON-encoded.
 */
export async function request(baseUrl, method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
