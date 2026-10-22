import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundError, ValidationError } from '../src/errors.js';
import { createCategoryService } from '../src/services/categoryService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createTestDatabase } from './helpers.js';

const FOOD = 1;
const TRANSPORT = 2;

const validInput = (overrides = {}) => ({
  amount: 12.5,
  categoryId: FOOD,
  date: '2026-10-15',
  description: 'Groceries',
  ...overrides,
});

/** Asserts that fn throws a ValidationError listing exactly the given fields. */
function assertValidationFields(fn, expectedFields) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ValidationError);
    assert.deepEqual(error.details.map((detail) => detail.field).sort(), [...expectedFields].sort());
    return true;
  });
}

describe('expenseService', () => {
  let testDb;
  let expenses;

  beforeEach(() => {
    testDb = createTestDatabase();
    expenses = createExpenseService(testDb.db, createCategoryService(testDb.db));
  });

  afterEach(() => testDb.close());

  describe('create', () => {
    it('stores a valid expense and returns it with its category name', () => {
      const expense = expenses.create(validInput({ description: '  Groceries  ' }));

      assert.equal(typeof expense.id, 'number');
      assert.equal(expense.amount, 12.5);
      assert.equal(expense.categoryId, FOOD);
      assert.equal(expense.categoryName, 'Food');
      assert.equal(expense.date, '2026-10-15');
      assert.equal(expense.description, 'Groceries');

      const { amount_cents: stored } = testDb.db.prepare('SELECT amount_cents FROM expenses').get();
      assert.equal(stored, 1250);
    });

    it('accepts the amount as a numeric string', () => {
      assert.equal(expenses.create(validInput({ amount: '7.05' })).amount, 7.05);
    });

    it('reports every invalid field at once and stores nothing', () => {
      assertValidationFields(
        () => expenses.create({ amount: -3, categoryId: 'x', date: '2026-02-30', description: '' }),
        ['amount', 'categoryId', 'date', 'description'],
      );
      assert.equal(expenses.list().length, 0);
    });

    it('rejects a category that does not exist', () => {
      assert.throws(() => expenses.create(validInput({ categoryId: 999 })), (error) => {
        assert.ok(error instanceof ValidationError);
        assert.deepEqual(error.details, [{ field: 'categoryId', message: 'Category does not exist' }]);
        return true;
      });
    });

    it('rejects a missing or non-object body', () => {
      for (const body of [undefined, null, [], 'text']) {
        assertValidationFields(() => expenses.create(body), ['body']);
      }
    });
  });

  describe('list', () => {
    beforeEach(() => {
      expenses.create(validInput({ date: '2026-09-30', description: 'Last day of September' }));
      expenses.create(validInput({ date: '2026-10-01', description: 'First day of October' }));
      expenses.create(validInput({ date: '2026-10-31', categoryId: TRANSPORT, description: 'Last day of October' }));
      expenses.create(validInput({ date: '2026-11-01', description: 'First day of November' }));
    });

    it('returns all expenses, newest first', () => {
      assert.deepEqual(
        expenses.list().map((e) => e.date),
        ['2026-11-01', '2026-10-31', '2026-10-01', '2026-09-30'],
      );
    });

    it('filters by month including both month boundaries and nothing outside them', () => {
      assert.deepEqual(
        expenses.list({ month: '2026-10' }).map((e) => e.description),
        ['Last day of October', 'First day of October'],
      );
    });

    it('filters by month and category together', () => {
      const result = expenses.list({ month: '2026-10', categoryId: String(TRANSPORT) });
      assert.deepEqual(result.map((e) => e.description), ['Last day of October']);
    });

    it('returns an empty list for a month without expenses', () => {
      assert.deepEqual(expenses.list({ month: '2025-01' }), []);
    });

    it('rejects an invalid month or category filter', () => {
      assertValidationFields(() => expenses.list({ month: '2026-13' }), ['month']);
      assertValidationFields(() => expenses.list({ categoryId: 'abc' }), ['categoryId']);
    });
  });

  describe('getById, update and remove', () => {
    it('updates every field of an existing expense', () => {
      const { id } = expenses.create(validInput());
      const updated = expenses.update(String(id), {
        amount: '99.90',
        categoryId: TRANSPORT,
        date: '2026-10-20',
        description: 'Train ticket',
      });

      assert.equal(updated.id, id);
      assert.equal(updated.amount, 99.9);
      assert.equal(updated.categoryName, 'Transport');
      assert.equal(updated.date, '2026-10-20');
      assert.equal(updated.description, 'Train ticket');
      assert.deepEqual(expenses.getById(id), updated);
    });

    it('does not change the expense when the update is invalid', () => {
      const created = expenses.create(validInput());
      assertValidationFields(() => expenses.update(created.id, validInput({ amount: 0 })), ['amount']);
      assert.equal(expenses.getById(created.id).amount, 12.5);
    });

    it('deletes an expense so it can no longer be found', () => {
      const { id } = expenses.create(validInput());
      expenses.remove(String(id));
      assert.throws(() => expenses.getById(id), NotFoundError);
    });

    it('throws NotFoundError for a nonexistent expense', () => {
      assert.throws(() => expenses.getById(404), NotFoundError);
      assert.throws(() => expenses.update(404, validInput()), NotFoundError);
      assert.throws(() => expenses.remove(404), NotFoundError);
    });

    it('rejects an invalid ID before touching the database', () => {
      assertValidationFields(() => expenses.getById('abc'), ['id']);
      assertValidationFields(() => expenses.update('-1', validInput()), ['id']);
      assertValidationFields(() => expenses.remove('1.5'), ['id']);
    });
  });
});
