import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES } from '../src/db/database.js';
import { request, startTestServer } from './helpers.js';

const validBody = { amount: 25.4, categoryId: 1, date: '2026-10-10', description: 'Dinner' };

describe('Expenses API (HTTP)', () => {
  let server;
  const call = (method, path, body) => request(server.baseUrl, method, path, body);

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  it('GET /api/health reports the server and database as ok', async () => {
    const { status, body } = await call('GET', '/api/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'ok', database: 'ok' });
  });

  it('GET /api/categories lists the seeded categories', async () => {
    const { status, body } = await call('GET', '/api/categories');
    assert.equal(status, 200);
    assert.deepEqual(body.map((c) => c.name), [...DEFAULT_CATEGORIES]);
  });

  it('supports the full create, read, update, delete cycle', async () => {
    const created = await call('POST', '/api/expenses', validBody);
    assert.equal(created.status, 201);
    assert.equal(created.body.amount, 25.4);
    assert.equal(created.body.categoryName, 'Food');
    const { id } = created.body;

    const fetched = await call('GET', `/api/expenses/${id}`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body, created.body);

    const listed = await call('GET', '/api/expenses?month=2026-10');
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((e) => e.id === id));

    const updated = await call('PUT', `/api/expenses/${id}`, { ...validBody, amount: '30', description: 'Dinner + tip' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.amount, 30);
    assert.equal(updated.body.description, 'Dinner + tip');

    const deleted = await call('DELETE', `/api/expenses/${id}`);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.body, null);

    const afterDelete = await call('GET', `/api/expenses/${id}`);
    assert.equal(afterDelete.status, 404);
    assert.equal(afterDelete.body.error.code, 'NOT_FOUND');
  });

  it('POST returns 400 with field details for invalid data', async () => {
    const { status, body } = await call('POST', '/api/expenses', { ...validBody, amount: -1, date: 'yesterday' });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(body.error.details.map((d) => d.field), ['amount', 'date']);
  });

  it('POST returns 400 INVALID_JSON for a malformed body', async () => {
    const { status, body } = await call('POST', '/api/expenses', '{"amount": 10,');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'INVALID_JSON');
  });

  it('POST returns 400 when the body is missing', async () => {
    const { status, body } = await call('POST', '/api/expenses');
    assert.equal(status, 400);
    assert.deepEqual(body.error.details.map((d) => d.field), ['body']);
  });

  it('POST returns 413 for an oversized body', async () => {
    const { status, body } = await call('POST', '/api/expenses', { ...validBody, description: 'x'.repeat(20_000) });
    assert.equal(status, 413);
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('returns 404 for PUT and DELETE on a nonexistent expense', async () => {
    assert.equal((await call('PUT', '/api/expenses/99999', validBody)).status, 404);
    assert.equal((await call('DELETE', '/api/expenses/99999')).status, 404);
  });

  it('returns 400 for a non-numeric ID and an invalid month filter', async () => {
    const badId = await call('GET', '/api/expenses/abc');
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.details[0].field, 'id');

    const badMonth = await call('GET', '/api/expenses?month=2026-13');
    assert.equal(badMonth.status, 400);
    assert.equal(badMonth.body.error.details[0].field, 'month');
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const { status, body } = await call('GET', '/api/unknown');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('returns a generic 500 when the database fails, without crashing the server', async (t) => {
    const broken = await startTestServer();
    const loggedErrors = t.mock.method(console, 'error', () => {});
    try {
      broken.db.close();

      const { status, body } = await request(broken.baseUrl, 'GET', '/api/expenses');
      assert.equal(status, 500);
      assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      assert.equal(loggedErrors.mock.callCount(), 1, 'the real error is logged on the server');

      const again = await request(broken.baseUrl, 'GET', '/api/categories');
      assert.equal(again.status, 500, 'the server is still answering requests');
    } finally {
      await broken.close();
    }
  });

  it('stores non-Latin descriptions unchanged, counting characters rather than bytes', async () => {
    const description = 'Храна от пазара';
    const created = await call('POST', '/api/expenses', { ...validBody, description });
    assert.equal(created.status, 201);
    assert.equal((await call('GET', `/api/expenses/${created.body.id}`)).body.description, description);

    const maxLength = await call('POST', '/api/expenses', { ...validBody, description: 'ж'.repeat(200) });
    assert.equal(maxLength.status, 201);
  });

  it('accepts the maximum amount and rejects one cent more', async () => {
    assert.equal((await call('POST', '/api/expenses', { ...validBody, amount: 1_000_000 })).status, 201);
    const tooLarge = await call('POST', '/api/expenses', { ...validBody, amount: '1000000.01' });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.body.error.details[0].field, 'amount');
  });

  it('accepts a leap day only in a leap year', async () => {
    assert.equal((await call('POST', '/api/expenses', { ...validBody, date: '2028-02-29' })).status, 201);
    assert.equal((await call('POST', '/api/expenses', { ...validBody, date: '2027-02-29' })).status, 400);
  });

  it('rejects a body that is not sent as JSON', async () => {
    const response = await fetch(`${server.baseUrl}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'amount=10&categoryId=1',
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.details[0].field, 'body');
  });

  it('ignores fields the client is not allowed to set', async () => {
    const created = await call('POST', '/api/expenses', { ...validBody, id: 424242, createdAt: '1999-01-01', admin: true });
    assert.equal(created.status, 201);
    assert.notEqual(created.body.id, 424242);
    assert.notEqual(created.body.createdAt, '1999-01-01');
    assert.equal('admin' in created.body, false);
  });

  it('treats SQL in text fields as plain data', async () => {
    const description = "Coffee'); DROP TABLE expenses; --";
    const created = await call('POST', '/api/expenses', { ...validBody, description });
    assert.equal(created.status, 201);
    assert.equal(created.body.description, description);
    assert.equal((await call('GET', '/api/expenses')).status, 200);
  });
});
