import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES } from '../src/db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.js';
import { createAnalyticsService } from '../src/services/analyticsService.js';
import { createBudgetService } from '../src/services/budgetService.js';
import { createCategoryService } from '../src/services/categoryService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createTestDatabase } from './helpers.js';

const FOOD = 1;

describe('categoryService', () => {
  let testDb;
  let categories;
  let expenses;
  let budgets;

  const addExpense = (categoryId, amount = 10, date = '2026-10-10') =>
    expenses.create({ amount, categoryId, date, description: 'Test expense' });

  beforeEach(() => {
    testDb = createTestDatabase();
    categories = createCategoryService(testDb.db);
    expenses = createExpenseService(testDb.db, categories);
    budgets = createBudgetService(testDb.db, categories);
  });

  afterEach(() => testDb.close());

  it('lists the default categories with the number of expenses in each', () => {
    addExpense(FOOD);
    addExpense(FOOD);
    const list = categories.list();
    assert.deepEqual(list.map((c) => c.name), [...DEFAULT_CATEGORIES]);
    assert.equal(list.find((c) => c.id === FOOD).expenseCount, 2);
    assert.equal(list.find((c) => c.name === 'Other').expenseCount, 0);
  });

  describe('create', () => {
    it('adds a category, tidying up spaces in the name', () => {
      const created = categories.create({ name: '  Pet   care ' });
      assert.deepEqual({ ...created }, { id: created.id, name: 'Pet care', expenseCount: 0 });
      assert.equal(categories.list().at(-1).name, 'Pet care');
    });

    it('rejects empty, too long and non-text names', () => {
      for (const name of ['', '   ', 'x'.repeat(41), 42, null, undefined]) {
        assert.throws(() => categories.create({ name }), (error) => {
          assert.ok(error instanceof ValidationError);
          assert.equal(error.details[0].field, 'name');
          return true;
        });
      }
      assert.throws(() => categories.create(null), ValidationError);
      assert.equal(categories.list().length, DEFAULT_CATEGORIES.length);
    });

    it('accepts a 40-character name', () => {
      assert.equal(categories.create({ name: 'x'.repeat(40) }).name.length, 40);
    });

    it('rejects duplicates regardless of upper/lower case, including Cyrillic', () => {
      assert.throws(() => categories.create({ name: 'food' }), ConflictError);
      categories.create({ name: 'Храна' });
      assert.throws(() => categories.create({ name: 'храна' }), /already exists/);
    });
  });

  describe('rename', () => {
    it('renames a category and keeps its expenses and budget attached', () => {
      addExpense(FOOD, 25);
      budgets.set(FOOD, { monthlyLimit: 300 });

      const renamed = categories.rename(String(FOOD), { name: 'Groceries' });
      assert.deepEqual({ ...renamed }, { id: FOOD, name: 'Groceries', expenseCount: 1 });
      assert.equal(expenses.list()[0].categoryName, 'Groceries');
      assert.equal(budgets.list()[0].categoryName, 'Groceries');
    });

    it('allows changing only the upper/lower case of its own name', () => {
      assert.equal(categories.rename(FOOD, { name: 'FOOD' }).name, 'FOOD');
    });

    it('rejects a name that another category already uses', () => {
      assert.throws(() => categories.rename(FOOD, { name: 'transport' }), ConflictError);
      assert.equal(categories.list()[0].name, 'Food');
    });

    it('distinguishes an invalid ID (400) from an unknown category (404)', () => {
      assert.throws(() => categories.rename('abc', { name: 'X' }), ValidationError);
      assert.throws(() => categories.rename(999, { name: 'X' }), NotFoundError);
    });
  });

  describe('remove', () => {
    it('deletes an unused category', () => {
      const { id } = categories.create({ name: 'Pets' });
      categories.remove(String(id));
      assert.ok(!categories.list().some((c) => c.name === 'Pets'));
      assert.equal(categories.exists(id), false);
    });

    it('deletes the category budget together with the category', () => {
      const { id } = categories.create({ name: 'Pets' });
      budgets.set(id, { monthlyLimit: 40 });
      categories.remove(id);
      assert.deepEqual(budgets.list(), []);
    });

    it('refuses to delete a category that still has expenses and changes nothing', () => {
      addExpense(FOOD);
      budgets.set(FOOD, { monthlyLimit: 300 });
      assert.throws(() => categories.remove(FOOD), (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.message, 'Category "Food" still has 1 expense. Move or delete it first.');
        return true;
      });
      assert.ok(categories.exists(FOOD));
      assert.equal(budgets.list().length, 1);
    });

    it('reports an unknown category as not found', () => {
      assert.throws(() => categories.remove(999), NotFoundError);
    });
  });

  it('makes a new category usable for expenses, budgets and analytics', () => {
    const { id } = categories.create({ name: 'Pets' });
    addExpense(id, 30, '2026-10-05');
    budgets.set(id, { monthlyLimit: 25 });

    const summary = createAnalyticsService(testDb.db).getMonthlySummary('2026-10');
    const pets = summary.categories.find((c) => c.name === 'Pets');
    assert.deepEqual({ spent: pets.spent, budget: pets.budget, status: pets.status }, { spent: 30, budget: 25, status: 'over' });
  });
});
