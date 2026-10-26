import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer } from './helpers.js';

describe('Budgets and analytics API (HTTP)', () => {
  let server;
  const call = (method, path, body) => request(server.baseUrl, method, path, body);

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  it('PUT /api/budgets/:categoryId creates and then updates a budget', async () => {
    const created = await call('PUT', '/api/budgets/1', { monthlyLimit: 200 });
    assert.equal(created.status, 200);
    assert.equal(created.body.monthlyLimit, 200);

    const updated = await call('PUT', '/api/budgets/1', { monthlyLimit: '250.75' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.monthlyLimit, 250.75);

    const listed = await call('GET', '/api/budgets');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map((b) => [b.categoryName, b.monthlyLimit]), [['Food', 250.75]]);
  });

  it('PUT returns 400 for an invalid limit and 404 for an unknown category', async () => {
    const invalid = await call('PUT', '/api/budgets/1', { monthlyLimit: -5 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.details[0].field, 'monthlyLimit');

    const unknown = await call('PUT', '/api/budgets/999', { monthlyLimit: 10 });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');

    const badId = await call('PUT', '/api/budgets/abc', { monthlyLimit: 10 });
    assert.equal(badId.status, 400);
  });

  it('DELETE /api/budgets/:categoryId removes a budget, then returns 404', async () => {
    await call('PUT', '/api/budgets/2', { monthlyLimit: 50 });
    assert.equal((await call('DELETE', '/api/budgets/2')).status, 204);
    assert.equal((await call('DELETE', '/api/budgets/2')).status, 404);
  });

  it('GET /api/analytics/summary reflects expenses created through the API', async () => {
    await call('PUT', '/api/budgets/1', { monthlyLimit: 100 });
    await call('POST', '/api/expenses', { amount: 60, categoryId: 1, date: '2027-03-05', description: 'Groceries' });
    await call('POST', '/api/expenses', { amount: 55.5, categoryId: 1, date: '2027-03-28', description: 'Market' });
    await call('POST', '/api/expenses', { amount: 30, categoryId: 2, date: '2027-03-10', description: 'Bus pass' });

    const { status, body } = await call('GET', '/api/analytics/summary?month=2027-03');
    assert.equal(status, 200);
    assert.equal(body.totalSpent, 145.5);
    assert.equal(body.expenseCount, 3);

    const food = body.categories.find((c) => c.name === 'Food');
    assert.deepEqual(
      { spent: food.spent, budget: food.budget, remaining: food.remaining, status: food.status },
      { spent: 115.5, budget: 100, remaining: -15.5, status: 'over' },
    );
    assert.deepEqual(body.topCategories.map((c) => c.name), ['Food', 'Transport']);
  });

  it('GET /api/analytics/summary defaults to the current month', async () => {
    const { status, body } = await call('GET', '/api/analytics/summary');
    assert.equal(status, 200);
    assert.match(body.month, /^\d{4}-\d{2}$/);
  });

  it('GET /api/analytics/summary returns 400 for an invalid month', async () => {
    const { status, body } = await call('GET', '/api/analytics/summary?month=2027-3');
    assert.equal(status, 400);
    assert.equal(body.error.details[0].field, 'month');
  });

  it('GET /api/analytics/trend returns monthly totals and rejects an invalid number of months', async () => {
    await call('POST', '/api/expenses', { amount: 12, categoryId: 2, date: '2030-02-10', description: 'Taxi' });
    await call('POST', '/api/expenses', { amount: 8, categoryId: 2, date: '2030-03-05', description: 'Bus' });

    const { status, body } = await call('GET', '/api/analytics/trend?month=2030-03&months=3');
    assert.equal(status, 200);
    assert.deepEqual(body.months, [
      { month: '2030-01', totalSpent: 0, expenseCount: 0 },
      { month: '2030-02', totalSpent: 12, expenseCount: 1 },
      { month: '2030-03', totalSpent: 8, expenseCount: 1 },
    ]);

    const invalid = await call('GET', '/api/analytics/trend?months=30');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.details[0].field, 'months');
  });
});
