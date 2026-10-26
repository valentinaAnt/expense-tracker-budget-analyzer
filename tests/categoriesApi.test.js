import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer } from './helpers.js';

describe('Categories API (HTTP)', () => {
  let server;
  const call = (method, path, body) => request(server.baseUrl, method, path, body);

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  it('POST creates a category (201) and GET lists it with an expense count', async () => {
    const created = await call('POST', '/api/categories', { name: 'Pets' });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Pets');
    assert.equal(created.body.expenseCount, 0);

    const listed = await call('GET', '/api/categories');
    assert.ok(listed.body.some((c) => c.id === created.body.id && c.expenseCount === 0));
  });

  it('POST returns 400 for an invalid name and 409 for a duplicate', async () => {
    const invalid = await call('POST', '/api/categories', { name: '   ' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.details[0].field, 'name');

    const duplicate = await call('POST', '/api/categories', { name: 'FOOD' });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, { error: { code: 'CONFLICT', message: 'A category named "Food" already exists' } });
  });

  it('PUT renames a category (200), with 409 for a taken name and 404 for an unknown one', async () => {
    const { body: gifts } = await call('POST', '/api/categories', { name: 'Gifts' });

    const renamed = await call('PUT', `/api/categories/${gifts.id}`, { name: 'Presents' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Presents');

    assert.equal((await call('PUT', `/api/categories/${gifts.id}`, { name: 'transport' })).status, 409);
    assert.equal((await call('PUT', '/api/categories/9999', { name: 'Anything' })).status, 404);
    assert.equal((await call('PUT', '/api/categories/abc', { name: 'Anything' })).status, 400);
  });

  it('DELETE refuses a category with expenses (409) and deletes an unused one (204)', async () => {
    const { body: hobby } = await call('POST', '/api/categories', { name: 'Hobbies' });
    const { body: expense } = await call('POST', '/api/expenses',
      { amount: 15, categoryId: hobby.id, date: '2026-10-10', description: 'Paint' });

    const refused = await call('DELETE', `/api/categories/${hobby.id}`);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /still has 1 expense/);

    assert.equal((await call('DELETE', `/api/expenses/${expense.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/categories/${hobby.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/categories/${hobby.id}`)).status, 404);
  });

  it('DELETE with ?moveTo moves the expenses (204) and validates the target (400)', async () => {
    const { body: clubs } = await call('POST', '/api/categories', { name: 'Clubs' });
    const { body: expense } = await call('POST', '/api/expenses',
      { amount: 25, categoryId: clubs.id, date: '2026-10-11', description: 'Membership' });

    const badTarget = await call('DELETE', `/api/categories/${clubs.id}?moveTo=9999`);
    assert.equal(badTarget.status, 400);
    assert.deepEqual(badTarget.body.error.details, [{ field: 'moveTo', message: 'Target category does not exist' }]);

    assert.equal((await call('DELETE', `/api/categories/${clubs.id}?moveTo=6`)).status, 204);
    const moved = await call('GET', `/api/expenses/${expense.id}`);
    assert.equal(moved.body.categoryId, 6);
    assert.equal(moved.body.categoryName, 'Entertainment');
  });

  it('rejects expenses for a deleted category', async () => {
    const { body: temporary } = await call('POST', '/api/categories', { name: 'Temporary' });
    await call('DELETE', `/api/categories/${temporary.id}`);

    const response = await call('POST', '/api/expenses',
      { amount: 5, categoryId: temporary.id, date: '2026-10-10', description: 'Too late' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details, [{ field: 'categoryId', message: 'Category does not exist' }]);
  });
});
