import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTempDir, request } from './helpers.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const READY_PATTERN = /running at (http:\/\/127\.0\.0\.1:\d+)/;

/** Starts `node src/server.js` as a separate process with the given environment variables. */
function startServerProcess(env) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { child.output += chunk; });
  child.stderr.on('data', (chunk) => { child.output += chunk; });
  return child;
}

/** Resolves with the server's base URL once it prints its ready message. */
function waitUntilReady(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Server did not start. Output:\n${child.output}`)), timeoutMs);
    const onData = () => {
      const match = READY_PATTERN.exec(child.output);
      if (match) finish(null, match[1]);
    };
    const onExit = (code) => finish(new Error(`Server exited with code ${code}. Output:\n${child.output}`));
    function finish(error, url) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(url);
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopServerProcess(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, 'exit');
  }
}

/** Runs the server until it exits by itself; fails (and stops it) if it is still running after the timeout. */
async function runUntilExit(env, timeoutMs = 10_000) {
  const child = startServerProcess(env);
  const timer = setTimeout(() => child.kill(), timeoutMs);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  assert.equal(signal, null, `server did not exit on its own within ${timeoutMs} ms. Output:\n${child.output}`);
  return { code, output: child.output };
}

describe('server.js (real process)', () => {
  let temp;
  const children = [];
  const start = (env) => {
    const child = startServerProcess(env);
    children.push(child);
    return child;
  };

  beforeEach(() => {
    temp = createTempDir();
  });

  afterEach(async () => {
    await Promise.all(children.splice(0).map(stopServerProcess));
    temp.cleanup();
  });

  it('starts on a free port with the configured database and answers the health check', async () => {
    const child = start({ PORT: '0', DB_PATH: temp.dbPath });
    const baseUrl = await waitUntilReady(child);
    assert.notEqual(new URL(baseUrl).port, '3000', 'PORT=0 must not fall back to the default port');

    const { status, body } = await request(baseUrl, 'GET', '/api/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'ok', database: 'ok' });
    assert.ok(existsSync(temp.dbPath), 'database file created at DB_PATH');
  });

  it('keeps expenses and budgets after the server process is stopped and started again', async () => {
    const first = start({ PORT: '0', DB_PATH: temp.dbPath });
    let baseUrl = await waitUntilReady(first);
    const created = await request(baseUrl, 'POST', '/api/expenses',
      { amount: 42.5, categoryId: 2, date: '2026-10-05', description: 'Train ticket' });
    assert.equal(created.status, 201);
    assert.equal((await request(baseUrl, 'PUT', '/api/budgets/2', { monthlyLimit: 100 })).status, 200);
    await stopServerProcess(first);

    const second = start({ PORT: '0', DB_PATH: temp.dbPath });
    baseUrl = await waitUntilReady(second);
    const expense = await request(baseUrl, 'GET', `/api/expenses/${created.body.id}`);
    assert.equal(expense.status, 200);
    assert.equal(expense.body.description, 'Train ticket');
    assert.equal(expense.body.amount, 42.5);

    const summary = await request(baseUrl, 'GET', '/api/analytics/summary?month=2026-10');
    const transport = summary.body.categories.find((c) => c.name === 'Transport');
    assert.deepEqual({ spent: transport.spent, budget: transport.budget }, { spent: 42.5, budget: 100 });
  });

  it('exits with a clear message when the database cannot be opened', async () => {
    // A folder is not a valid database file.
    const { code, output } = await runUntilExit({ PORT: '0', DB_PATH: temp.dir });
    assert.equal(code, 1);
    assert.match(output, /Could not open database/);
  });

  it('exits with a clear message for an invalid PORT', async () => {
    const { code, output } = await runUntilExit({ PORT: 'abc', DB_PATH: temp.dbPath });
    assert.equal(code, 1);
    assert.match(output, /Invalid PORT "abc"/);
  });
});
