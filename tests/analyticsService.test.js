import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/errors.js';
import { createAnalyticsService } from '../src/services/analyticsService.js';
import { createBudgetService } from '../src/services/budgetService.js';
import { createCategoryService } from '../src/services/categoryService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createTestDatabase } from './helpers.js';

const CATEGORY = { Food: 1, Transport: 2, Utilities: 4, Health: 5, Entertainment: 6, Shopping: 7 };

describe('analyticsService.getMonthlySummary', () => {
  let testDb;
  let expenses;
  let budgets;
  let analytics;

  const addExpense = (category, amount, date) =>
    expenses.create({ amount, categoryId: CATEGORY[category], date, description: `${category} ${date}` });

  beforeEach(() => {
    testDb = createTestDatabase();
    const categories = createCategoryService(testDb.db);
    expenses = createExpenseService(testDb.db, categories);
    budgets = createBudgetService(testDb.db, categories);
    // Fixed "today" so the default month does not depend on when the tests run.
    analytics = createAnalyticsService(testDb.db, { now: () => new Date(2026, 9, 22) });
  });

  afterEach(() => testDb.close());

  describe('with a known October 2026 data set', () => {
    beforeEach(() => {
      budgets.set(CATEGORY.Food, { monthlyLimit: 300 });
      budgets.set(CATEGORY.Transport, { monthlyLimit: 100 });
      budgets.set(CATEGORY.Entertainment, { monthlyLimit: 50 });
      budgets.set(CATEGORY.Health, { monthlyLimit: 80 });

      addExpense('Food', 120.5, '2026-10-01');
      addExpense('Food', 189.7, '2026-10-31');
      addExpense('Transport', 45, '2026-10-15');
      addExpense('Entertainment', 40, '2026-10-20');
      addExpense('Shopping', 25.99, '2026-10-05');
      // Just outside October: must not be counted.
      addExpense('Food', 999, '2026-09-30');
      addExpense('Food', 999, '2026-11-01');
    });

    it('calculates month totals from October expenses only', () => {
      const summary = analytics.getMonthlySummary('2026-10');
      assert.equal(summary.month, '2026-10');
      assert.equal(summary.totalSpent, 421.19); // 120.50 + 189.70 + 45 + 40 + 25.99
      assert.equal(summary.totalBudget, 530); // 300 + 100 + 50 + 80
      assert.equal(summary.expenseCount, 5);
    });

    it('compares each category with its budget, highest spending first', () => {
      const { categories } = analytics.getMonthlySummary('2026-10');
      assert.deepEqual(categories, [
        { categoryId: 1, name: 'Food', spent: 310.2, expenseCount: 2, budget: 300, remaining: -10.2, percentUsed: 103.4, status: 'over' },
        { categoryId: 2, name: 'Transport', spent: 45, expenseCount: 1, budget: 100, remaining: 55, percentUsed: 45, status: 'ok' },
        { categoryId: 6, name: 'Entertainment', spent: 40, expenseCount: 1, budget: 50, remaining: 10, percentUsed: 80, status: 'warning' },
        { categoryId: 7, name: 'Shopping', spent: 25.99, expenseCount: 1, budget: null, remaining: null, percentUsed: null, status: 'no-budget' },
        { categoryId: 5, name: 'Health', spent: 0, expenseCount: 0, budget: 80, remaining: 80, percentUsed: 0, status: 'ok' },
      ]);
    });

    it('lists the top three categories with their share of total spending', () => {
      assert.deepEqual(analytics.getMonthlySummary('2026-10').topCategories, [
        { categoryId: 1, name: 'Food', spent: 310.2, sharePercent: 73.6 },
        { categoryId: 2, name: 'Transport', spent: 45, sharePercent: 10.7 },
        { categoryId: 6, name: 'Entertainment', spent: 40, sharePercent: 9.5 },
      ]);
    });

    it('uses the current month when no month is given', () => {
      assert.deepEqual(analytics.getMonthlySummary(), analytics.getMonthlySummary('2026-10'));
    });

    it('reflects edits and deletions immediately', () => {
      const [shopping] = expenses.list({ month: '2026-10', categoryId: CATEGORY.Shopping });
      expenses.remove(shopping.id);
      const summary = analytics.getMonthlySummary('2026-10');
      assert.equal(summary.totalSpent, 395.2);
      assert.ok(!summary.categories.some((c) => c.name === 'Shopping'));
    });
  });

  it('marks spending of exactly the budget as warning with nothing remaining', () => {
    budgets.set(CATEGORY.Utilities, { monthlyLimit: 50 });
    addExpense('Utilities', 50, '2026-10-10');
    const [utilities] = analytics.getMonthlySummary('2026-10').categories;
    assert.equal(utilities.remaining, 0);
    assert.equal(utilities.percentUsed, 100);
    assert.equal(utilities.status, 'warning');
  });

  it('uses the same month boundary rule across a year change', () => {
    addExpense('Food', 10, '2026-12-31');
    addExpense('Food', 20, '2027-01-01');
    assert.equal(analytics.getMonthlySummary('2026-12').totalSpent, 10);
    assert.equal(analytics.getMonthlySummary('2027-01').totalSpent, 20);
  });

  it('returns zeros and empty lists for a month without data', () => {
    assert.deepEqual(analytics.getMonthlySummary('2025-01'), {
      month: '2025-01',
      totalSpent: 0,
      totalBudget: 0,
      expenseCount: 0,
      categories: [],
      topCategories: [],
    });
  });

  it('rejects an invalid month', () => {
    for (const month of ['2026-13', '2026/10', '', 'october']) {
      assert.throws(() => analytics.getMonthlySummary(month), ValidationError);
    }
  });
});

