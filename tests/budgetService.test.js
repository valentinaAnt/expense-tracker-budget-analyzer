import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundError, ValidationError } from '../src/errors.js';
import { createBudgetService } from '../src/services/budgetService.js';
import { createCategoryService } from '../src/services/categoryService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createTestDatabase } from './helpers.js';

const FOOD = 1;
const TRANSPORT = 2;

describe('budgetService', () => {
  let testDb;
  let budgets;

  beforeEach(() => {
    testDb = createTestDatabase();
    budgets = createBudgetService(testDb.db, createCategoryService(testDb.db));
  });

  afterEach(() => testDb.close());

  it('creates a budget and returns it with the category name', () => {
    const budget = budgets.set(String(FOOD), { monthlyLimit: '300.50' });
    assert.equal(budget.categoryId, FOOD);
    assert.equal(budget.categoryName, 'Food');
    assert.equal(budget.monthlyLimit, 300.5);
  });

  it('replaces the existing budget instead of adding a second one', () => {
    budgets.set(FOOD, { monthlyLimit: 300 });
    budgets.set(FOOD, { monthlyLimit: 450 });

    assert.deepEqual(budgets.list().map((b) => [b.categoryName, b.monthlyLimit]), [['Food', 450]]);
    const { count } = testDb.db.prepare('SELECT COUNT(*) AS count FROM budgets').get();
    assert.equal(count, 1);
  });

  it('lists all budgets ordered by category', () => {
    budgets.set(TRANSPORT, { monthlyLimit: 100 });
    budgets.set(FOOD, { monthlyLimit: 300 });
    assert.deepEqual(budgets.list().map((b) => b.categoryName), ['Food', 'Transport']);
  });

  it('rejects invalid monthly limits without changing the stored budget', () => {
    budgets.set(FOOD, { monthlyLimit: 300 });
    for (const monthlyLimit of [0, -10, 'abc', '12.345', undefined]) {
      assert.throws(() => budgets.set(FOOD, { monthlyLimit }), (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.details[0].field, 'monthlyLimit');
        return true;
      });
    }
    assert.throws(() => budgets.set(FOOD, null), ValidationError);
    assert.equal(budgets.list()[0].monthlyLimit, 300);
  });

  it('distinguishes a malformed category ID (400) from an unknown category (404)', () => {
    assert.throws(() => budgets.set('abc', { monthlyLimit: 10 }), ValidationError);
    assert.throws(() => budgets.set('999', { monthlyLimit: 10 }), NotFoundError);
  });

  it('removes a budget, and reports a missing budget as not found', () => {
    budgets.set(FOOD, { monthlyLimit: 300 });
    budgets.remove(String(FOOD));
    assert.deepEqual(budgets.list(), []);
    assert.throws(() => budgets.remove(FOOD), NotFoundError);
  });

  it('does not delete expenses when a budget is removed', () => {
    const expenses = createExpenseService(testDb.db, createCategoryService(testDb.db));
    expenses.create({ amount: 10, categoryId: FOOD, date: '2026-10-01', description: 'Lunch' });
    budgets.set(FOOD, { monthlyLimit: 300 });
    budgets.remove(FOOD);
    assert.equal(expenses.list().length, 1);
  });
});
