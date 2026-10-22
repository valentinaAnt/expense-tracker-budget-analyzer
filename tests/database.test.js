import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, DEFAULT_CATEGORIES } from '../src/db/database.js';
import { createTempDir } from './helpers.js';

const INSERT_EXPENSE = `
  INSERT INTO expenses (amount_cents, category_id, expense_date, description)
  VALUES (?, ?, ?, ?)`;

describe('openDatabase', () => {
  let temp;
  let db;

  beforeEach(() => {
    temp = createTempDir();
    db = openDatabase(temp.dbPath);
  });

  afterEach(() => {
    if (db.open) db.close();
    temp.cleanup();
  });

  it('creates the categories, expenses and budgets tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, ['budgets', 'categories', 'expenses']);
  });

  it('seeds the default categories in a fixed order', () => {
    const names = db.prepare('SELECT name FROM categories ORDER BY id').all().map((row) => row.name);
    assert.deepEqual(names, [...DEFAULT_CATEGORIES]);
  });

  it('enables foreign key enforcement', () => {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  });

  it('can be initialized repeatedly without duplicating categories', () => {
    db.close();
    db = openDatabase(temp.dbPath);
    db.close();
    db = openDatabase(temp.dbPath);

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get();
    assert.equal(count, DEFAULT_CATEGORIES.length);
  });

  it('creates a missing parent folder for the database file', () => {
    const nestedPath = join(temp.dir, 'nested', 'folder', 'app.db');
    const nestedDb = openDatabase(nestedPath);
    nestedDb.close();
    assert.ok(existsSync(nestedPath));
  });

  it('rejects an expense that references a nonexistent category', () => {
    assert.throws(
      () => db.prepare(INSERT_EXPENSE).run(1000, 999, '2026-10-01', 'Lunch'),
      { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' },
    );
  });

  it('rejects zero and negative amounts', () => {
    assert.throws(() => db.prepare(INSERT_EXPENSE).run(0, 1, '2026-10-01', 'Lunch'), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
    assert.throws(() => db.prepare(INSERT_EXPENSE).run(-500, 1, '2026-10-01', 'Lunch'), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  });

  it('rejects an empty or too long description', () => {
    assert.throws(() => db.prepare(INSERT_EXPENSE).run(1000, 1, '2026-10-01', ''), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
    assert.throws(() => db.prepare(INSERT_EXPENSE).run(1000, 1, '2026-10-01', 'x'.repeat(201)), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  });

  it('rejects a date that is not in YYYY-MM-DD format', () => {
    assert.throws(() => db.prepare(INSERT_EXPENSE).run(1000, 1, '01/10/2026', 'Lunch'), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  });

  it('allows only one budget per category', () => {
    const insertBudget = db.prepare('INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, ?)');
    insertBudget.run(1, 30000);
    assert.throws(() => insertBudget.run(1, 50000), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });

  it('keeps expenses and budgets after the database is closed and reopened', () => {
    db.prepare(INSERT_EXPENSE).run(1250, 1, '2026-10-15', 'Groceries');
    db.prepare('INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, ?)').run(1, 40000);
    db.close();

    db = openDatabase(temp.dbPath);
    const expense = db
      .prepare('SELECT amount_cents, category_id, expense_date, description FROM expenses')
      .get();
    const budget = db.prepare('SELECT category_id, monthly_limit_cents FROM budgets').get();

    assert.deepEqual({ ...expense }, {
      amount_cents: 1250,
      category_id: 1,
      expense_date: '2026-10-15',
      description: 'Groceries',
    });
    assert.deepEqual({ ...budget }, { category_id: 1, monthly_limit_cents: 40000 });
  });
});