describe('analyticsService.getTrend', () => {
  let testDb;
  let expenses;
  let budgets;
  let analytics;

  const addExpense = (amount, date) =>
    expenses.create({ amount, categoryId: CATEGORY.Food, date, description: `Food ${date}` });

  beforeEach(() => {
    testDb = createTestDatabase();
    const categories = createCategoryService(testDb.db);
    expenses = createExpenseService(testDb.db, categories);
    budgets = createBudgetService(testDb.db, categories);
    analytics = createAnalyticsService(testDb.db, { now: () => new Date(2026, 9, 22) });
  });

  afterEach(() => testDb.close());

  it('totals each of the last six months, oldest first, with zero for months without expenses', () => {
    addExpense(100, '2026-04-30'); // just before the six-month window
    addExpense(20.5, '2026-05-01');
    addExpense(10, '2026-07-15');
    addExpense(5.25, '2026-07-31');
    addExpense(40, '2026-10-31');
    addExpense(999, '2026-11-01'); // just after

    assert.deepEqual(analytics.getTrend('2026-10').months, [
      { month: '2026-05', totalSpent: 20.5, expenseCount: 1 },
      { month: '2026-06', totalSpent: 0, expenseCount: 0 },
      { month: '2026-07', totalSpent: 15.25, expenseCount: 2 },
      { month: '2026-08', totalSpent: 0, expenseCount: 0 },
      { month: '2026-09', totalSpent: 0, expenseCount: 0 },
      { month: '2026-10', totalSpent: 40, expenseCount: 1 },
    ]);
  });

  it('crosses a year boundary and accepts another number of months', () => {
    addExpense(10, '2025-12-31');
    addExpense(20, '2026-01-01');
    assert.deepEqual(analytics.getTrend('2026-01', '2').months, [
      { month: '2025-12', totalSpent: 10, expenseCount: 1 },
      { month: '2026-01', totalSpent: 20, expenseCount: 1 },
    ]);
  });

  it('reports the sum of all monthly budgets, or null when there are none', () => {
    assert.equal(analytics.getTrend('2026-10').monthlyBudget, null);
    budgets.set(CATEGORY.Food, { monthlyLimit: 300 });
    budgets.set(CATEGORY.Transport, { monthlyLimit: 99.99 });
    assert.equal(analytics.getTrend('2026-10').monthlyBudget, 399.99);
  });

  it('ends at the current month by default', () => {
    assert.equal(analytics.getTrend().months.at(-1).month, '2026-10');
    assert.equal(analytics.getTrend().months.length, 6);
  });

  it('rejects an invalid month or number of months', () => {
    assert.throws(() => analytics.getTrend('2026-13'), ValidationError);
    for (const months of ['0', '25', '-1', '2.5', 'six', '']) {
      assert.throws(() => analytics.getTrend('2026-10', months), (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.details[0].field, 'months');
        return true;
      });
    }
  });
});
